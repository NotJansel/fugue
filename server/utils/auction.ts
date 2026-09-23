import { Routes } from 'discord.js'
import type { AuctionSnapshot } from '#shared/types'
import { auctionCard, getClient } from '../bot/client'
import { emitChange } from './bus'
import { getBalance, release, reserve, settleHold } from './purse-store'
import { captainForBidder, captainForDiscordId, reserveFor } from './tournament-model'
import { getTournament, recordSale } from './tournament-store'

/** The player being auctioned, as supplied by whoever started the auction. */
export interface AuctionSubject {
  osuId: string
  username: string
  ppRaw: number
  ppRank: number
  seed: number
  description: string | null
}

export type StartResult
  = | { kind: 'started', snapshot: AuctionSnapshot }
  /** `reason` is English prose; `code` names it in the dashboard's dictionary. Discord shows prose. */
    | { kind: 'rejected', reason: string, code: string }

/** Outcome of a bid, so the dashboard can tell the bidder exactly why it did not take. */
export type BidResult
  = | 'ACCEPTED'
    | 'NO_AUCTION'
    | 'ALREADY_HIGHEST'
    | 'ABOVE_MAX'
    | 'BELOW_STARTING'
    | 'NOT_HIGHER'
    | 'INSUFFICIENT_FUNDS'
    /** The Discord account behind the bid neither owns a captain nor stands in for one. */
    | 'NOT_CAPTAIN'
    /** A stand-in bid for a captain with no Discord account, so no purse to spend. */
    | 'CAPTAIN_UNLINKED'
    /** The bidder's roster is already at the largest legal team. */
    | 'TEAM_FULL'
    /** A raise has to clear the standing bid by the tournament's minimum step. */
    | 'BELOW_MIN_STEP'
    /** And may not clear it by more than the maximum step. */
    | 'ABOVE_MAX_STEP'
    /** Winning would leave too little to fill the roster to the smallest legal team. */
    | 'BREAKS_RESERVE'

/** How long an auction runs from the moment it opens, if nobody bids. */
const AUCTION_DURATION_MS = 20_000

/**
 * The least a bid leaves on the clock. A bid does not restart the countdown - one placed with more
 * than this left changes nothing about when it ends - but one in the closing seconds puts it back up
 * to this, so everyone else still gets a fair chance to answer it.
 */
const BID_EXTENSION_MS = 10_000

interface AuctionState {
  messageId: string
  channelId: string
  subject: AuctionSubject
  startingBid: number
  maxBid: number
  highestBid: number
  /** Discord ID of the leading *captain* - the purse holding the bid - even when a stand-in placed it. */
  highestBidder: string | null
  endsAt: number
  timer: NodeJS.Timeout | null
}

let current: AuctionState | null = null

/**
 * Serialises everything that touches the auction.
 *
 * Node runs this on one thread, but settling a purse and recording a sale both `await`, and a bid
 * arriving in that window would otherwise see a half-ended auction. The chain is the equivalent of
 * the mutex the Kotlin service held.
 */
let queue: Promise<unknown> = Promise.resolve()

function withLock<T>(block: () => Promise<T> | T): Promise<T> {
  const run = queue.then(block)
  queue = run.catch(() => {})

  return run
}

const toSnapshot = (auction: AuctionState): AuctionSnapshot => ({
  osuId: auction.subject.osuId,
  username: auction.subject.username,
  ppRaw: auction.subject.ppRaw,
  ppRank: auction.subject.ppRank,
  seed: auction.subject.seed,
  description: auction.subject.description,
  startingBid: auction.startingBid,
  maxBid: auction.maxBid,
  highestBid: auction.highestBid,
  highestBidderId: auction.highestBidder,
  endsAt: auction.endsAt,
  channelId: auction.channelId,
  messageId: auction.messageId
})

export const auctionSnapshot = (): AuctionSnapshot | null => current ? toSnapshot(current) : null

async function updateMessage(auction: AuctionState, bidStatus: string | null): Promise<void> {
  const client = getClient()
  if (!client) return

  try {
    await client.rest.patch(Routes.channelMessage(auction.channelId, auction.messageId), {
      body: auctionCard(auction.subject, auction.startingBid, auction.maxBid, bidStatus)
    })
  } catch (error) {
    console.error(`[auction] Failed to update message ${auction.messageId}:`, error)
  }
}

/**
 * The winning captain's team as it stands after the sale, captain first and then whoever they have
 * bought, in the order they bought them.
 *
 * What used to go here was every purse in the tournament, one `<@id>` a line, which pinged every
 * captain on the server each time anybody won anybody. The team is both quieter and the thing the
 * channel actually wants to see: who just got whom, and how much room is left on that roster.
 */
function rosterSummary(winnerDiscordId: string): string | null {
  const state = getTournament()
  const captain = captainForDiscordId(state, winnerDiscordId)
  if (!captain) return null

  const names = new Map(state.players.map(player => [player.osuId, player.username]))
  const members = state.rosters[captain.osuId] ?? []
  const lines = [
    `${captain.username} (captain)`,
    ...members.map(member => `${names.get(member.osuId) ?? member.osuId} - ${member.price}€`)
  ]

  const name = state.teamNames[captain.osuId] ?? captain.username

  return `**${name}** (${lines.length}/${state.teamSize}):\n${lines.map(line => `- ${line}`).join('\n')}`
}

async function announce(auction: AuctionState, result: string, roster: string | null): Promise<void> {
  const client = getClient()
  if (!client) return

  try {
    await client.rest.post(Routes.channelMessages(auction.channelId), {
      body: {
        content: roster ? `${result}\n\n${roster}` : result,
        // The winner is worth a ping; a team name is whatever an organiser typed, and an
        // `@everyone` in one must not carry.
        allowed_mentions: { parse: ['users'] }
      }
    })
  } catch (error) {
    console.error(`[auction] Failed to announce the result in ${auction.channelId}:`, error)
  }
}

/** Sets the auction to end `durationMs` from now. Must only be called from inside `withLock`. */
function scheduleTimer(auction: AuctionState, durationMs: number): void {
  if (auction.timer) clearTimeout(auction.timer)

  auction.endsAt = Date.now() + durationMs
  auction.timer = setTimeout(() => {
    void withLock(() => end(auction)).then(() => emitChange())
  }, durationMs)
}

/** Must only be called from inside `withLock`. */
async function end(auction: AuctionState): Promise<void> {
  // Make sure we're ending the auction that's actually running, not a stale one.
  if (current == null || current.messageId !== auction.messageId) return

  if (auction.timer) clearTimeout(auction.timer)
  current = null

  const winnerId = auction.highestBidder
  let notes = ''

  if (winnerId != null && auction.highestBid > 0) {
    const settled = await settleHold(winnerId, auction.highestBid)

    if (settled) {
      notes += ` The winner's purse has been debited by ${auction.highestBid}.`

      const team = await recordSale(auction.subject.osuId, winnerId, auction.highestBid)
      if (team != null) notes += ` ${auction.subject.username} joins ${team}'s team.`
    } else {
      notes += ' Could not debit the winner\'s purse (insufficient funds or error).'
    }
  }

  const result = auction.highestBid > 0
    ? `Auction ended! Winner: ${winnerId ? `<@${winnerId}>` : 'No one'} with bid ${auction.highestBid}.${notes}`
    : 'Auction ended! No bids were placed.'

  await announce(auction, result, winnerId != null ? rosterSummary(winnerId) : null)
}

/**
 * Starts an auction in `channelId`, posting the auction card there.
 *
 * The card is posted by this service rather than being a slash command reply, so that auctions
 * started from the dashboard look identical to ones started with `/auction`.
 */
export function startAuction(
  channelId: string,
  subject: AuctionSubject,
  startingBid: number,
  maxBid: number
): Promise<StartResult> {
  return withLock(async (): Promise<StartResult> => {
    const client = getClient()

    if (!client) {
      return { kind: 'rejected', reason: 'The bot isn\'t connected to Discord yet.', code: 'err.auction.notConnected' }
    }

    if (startingBid > maxBid) {
      return { kind: 'rejected', reason: 'Starting price cannot be greater than max price.', code: 'err.auction.range' }
    }

    if (current != null) {
      return { kind: 'rejected', reason: 'An auction is already in progress.', code: 'err.auction.running' }
    }

    let messageId: string

    try {
      const message = await client.rest.post(Routes.channelMessages(channelId), {
        body: auctionCard(subject, startingBid, maxBid)
      }) as { id: string }

      messageId = message.id
    } catch (error) {
      console.error(`[auction] Failed to post the auction message in ${channelId}:`, error)

      return {
        kind: 'rejected',
        reason: 'Could not post the auction message in that channel.',
        code: 'err.auction.postFailed'
      }
    }

    const auction: AuctionState = {
      messageId,
      channelId,
      subject,
      startingBid,
      maxBid,
      highestBid: 0,
      highestBidder: null,
      endsAt: 0,
      timer: null
    }

    current = auction
    scheduleTimer(auction, AUCTION_DURATION_MS)
    emitChange()

    return { kind: 'started', snapshot: toSnapshot(auction) }
  })
}

/** Cancels the running auction, releasing the leading bidder's hold. Returns the player's name. */
export function cancelAuction(): Promise<string | null> {
  return withLock(() => {
    const auction = current
    if (!auction) return null

    if (auction.timer) clearTimeout(auction.timer)
    if (auction.highestBidder) release(auction.highestBidder)
    current = null
    emitChange()

    return auction.subject.username
  })
}

/**
 * Validates and applies a bid. Every rejection path leaves the auction untouched, so a bad bid can
 * never disturb the current leader or their reserved funds.
 *
 * Bids only come from the dashboard, where the bidder is the signed-in session rather than whoever
 * typed in a channel - so there is no channel to check them against.
 *
 * The bidder may be the captain or the team's stand-in. Either way the bid is the *captain's*: it is
 * held on the captain's purse and led under the captain's Discord ID, so the two of them can never
 * outbid each other, and whatever is won lands on the captain's roster.
 */
export function submitBid(bidderId: string, amount: number): Promise<BidResult> {
  return withLock(async (): Promise<BidResult> => {
    const auction = current
    if (!auction) return 'NO_AUCTION'

    const tournament = getTournament()
    const captain = captainForBidder(tournament, bidderId)
    if (!captain) return 'NOT_CAPTAIN'

    // Purses are keyed by Discord ID, and a stand-in has none of their own to fall back on.
    const purseId = captain.discordId
    if (!purseId) return 'CAPTAIN_UNLINKED'

    if (auction.highestBidder === purseId) return 'ALREADY_HIGHEST'

    // A roster at the largest legal team is closed - there is nowhere to put another player.
    const bought = tournament.rosters[captain.osuId]?.length ?? 0
    if (bought >= Math.max(tournament.teamSize - 1, 0)) return 'TEAM_FULL'

    if (amount > auction.maxBid) return 'ABOVE_MAX'
    if (auction.highestBidder == null && amount < auction.startingBid) return 'BELOW_STARTING'
    if (auction.highestBidder != null && amount <= auction.highestBid) return 'NOT_HIGHER'

    // Opening bids are measured against the starting price, later ones against the standing bid, so
    // the ceiling on a raise applies from the very first offer rather than only once someone leads.
    const standing = auction.highestBidder == null ? auction.startingBid : auction.highestBid

    if (auction.highestBidder != null && amount - standing < Math.max(tournament.minBidIncrement, 1)) {
      return 'BELOW_MIN_STEP'
    }

    if (tournament.maxBidIncrement > 0 && amount - standing > tournament.maxBidIncrement) {
      return 'ABOVE_MAX_STEP'
    }

    // Plain affordability first: a captain who cannot cover the bid at all is not being held back by
    // the reserve, and saying so would send them looking for a rule that isn't the problem.
    if (getBalance(purseId) < amount) return 'INSUFFICIENT_FUNDS'

    // Winning must still leave enough to fill the roster to the smallest legal team.
    if (getBalance(purseId) - amount < reserveFor(tournament, captain.osuId)) return 'BREAKS_RESERVE'

    if (!reserve(purseId, amount)) return 'INSUFFICIENT_FUNDS'

    // The previous leader has been outbid - give them their funds back.
    if (auction.highestBidder) release(auction.highestBidder)

    auction.highestBid = amount
    auction.highestBidder = purseId

    const via = bidderId === purseId ? '' : ` (via <@${bidderId}>)`
    await updateMessage(auction, `Current highest bid: ${amount} by <@${purseId}>${via}`)

    if (auction.highestBid >= auction.maxBid) await end(auction)
    else if (auction.endsAt - Date.now() < BID_EXTENSION_MS) scheduleTimer(auction, BID_EXTENSION_MS)

    emitChange()

    return 'ACCEPTED'
  })
}

/** Releases everything the running auction holds - used when the process is going away. */
export function shutdownAuction(): void {
  if (!current) return

  if (current.timer) clearTimeout(current.timer)
  if (current.highestBidder) release(current.highestBidder)
  current = null
}

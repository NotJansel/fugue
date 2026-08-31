import { Routes } from 'discord.js'
import type { AuctionSnapshot } from '#shared/types'
import { auctionCard, getClient } from '../bot/client'
import { emitChange } from './bus'
import { getAllBalances, release, reserve, settleHold } from './purse-store'
import { recordSale } from './tournament-store'

/** The player being auctioned, as supplied by whoever started the auction. */
export interface AuctionSubject {
  osuId: string
  username: string
  ppRaw: number
  ppRank: number
  seed: number
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

const BID_TIMEOUT_MS = 15_000

interface AuctionState {
  messageId: string
  channelId: string
  subject: AuctionSubject
  startingBid: number
  maxBid: number
  highestBid: number
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

async function announce(auction: AuctionState, result: string): Promise<void> {
  const client = getClient()
  if (!client) return

  const balances = Object.entries(getAllBalances())
  const purseSummary = balances.length === 0
    ? 'No purses set.'
    : balances.sort((a, b) => b[1] - a[1]).map(([id, amount]) => `<@${id}>: ${amount}`).join('\n')

  try {
    await client.rest.post(Routes.channelMessages(auction.channelId), {
      body: { content: `${result}\n\nPurses:\n${purseSummary}` }
    })
  } catch (error) {
    console.error(`[auction] Failed to announce the result in ${auction.channelId}:`, error)
  }
}

/** Must only be called from inside `withLock`. */
function scheduleTimer(auction: AuctionState): void {
  if (auction.timer) clearTimeout(auction.timer)

  auction.endsAt = Date.now() + BID_TIMEOUT_MS
  auction.timer = setTimeout(() => {
    void withLock(() => end(auction)).then(() => emitChange())
  }, BID_TIMEOUT_MS)
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

  await announce(auction, result)
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
    scheduleTimer(auction)
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
 */
export function submitBid(bidderId: string, amount: number): Promise<BidResult> {
  return withLock(async (): Promise<BidResult> => {
    const auction = current
    if (!auction) return 'NO_AUCTION'
    if (auction.highestBidder === bidderId) return 'ALREADY_HIGHEST'
    if (amount > auction.maxBid) return 'ABOVE_MAX'
    if (auction.highestBidder == null && amount < auction.startingBid) return 'BELOW_STARTING'
    if (amount <= auction.highestBid) return 'NOT_HIGHER'
    if (!reserve(bidderId, amount)) return 'INSUFFICIENT_FUNDS'

    // The previous leader has been outbid - give them their funds back.
    if (auction.highestBidder) release(auction.highestBidder)

    auction.highestBid = amount
    auction.highestBidder = bidderId

    await updateMessage(auction, `Current highest bid: ${amount} by <@${bidderId}>`)

    if (auction.highestBid >= auction.maxBid) await end(auction)
    else scheduleTimer(auction)

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

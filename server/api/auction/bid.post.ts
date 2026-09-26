import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { submitBid } from '../../utils/auction'
import { apiError } from '../../utils/http-error'
import { requireSession } from '../../utils/session'

/** Why a bid did not take, in the caller's terms. */
const rejections: Record<string, { status: number, reason: string, code: string }> = {
  NO_AUCTION: { status: 409, reason: 'No auction is currently running.', code: 'err.auction.none' },
  CLOSED: { status: 409, reason: 'Too late - the clock has run out.', code: 'err.bid.closed' },
  NOT_CAPTAIN: { status: 403, reason: 'Only captains can bid.', code: 'err.bid.notCaptain' },
  CAPTAIN_UNLINKED: {
    status: 409,
    reason: 'The captain you bid for has no Discord account linked, so there is no purse to bid from.',
    code: 'err.bid.captainUnlinked'
  },
  TEAM_FULL: { status: 409, reason: 'Your team is already full.', code: 'err.bid.teamFull' },
  BELOW_MIN_STEP: { status: 400, reason: 'That does not raise the bid by enough.', code: 'err.bid.minStep' },
  ABOVE_MAX_STEP: { status: 400, reason: 'That raises the bid by too much at once.', code: 'err.bid.maxStep' },
  BREAKS_RESERVE: {
    status: 400,
    reason: 'You have to keep enough gold to fill your team to its smallest legal size.',
    code: 'err.bid.reserve'
  },
  ALREADY_HIGHEST: { status: 409, reason: 'You are already the highest bidder.', code: 'err.bid.leading' },
  ABOVE_MAX: { status: 400, reason: 'That is above the maximum bid for this player.', code: 'err.bid.aboveMax' },
  BELOW_STARTING: { status: 400, reason: 'The first bid has to meet the starting price.', code: 'err.bid.belowStart' },
  NOT_HIGHER: { status: 409, reason: 'Someone already bid that much - go higher.', code: 'err.bid.notHigher' },
  INSUFFICIENT_FUNDS: { status: 400, reason: 'Your purse does not cover that bid.', code: 'err.bid.funds' }
}

/**
 * The only way to bid.
 *
 * Unlike every other write here this is not admin-only - it is captain-only, or for the one stand-in
 * an organiser named for a team, and the bidder is taken from the session rather than the request, so
 * nobody can bid as someone else or spend a purse that isn't theirs or their team's.
 */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  const session = await requireSession(event)
  const amount = Math.trunc(Number((await readBody<{ amount: number }>(event)).amount))

  if (!Number.isFinite(amount)) throw apiError(400, 'That is not a bid.', 'err.bid.notANumber')

  // Every other rule lives in the auction service, and so does this one - the dashboard is not the
  // only thing that could ever call in, and one place deciding what a legal bid is beats two.
  const result = await submitBid(session.id, amount)

  if (result !== 'ACCEPTED') {
    const rejection = rejections[result]!
    throw apiError(rejection.status, rejection.reason, rejection.code)
  }

  return { ok: true, message: `Bid of ${amount}€ accepted.`, code: 'ok.bid', args: { amount: `${amount}` } }
})

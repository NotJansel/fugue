import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { submitBid } from '../../utils/auction'
import { apiError } from '../../utils/http-error'
import { requireSession } from '../../utils/session'
import { captainForDiscordId } from '../../utils/tournament-model'
import { getTournament } from '../../utils/tournament-store'

/** Why a bid did not take, in the caller's terms. */
const rejections: Record<string, { status: number, reason: string, code: string }> = {
  NO_AUCTION: { status: 409, reason: 'No auction is currently running.', code: 'err.auction.none' },
  ALREADY_HIGHEST: { status: 409, reason: 'You are already the highest bidder.', code: 'err.bid.leading' },
  ABOVE_MAX: { status: 400, reason: 'That is above the maximum bid for this player.', code: 'err.bid.aboveMax' },
  BELOW_STARTING: { status: 400, reason: 'The first bid has to meet the starting price.', code: 'err.bid.belowStart' },
  NOT_HIGHER: { status: 409, reason: 'Someone already bid that much - go higher.', code: 'err.bid.notHigher' },
  INSUFFICIENT_FUNDS: { status: 400, reason: 'Your purse does not cover that bid.', code: 'err.bid.funds' }
}

/**
 * The only way to bid.
 *
 * Unlike every other write here this is not admin-only - it is captain-only, and the bidder is taken
 * from the session rather than the request, so nobody can bid as someone else or spend a purse that
 * isn't theirs.
 */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  const session = await requireSession(event)
  const amount = Math.trunc(Number((await readBody<{ amount: number }>(event)).amount))

  if (!Number.isFinite(amount)) throw apiError(400, 'That is not a bid.', 'err.bid.notANumber')

  if (!captainForDiscordId(getTournament(), session.id)) {
    throw apiError(403, 'Only captains can bid.', 'err.bid.notCaptain')
  }

  const result = await submitBid(session.id, amount)

  if (result !== 'ACCEPTED') {
    const rejection = rejections[result]!
    throw apiError(rejection.status, rejection.reason, rejection.code)
  }

  return { ok: true, message: `Bid of ${amount}€ accepted.`, code: 'ok.bid', args: { amount: `${amount}` } }
})

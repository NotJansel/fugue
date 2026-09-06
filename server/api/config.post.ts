import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { requireAdmin } from '../utils/session'
import { updateTournamentConfig } from '../utils/tournament-store'

interface Body {
  teamSize?: number | null
  minTeamSize?: number | null
  fieldSize?: number | null
  /** Set to drop the field cut and let every imported player take part again. */
  wholeField?: boolean
  captainCount?: number | null
  /** Set to drop a pinned captain count and go back to deriving it from the team size. */
  autoCaptainCount?: boolean
  defaultStartingBid?: number | null
  defaultMaxBid?: number | null
  minBidIncrement?: number | null
  maxBidIncrement?: number | null
  secondRun?: boolean | null
}

export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<Body>(event)

  await updateTournamentConfig({
    teamSize: body.teamSize,
    minTeamSize: body.minTeamSize,
    fieldSize: body.fieldSize,
    clearFieldSize: body.wholeField === true,
    captainCountOverride: body.captainCount,
    clearCaptainCountOverride: body.autoCaptainCount === true,
    defaultStartingBid: body.defaultStartingBid,
    defaultMaxBid: body.defaultMaxBid,
    minBidIncrement: body.minBidIncrement,
    maxBidIncrement: body.maxBidIncrement,
    secondRun: body.secondRun
  })

  return { ok: true }
})

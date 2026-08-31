import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { requireAdmin } from '../utils/session'
import { updateTournamentConfig } from '../utils/tournament-store'

interface Body {
  teamSize?: number | null
  captainCount?: number | null
  /** Set to drop a pinned captain count and go back to deriving it from the team size. */
  autoCaptainCount?: boolean
  defaultStartingBid?: number | null
  defaultMaxBid?: number | null
}

export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<Body>(event)

  await updateTournamentConfig({
    teamSize: body.teamSize,
    captainCountOverride: body.captainCount,
    clearCaptainCountOverride: body.autoCaptainCount === true,
    defaultStartingBid: body.defaultStartingBid,
    defaultMaxBid: body.defaultMaxBid
  })

  return { ok: true }
})

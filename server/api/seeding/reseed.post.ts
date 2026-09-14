import { defineEventHandler } from 'h3'
import type { ApiOk } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { allLobbyScores } from '../../utils/lobby-store'
import { requireAdmin } from '../../utils/session'
import { getTournament, reseedByZSum } from '../../utils/tournament-store'

/**
 * Puts the seeding in Z-sum order now.
 *
 * The lobby watch does this on its own whenever results change, but an organiser who has dragged
 * rows around, or unlocked the seeding after a sheet import, wants a way back to what the results say.
 */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  if (getTournament().seedingLocked) {
    throw apiError(409, 'Seeding is locked - unlock it to make changes.', 'err.seeding.locked')
  }

  const moved = await reseedByZSum(allLobbyScores())

  return moved
    ? { ok: true, message: 'Seeding now follows the Z-sum.', code: 'ok.reseeded' }
    : { ok: true, message: 'The seeding already follows the Z-sum.', code: 'ok.reseedUnchanged' }
})

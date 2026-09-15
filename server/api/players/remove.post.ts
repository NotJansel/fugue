import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { requireAdmin } from '../../utils/session'
import { getTournament, removePlayer } from '../../utils/tournament-store'

/**
 * Takes a player off the list - staff who played the qualifiers, say. They are kept aside so a
 * re-import does not bring them back, and can be restored from Setup.
 */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<{ osuId?: string }>(event)

  if (getTournament().seedingLocked) {
    throw apiError(409, 'Seeding is locked - unlock it to make changes.', 'err.seeding.locked')
  }

  const player = getTournament().players.find(candidate => candidate.osuId === body.osuId)
  if (!player || !(await removePlayer(player.osuId))) {
    throw apiError(404, 'That player isn\'t in the tournament.', 'err.player.unknown')
  }

  return {
    ok: true,
    message: `Removed ${player.username} from the player list.`,
    code: 'ok.player.removed',
    args: { name: player.username }
  }
})

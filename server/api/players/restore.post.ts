import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { requireAdmin } from '../../utils/session'
import { getTournament, restorePlayer } from '../../utils/tournament-store'

/** Puts a removed player back on the list, at the bottom of the seeding. */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<{ osuId?: string }>(event)

  if (getTournament().seedingLocked) {
    throw apiError(409, 'Seeding is locked - unlock it to make changes.', 'err.seeding.locked')
  }

  const player = getTournament().removedPlayers.find(candidate => candidate.osuId === body.osuId)
  if (!player || !(await restorePlayer(player.osuId))) {
    throw apiError(404, 'That player was not removed.', 'err.player.notRemoved')
  }

  return {
    ok: true,
    message: `Restored ${player.username} to the player list.`,
    code: 'ok.player.restored',
    args: { name: player.username }
  }
})

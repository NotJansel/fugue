import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { requireAdmin } from '../../utils/session'
import { clearPass, getTournament } from '../../utils/tournament-store'

/** Lets a player nobody bid on be offered again in this run - for an auction that ran out by mistake. */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<{ osuId?: string }>(event)
  const player = getTournament().players.find(candidate => candidate.osuId === body.osuId)

  if (!player || !(await clearPass(player.osuId))) {
    throw apiError(404, 'That player was not passed over in this run.', 'err.player.notPassed')
  }

  return {
    ok: true,
    message: `${player.username} can be offered again in this run.`,
    code: 'ok.player.unpassed',
    args: { name: player.username }
  }
})

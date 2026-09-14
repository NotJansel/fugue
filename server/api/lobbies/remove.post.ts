import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { dropLobby } from '../../utils/qualifier-lobbies'
import { requireAdmin } from '../../utils/session'

/** Takes a lobby and every score read from it off file - a warm-up lobby added by mistake, say. */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<{ matchId?: number }>(event)
  const matchId = Number(body.matchId)

  if (!Number.isInteger(matchId) || !(await dropLobby(matchId))) {
    throw apiError(404, 'That lobby is not on file.', 'err.lobby.notOnFile')
  }

  return { ok: true, message: `Removed lobby ${matchId} and its scores.`, code: 'ok.lobby.removed', args: { id: `${matchId}` } }
})

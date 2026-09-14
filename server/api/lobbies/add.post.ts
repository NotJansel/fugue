import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { addLobby } from '../../utils/qualifier-lobbies'
import { requireAdmin } from '../../utils/session'

/**
 * Adds a qualifier lobby by its osu! link and reads its scores straight away - for a lobby the
 * watch could not find by name, or one played outside the window it looks in.
 */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<{ url?: string }>(event)
  const result = await addLobby(body.url ?? '')

  if (result === 'unavailable') {
    throw apiError(
      503,
      'The osu! API application is not configured - set OSU_CLIENT_ID and OSU_CLIENT_SECRET.',
      'err.osu.notConfigured'
    )
  }

  if (result === 'invalid') {
    throw apiError(400, 'That doesn\'t look like an osu! match link or ID.', 'err.lobby.url')
  }

  if (result === 'unknown') {
    throw apiError(404, 'osu! knows no lobby by that ID.', 'err.lobby.unknown')
  }

  const args = { name: result.lobby.name, id: `${result.lobby.matchId}` }

  return result.added
    ? { ok: true, message: `Added lobby ${args.name} (${args.id}) and read its scores.`, code: 'ok.lobby.added', args }
    : { ok: true, message: `Lobby ${args.name} (${args.id}) is already on file.`, code: 'ok.lobby.known', args }
})

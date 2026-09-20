import { defineEventHandler, readBody } from 'h3'
import type { ApiOk, TournamentPlayer } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { fetchOsuUser, osuApiReady } from '../../utils/osu-api'
import { requireAdmin } from '../../utils/session'
import { addPlayer, getTournament } from '../../utils/tournament-store'

/**
 * Puts a player on the list by hand, by osu! ID or username.
 *
 * Neither import can be talked into adding one person - the qualifier sheet replaces the whole list
 * and the registration sheet only knows who signed up - so this is what a tournament uses for a late
 * entry, and what a test run uses to get a field together without a sheet at all. The player is
 * looked up first, so they land with the same ID, name and country an import would have given them.
 */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<{ user?: string }>(event)
  const query = (body.user ?? '').trim()

  if (query === '') throw apiError(400, 'Name an osu! player to add.', 'err.player.noQuery')

  if (getTournament().seedingLocked) {
    throw apiError(409, 'Seeding is locked - unlock it to make changes.', 'err.seeding.locked')
  }

  if (!osuApiReady()) {
    throw apiError(
      503,
      'The osu! API application is not configured - set OSU_CLIENT_ID and OSU_CLIENT_SECRET.',
      'err.osu.notConfigured'
    )
  }

  const found = await fetchOsuUser(query)
  if (!found) throw apiError(404, `osu! knows no player called ${query}.`, 'err.player.noSuchOsu', { name: query })

  const player: TournamentPlayer = {
    osuId: found.userId,
    username: found.username,
    ppRaw: found.ppRaw,
    ppRank: found.ppRank,
    countryCode: found.countryCode,
    captainMode: 'AUTO',
    extra: {}
  }

  const args = { name: found.username }

  return await addPlayer(player)
    ? { ok: true, message: `Added ${found.username} at the bottom of the seeding.`, code: 'ok.player.added', args }
    : { ok: true, message: `${found.username} is already on the list.`, code: 'ok.player.known', args }
})

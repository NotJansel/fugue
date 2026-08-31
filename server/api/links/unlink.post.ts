import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { discordIdForOsuId, unlinkOsuAccount } from '../../utils/osu-link-store'
import { requireAdmin } from '../../utils/session'
import { getTournament, setDiscordId } from '../../utils/tournament-store'

/** Frees an osu! account that was linked to the wrong Discord user, so it can be claimed again. */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const { osuId } = await readBody<{ osuId: string }>(event)
  const discordId = discordIdForOsuId(osuId)

  if (discordId == null) {
    throw apiError(404, 'That osu! account is not linked to anyone.', 'err.link.none')
  }

  await unlinkOsuAccount(discordId)

  // The Discord link only existed because of the osu! login, so it goes with it - otherwise whoever
  // linked by mistake would keep the ability to bid for that player.
  const player = getTournament().players.find(entry => entry.osuId === osuId)
  if (player?.discordId === discordId) await setDiscordId(osuId, null)

  return { ok: true, message: 'Unlinked the osu! account - they can link again.', code: 'ok.unlinked' }
})

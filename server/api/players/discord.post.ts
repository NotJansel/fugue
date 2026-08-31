import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { requireAdmin } from '../../utils/session'
import { setDiscordId } from '../../utils/tournament-store'

/** Sets the Discord account a player controls by hand - the fallback when they can't link it. */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<{ osuId: string, discordId?: string | null }>(event)
  const discordId = body.discordId?.trim() || null

  if (discordId != null && !/^\d{5,}$/.test(discordId)) {
    throw apiError(400, 'That isn\'t a Discord user ID.', 'err.discord.invalid')
  }

  await setDiscordId(body.osuId, discordId)

  return { ok: true }
})

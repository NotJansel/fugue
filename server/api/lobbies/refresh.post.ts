import { defineEventHandler } from 'h3'
import type { ApiOk } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { rereadLobbies } from '../../utils/qualifier-lobbies'
import { requireAdmin } from '../../utils/session'

/**
 * Reads every lobby on file again from its first event, rather than from where the last read stopped.
 *
 * What this is for is a read that was wrong or incomplete when it happened - scores on file from
 * before the player's own mods were kept, say, which no later poll would go back far enough to fix.
 * Scoring rules are not among those: a multiplier is applied on every dashboard build, so changing
 * one needs nothing re-read.
 */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const result = await rereadLobbies()

  if (result === 'unavailable') {
    throw apiError(
      503,
      'The osu! API application is not configured - set OSU_CLIENT_ID and OSU_CLIENT_SECRET.',
      'err.osu.notConfigured'
    )
  }

  const args = { count: `${result.lobbies}` }

  return result.changed
    ? { ok: true, message: `Read ${args.count} lobbies again and updated their scores.`, code: 'ok.lobbies.reread', args }
    : { ok: true, message: `Read ${args.count} lobbies again; nothing had changed.`, code: 'ok.lobbies.rereadSame', args }
})

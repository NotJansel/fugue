import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { requireAdmin } from '../../utils/session'
import { getTournament, setDescriptionOverride } from '../../utils/tournament-store'

/**
 * Overrides the description a player is shown with, or with `description: null` goes back to the
 * sheet's. The sheet's own text is kept either way, and a later import refreshes it underneath
 * without touching the override.
 *
 * Not refused while the seeding is locked: it changes what a player is shown with, not the list.
 */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<{ osuId: string, description?: string | null }>(event)
  const player = getTournament().players.find(candidate => candidate.osuId === body.osuId)

  if (!player) throw apiError(404, 'That player isn\'t in the tournament.', 'err.player.unknown')

  const description = typeof body.description === 'string' ? body.description : null
  await setDescriptionOverride(player.osuId, description)

  return description == null
    ? {
        ok: true,
        message: `${player.username} is shown with their own description again.`,
        code: 'ok.description.reset',
        args: { name: player.username }
      }
    : {
        ok: true,
        message: `Saved the description for ${player.username}.`,
        code: 'ok.description.set',
        args: { name: player.username }
      }
})

import { defineEventHandler } from 'h3'
import type { ApiOk } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { osuApiReady } from '../../utils/osu-api'
import { saveMappool } from '../../utils/mappool'
import { requireAdmin } from '../../utils/session'
import { getTournament } from '../../utils/tournament-store'

/**
 * Re-asks the osu! API about every slot in the pool, cache and all.
 *
 * Ratings move on their own - a map gets reranked, or the difficulty algorithm changes - and a pool
 * put together before its slots knew their mods is still rated as though everything were no-mod. This
 * is how such a pool catches up without an organiser having to touch every row.
 */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  if (!osuApiReady()) {
    throw apiError(
      400,
      'The osu! API application is not configured, so beatmaps cannot be looked up.',
      'err.osu.notConfigured'
    )
  }

  const refreshed = await saveMappool(getTournament().mappool, null, true)
  const rated = refreshed.filter(map => map.stars != null).length

  return {
    ok: true,
    message: `Re-rated ${rated} of ${refreshed.length} map(s).`,
    code: 'ok.mappool.refreshed',
    args: { rated: `${rated}`, count: `${refreshed.length}` }
  }
})

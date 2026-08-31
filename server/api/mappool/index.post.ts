import { defineEventHandler, readBody } from 'h3'
import type { ApiOk, QualifierMap } from '#shared/types'
import { saveMappool } from '../../utils/mappool'
import { requireAdmin } from '../../utils/session'

/**
 * Saves the pool as one list.
 *
 * Slots keep their id across saves so the results already on screen stay attached to the right map
 * while an organiser is still editing labels around them.
 */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<{ maps: QualifierMap[] }>(event)
  const saved = await saveMappool(body.maps ?? [])

  return {
    ok: true,
    message: `Saved a mappool of ${saved.length} map(s).`,
    code: 'ok.mappool.saved',
    args: { count: `${saved.length}` }
  }
})

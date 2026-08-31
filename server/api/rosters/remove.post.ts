import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { requireAdmin } from '../../utils/session'
import { removeFromRoster } from '../../utils/tournament-store'

/** Undoes a mis-recorded auction. The purse is not refunded - set the balance if that is wanted. */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<{ captainOsuId: string, osuId: string }>(event)
  await removeFromRoster(body.captainOsuId, body.osuId)

  return { ok: true }
})

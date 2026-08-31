import { defineEventHandler } from 'h3'
import type { ApiOk } from '#shared/types'
import { requireAdmin } from '../../utils/session'
import { clearRosters } from '../../utils/tournament-store'

export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)
  await clearRosters()

  return { ok: true }
})

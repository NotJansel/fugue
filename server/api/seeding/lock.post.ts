import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { requireAdmin } from '../../utils/session'
import { setSeedingLocked } from '../../utils/tournament-store'

export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<{ locked: boolean }>(event)
  await setSeedingLocked(Boolean(body.locked))

  return { ok: true }
})

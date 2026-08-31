import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { requireAdmin } from '../../utils/session'
import { setTeamName } from '../../utils/tournament-store'

export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<{ captainOsuId: string, name?: string | null }>(event)
  await setTeamName(body.captainOsuId, body.name ?? null)

  return { ok: true }
})

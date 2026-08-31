import { defineEventHandler, readBody } from 'h3'
import type { ApiOk, CaptainMode } from '#shared/types'
import { requireAdmin } from '../../utils/session'
import { setCaptainMode } from '../../utils/tournament-store'

export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<{ osuId: string, mode: CaptainMode }>(event)
  await setCaptainMode(body.osuId, body.mode)

  return { ok: true }
})

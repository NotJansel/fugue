import { defineEventHandler } from 'h3'
import type { ApiOk } from '#shared/types'
import { clearBroadcast } from '../../utils/broadcast'
import { apiError } from '../../utils/http-error'
import { requireAdmin } from '../../utils/session'

/** Takes the last broadcast down on every open dashboard, however long it was meant to stay up. */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  if (!clearBroadcast()) throw apiError(409, 'There is no message up.', 'err.broadcast.none')

  return { ok: true, message: 'Message removed for everyone.', code: 'ok.broadcast.cleared' }
})

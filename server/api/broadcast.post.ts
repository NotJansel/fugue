import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { BROADCAST_MAX_LENGTH, sendBroadcast } from '../utils/broadcast'
import { apiError } from '../utils/http-error'
import { requireAdmin } from '../utils/session'

/** Shows an organiser's message on every open dashboard - guests, captains and organisers alike. */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  const user = await requireAdmin(event)

  const body = await readBody<{ message?: string }>(event)
  const message = body.message?.trim() ?? ''

  if (!message) throw apiError(400, 'The message is empty.', 'err.broadcast.empty')

  if (message.length > BROADCAST_MAX_LENGTH) {
    throw apiError(400, `A message can be at most ${BROADCAST_MAX_LENGTH} characters.`, 'err.broadcast.tooLong', {
      max: String(BROADCAST_MAX_LENGTH)
    })
  }

  sendBroadcast(message, user.osuUsername ?? user.username)

  return { ok: true, message: 'Sent to everyone.', code: 'ok.broadcast.sent' }
})

import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { BROADCAST_MAX_LENGTH, BROADCAST_MAX_SECONDS, sendBroadcast } from '../utils/broadcast'
import { apiError } from '../utils/http-error'
import { requireAdmin } from '../utils/session'

/** Shows an organiser's message on every open dashboard - guests, captains and organisers alike. */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  const user = await requireAdmin(event)

  const body = await readBody<{ message?: string, durationSeconds?: number | null }>(event)
  const message = body.message?.trim() ?? ''

  if (!message) throw apiError(400, 'The message is empty.', 'err.broadcast.empty')

  if (message.length > BROADCAST_MAX_LENGTH) {
    throw apiError(400, `A message can be at most ${BROADCAST_MAX_LENGTH} characters.`, 'err.broadcast.tooLong', {
      max: String(BROADCAST_MAX_LENGTH)
    })
  }

  // Left out, or 0: up until each viewer closes it.
  const seconds = body.durationSeconds ?? 0

  if (!Number.isInteger(seconds) || seconds < 0 || seconds > BROADCAST_MAX_SECONDS) {
    throw apiError(400, `Show it for between 0 and ${BROADCAST_MAX_SECONDS} seconds.`, 'err.broadcast.duration', {
      max: String(BROADCAST_MAX_SECONDS)
    })
  }

  sendBroadcast(message, user.osuUsername ?? user.username, seconds > 0 ? seconds * 1000 : null)

  return { ok: true, message: 'Sent to everyone.', code: 'ok.broadcast.sent' }
})

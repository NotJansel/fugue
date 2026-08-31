import { createError } from 'h3'
import type { ApiError } from '#shared/types'

/**
 * An error the dashboard can show.
 *
 * The payload carries English prose *and* a dictionary `code` with its arguments, so the message can
 * be shown in the user's language while the response stays readable on its own - in a log, or to any
 * other caller of this API. The client falls back to the prose for a code it doesn't know.
 */
export function apiError(
  statusCode: number,
  error: string,
  code?: string,
  args: Record<string, string> = {},
  link?: string
) {
  const payload: ApiError = { error, code, args, link }

  return createError({ statusCode, statusMessage: error, data: payload })
}

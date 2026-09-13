import { defineEventHandler } from 'h3'
import type { ApiOk } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { refreshSchedule, scheduleUrl } from '../../utils/schedule-store'
import { requireAdmin } from '../../utils/session'

/** Re-reads the schedule sheet now, for an organiser who doesn't want to wait out the five minutes. */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  if (scheduleUrl() == null) {
    throw apiError(400, 'No schedule sheet is set.', 'err.schedule.notConfigured')
  }

  const failure = await refreshSchedule()
  if (failure) throw apiError(502, failure.error, failure.code, failure.args)

  return { ok: true, message: 'Schedule re-read.', code: 'ok.schedule.refreshed' }
})

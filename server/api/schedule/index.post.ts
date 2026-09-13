import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { parseSchedule } from '../../utils/schedule'
import { setScheduleSheet } from '../../utils/schedule-store'
import { requireAdmin } from '../../utils/session'
import { fetchGrid } from '../../utils/sheets'

interface Body {
  url?: string | null
}

/** Sets the sheet the schedule page is read from - or, given a blank link, stops showing one. */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const url = (await readBody<Body>(event)).url?.trim() || null

  if (url == null) {
    await setScheduleSheet(null, [])

    return { ok: true, message: 'The schedule is no longer shown.', code: 'ok.schedule.cleared' }
  }

  // Read before saving, so a link to the wrong tab is refused here rather than publishing an empty page.
  const sections = parseSchedule(await fetchGrid(url))

  if (sections.length === 0) {
    throw apiError(
      400,
      'No schedule found on that tab - make sure the link points at the schedule tab.',
      'err.schedule.empty'
    )
  }

  await setScheduleSheet(url, sections)

  const rows = sections.reduce((total, section) => total + section.rows.length, 0)

  return {
    ok: true,
    message: `Found ${sections.length} schedule(s) with ${rows} entries.`,
    code: 'ok.schedule.saved',
    args: { sections: `${sections.length}`, rows: `${rows}` }
  }
})

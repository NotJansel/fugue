import type { ApiError, ScheduleDto, ScheduleSection } from '#shared/types'
import { emitChange } from './bus'
import { query } from './db'
import { parseSchedule } from './schedule'
import { fetchGrid } from './sheets'
import { serialiser } from './store-queue'

/**
 * The published schedule: which sheet it lives in, and what was last read from it.
 *
 * Only the link is stored - a `schedule` row in `sheet_config`, which no other store touches. The
 * sections are read again at boot and every five minutes after, so an organiser editing the sheet sees
 * the website follow without anyone pressing anything. A refresh that fails keeps the last good
 * schedule up and records why, rather than blanking the page in the middle of an event.
 */
const REFRESH_MS = 5 * 60_000

let url: string | null = null
let sections: ScheduleSection[] = []
let fetchedAt: number | null = null
let failure: ApiError | null = null

let timer: NodeJS.Timeout | null = null
let inFlight: Promise<ApiError | null> | null = null

const write = serialiser()

export async function loadSchedule(): Promise<void> {
  const rows = await query<{ url: string }>('SELECT url FROM sheet_config WHERE kind = $1', ['schedule'])

  url = rows[0]?.url ?? null
  restartRefresh(true)
}

export const scheduleUrl = (): string | null => url

export function scheduleDto(guest: boolean): ScheduleDto | null {
  if (url == null) return null

  return { url: guest ? null : url, sections, fetchedAt, error: guest ? null : failure }
}

/** Reads the sheet again now. Callers arriving while a read is running share that read. */
export function refreshSchedule(): Promise<ApiError | null> {
  inFlight ??= read().finally(() => {
    inFlight = null
  })

  return inFlight
}

async function read(): Promise<ApiError | null> {
  const source = url
  if (source == null) return null

  try {
    const parsed = parseSchedule(await fetchGrid(source))

    // The link can change while the sheet is downloading; a read of the old one must not land on it.
    if (url !== source) return null

    sections = parsed
    fetchedAt = Date.now()
    failure = null
  } catch (error) {
    if (url !== source) return null

    const data = (error as { data?: ApiError }).data
    failure = data?.error ? data : { error: error instanceof Error ? error.message : String(error) }

    console.warn(`[schedule] Could not re-read ${source}: ${failure.error}`)
  }

  emitChange()

  return failure
}

function restartRefresh(readNow: boolean): void {
  stopScheduleRefresh()
  if (url == null) return

  if (readNow) void refreshSchedule()

  timer = setInterval(() => void refreshSchedule(), REFRESH_MS)
  timer.unref()
}

export function stopScheduleRefresh(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/**
 * Points the schedule at a sheet, or with `null` stops publishing one.
 *
 * `initial` is what the caller already read from it while checking the link, so saving does not
 * download the sheet a second time; the five-minute cycle starts over from here.
 */
export async function setScheduleSheet(next: string | null, initial: ScheduleSection[]): Promise<void> {
  await write(async () => {
    if (next == null) {
      await query('DELETE FROM sheet_config WHERE kind = $1', ['schedule'])
    } else {
      await query(
        `INSERT INTO sheet_config (kind, url, mapping) VALUES ('schedule', $1, '{}'::jsonb)
         ON CONFLICT (kind) DO UPDATE SET url = EXCLUDED.url`,
        [next]
      )
    }

    url = next
    sections = next == null ? [] : initial
    fetchedAt = next == null ? null : Date.now()
    failure = null
  })

  restartRefresh(false)
  emitChange()
}

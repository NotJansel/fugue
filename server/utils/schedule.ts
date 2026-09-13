import type { ScheduleColumn, ScheduleRow, ScheduleSection } from '#shared/types'
import type { GridRow } from './sheets'

/**
 * Reads the schedules out of a schedule tab.
 *
 * These tabs are laid out for people, not machines: decorative borders, banners, and several
 * schedules stacked on one tab, each a heading ("GRAND FINALS", "Qualifiers Schedule") with a header
 * row under it and its rows under that. Headings of rounds that haven't been scheduled yet sit there
 * with nothing beneath them. So a section is found by its heading - a row with one short cell in it -
 * and only kept once it has a header row and at least one row of data.
 */
export function parseSchedule(grid: GridRow[], now = Date.now()): ScheduleSection[] {
  const sections: ScheduleSection[] = []
  let pending: Pending | null = null

  for (const { row } of grid) {
    const cells = row.map(cell => cell.trim()).map(cell => meaningful(cell) ? cell : '')
    const filled = cells.flatMap((cell, index) => cell === '' ? [] : [index])
    if (filled.length === 0) continue

    const headerIndexes = pending?.header?.map(entry => entry.index) ?? []

    if (filled.length === 1 && isHeading(cells[filled[0]!]!, filled[0]!, pending, headerIndexes)) {
      if (pending) sections.push(...finish(pending, now))
      pending = { title: cells[filled[0]!]!, header: null, rows: [] }
      continue
    }

    // A table with no heading over it at all is still a schedule, just an untitled one.
    pending ??= { title: '', header: null, rows: [] }

    if (pending.header == null) {
      if (filled.length >= 2) pending.header = filled.map(index => ({ index, label: cells[index]! }))
      continue
    }

    if (filled.some(index => headerIndexes.includes(index))) pending.rows.push(cells)
  }

  if (pending) sections.push(...finish(pending, now))

  return sections
}

interface Pending {
  title: string
  header: { index: number, label: string }[] | null
  rows: string[][]
}

const HEADING_MAX_LENGTH = 60

/** A cell with no letter or digit in it is decoration - box-drawing borders, arrows, shading. */
const meaningful = (cell: string): boolean => /[\p{L}\p{N}]/u.test(cell)

/**
 * Whether a one-cell row starts a new schedule rather than being a sparse row of the current one.
 *
 * It is a heading when there is no header to belong to yet, when it sits outside the header's columns,
 * or when it is written in capitals the way round names are - a lone match ID in the ID column is not.
 */
function isHeading(cell: string, index: number, pending: Pending | null, headerIndexes: number[]): boolean {
  if (cell.length > HEADING_MAX_LENGTH) return false
  if (pending?.header == null || !headerIndexes.includes(index)) return true

  return cell === cell.toUpperCase() && /\p{Lu}{3}/u.test(cell)
}

/** "S1", "S12", "Team 2", "Player #3" - numbered slots that read better as one list. */
const slotPattern = /^(\p{L}[\p{L} ]{0,15}?)\s*#?\s*(\d{1,2})$/u

const idAliases = ['match id', 'matchid', 'match', 'id', 'lobby', 'lobby id', 'match nr', 'nr', '#']
const dateAliases = ['datum', 'date', 'day', 'tag']
const timeAliases = ['zeit', 'time', 'uhrzeit', 'start', 'startzeit']

/** A header without its parenthesised note: "Zeit (CEST)" names the time column. */
const bareLabel = (label: string): string => label.replace(/\([^)]*\)/g, '').trim().toLowerCase()

interface ColumnSpan extends ScheduleColumn {
  indexes: number[]
}

function columnsOf(header: { index: number, label: string }[]): ColumnSpan[] {
  const spans: { label: string, slot: string | null, indexes: number[] }[] = []

  for (const entry of header) {
    const slot = slotPattern.exec(entry.label)?.[1]?.trim() ?? null
    const last = spans.at(-1)

    if (slot != null && last?.slot?.toLowerCase() === slot.toLowerCase()) {
      last.indexes.push(entry.index)
      continue
    }

    spans.push({ label: entry.label, slot, indexes: [entry.index] })
  }

  return spans.map(({ label, slot, indexes }): ColumnSpan => {
    // A lone "S1" is just a column that happens to end in a digit.
    if (slot != null && indexes.length > 1) return { label: slot, role: 'list', indexes }

    const bare = bareLabel(label)
    const role = idAliases.includes(bare)
      ? 'id'
      : dateAliases.includes(bare) ? 'date' : timeAliases.includes(bare) ? 'time' : 'text'

    return { label, role, indexes }
  })
}

function finish(pending: Pending, now: number): ScheduleSection[] {
  if (pending.header == null || pending.rows.length === 0) return []

  const spans = columnsOf(pending.header)
  const date = spans.findIndex(span => span.role === 'date')
  const time = spans.findIndex(span => span.role === 'time')
  const headerZone = zoneOffsetHours(spans[time]?.label ?? '') ?? zoneOffsetHours(spans[date]?.label ?? '')

  const rows = pending.rows.flatMap((cells): ScheduleRow[] => {
    const values = spans.map(span => span.indexes.flatMap(index => cells[index] ? [cells[index]!] : []))
    if (values.every(value => value.length === 0)) return []

    const dateText = values[date]?.[0] ?? ''
    // Without a time column, the time may well be written into the date cell.
    const timeText = time >= 0 ? values[time]?.[0] ?? '' : dateText
    const zone = headerZone ?? zoneOffsetHours(timeText)

    return [{ cells: values, startsAt: startOf(dateText, timeText, zone, now) }]
  })

  const timed = rows.filter(row => row.startsAt != null).sort((a, b) => a.startsAt! - b.startsAt!)
  const untimed = rows.filter(row => row.startsAt == null)

  return [{
    title: pending.title,
    qualifiers: /qualif/i.test(pending.title),
    columns: spans.map(({ label, role }) => ({ label, role })),
    rows: [...timed, ...untimed]
  }]
}

const zones: Record<string, number> = { cest: 2, mesz: 2, cet: 1, mez: 1, bst: 1, utc: 0, gmt: 0 }

/**
 * The UTC offset a label names: "Zeit (CEST)" is +2, "Time (UTC+1)" is +1.
 *
 * Nothing is assumed when there is none - a start time in an unknown zone would be wrong for someone,
 * so the row is shown as the sheet wrote it instead.
 */
export function zoneOffsetHours(text: string): number | null {
  const match = /\b(cest|mesz|cet|mez|bst|utc|gmt)\b(?:\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?)?/i.exec(text)
  if (!match) return null

  const base = zones[match[1]!.toLowerCase()]!
  if (!match[2]) return base

  const shift = Number(match[3]) + Number(match[4] ?? 0) / 60

  return base + (match[2] === '-' ? -shift : shift)
}

const monthNames = [
  ['january', 'januar', 'jänner'],
  ['february', 'februar'],
  ['march', 'märz', 'maerz'],
  ['april'],
  ['may', 'mai'],
  ['june', 'juni'],
  ['july', 'juli'],
  ['august'],
  ['september'],
  ['october', 'oktober'],
  ['november'],
  ['december', 'dezember']
]

/** Days between Google Sheets' epoch and the Unix one: a date cell exported unformatted is a day count. */
const SHEETS_EPOCH = Date.UTC(1899, 11, 30)
const DAY_MS = 86_400_000

/**
 * A date as schedule sheets write one: `11.09`, `11.09.2026`, `2026-09-11`, `September 13, Sonntag`,
 * `13. September`, or `46280` - the day count a date cell exports as when it lost its formatting.
 */
export function readDate(text: string): { year: number | null, month: number, day: number } | null {
  const value = text.trim()

  if (/^\d{5}$/.test(value)) {
    const date = new Date(SHEETS_EPOCH + Number(value) * DAY_MS)

    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
  }

  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value)
  if (iso) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const dotted = /(?<!\d)(\d{1,2})\.(\d{1,2})\.?(\d{4}|\d{2})?(?![\d:])/.exec(value)
  if (dotted) return valid(dotted[3] ? fullYear(dotted[3]) : null, Number(dotted[2]), Number(dotted[1]))

  const words = value.toLowerCase().match(/\p{L}{3,}/gu) ?? []
  const month = monthNames.findIndex(names => words.some(word => names.some(name => name.startsWith(word))))
  if (month < 0) return null

  const day = /(?<!\d)(\d{1,2})(?!\d)/.exec(value)
  const year = /(?<!\d)(\d{4})(?!\d)/.exec(value)
  if (!day) return null

  return valid(year ? Number(year[1]) : null, month + 1, Number(day[1]))
}

const fullYear = (digits: string): number => digits.length === 2 ? 2000 + Number(digits) : Number(digits)

const valid = (year: number | null, month: number, day: number) =>
  month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { year, month, day } : null

/** `12:00`, `17:45:00`, `8:30 pm`, `8pm`, `20 Uhr`. A dot is not read as a separator - `11.09` is a date. */
export function readTime(text: string): { hours: number, minutes: number } | null {
  const clock = /(?<!\d)(\d{1,2}):(\d{2})(?:\s*(am|pm))?/i.exec(text)
  const bare = clock ? null : /(?<!\d)(\d{1,2})\s*(am|pm|uhr)\b/i.exec(text)
  const match = clock ?? bare
  if (!match) return null

  let hours = Number(match[1])
  const minutes = clock ? Number(clock[2]) : 0
  const meridiem = (clock ? clock[3] : bare?.[2])?.toLowerCase()

  if (meridiem === 'pm' && hours < 12) hours += 12
  if (meridiem === 'am' && hours === 12) hours = 0

  return hours <= 24 && minutes < 60 ? { hours, minutes } : null
}

/**
 * When a row starts, or `null` if any part of that can't be read. A date without a year is placed in
 * whichever year puts it closest to `now` - a schedule is about the weeks around it.
 */
export function startOf(dateText: string, timeText: string, offsetHours: number | null, now: number): number | null {
  if (offsetHours == null) return null

  const date = readDate(dateText)
  const time = readTime(timeText)
  if (!date || !time) return null

  const thisYear = new Date(now).getUTCFullYear()
  const year = date.year ?? [thisYear - 1, thisYear, thisYear + 1]
    .sort((a, b) =>
      Math.abs(Date.UTC(a, date.month - 1, date.day) - now) - Math.abs(Date.UTC(b, date.month - 1, date.day) - now))[0]!

  return Date.UTC(year, date.month - 1, date.day, time.hours, time.minutes) - offsetHours * 3_600_000
}

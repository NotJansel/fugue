import type {
  ColumnMapping,
  MappoolColumnMapping,
  QualifierMap,
  SheetPreview,
  TournamentPlayer
} from '#shared/types'
import { parseCsv } from './csv'
import { apiError } from './http-error'
import { beatmapIdIn, fetchOsuUser, osuApiReady } from './osu-api'
import { parseSheetNumber } from './tournament-model'

/** A parsed sheet, before any player mapping is applied. */
export interface SheetData {
  headers: string[]
  rows: Record<string, string>[]
}

const docIdPattern = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/
const gidPattern = /[#&?]gid=(\d+)/
const bareIdPattern = /^[a-zA-Z0-9-_]{20,}$/

const osuIdAliases = ['osu id', 'osuid', 'osu! id', 'user id', 'userid', 'player id', 'uid']
const usernameAliases = ['username', 'osu username', 'player', 'player name', 'name', 'ign', 'nick']
const discordAliases = ['discord id', 'discordid', 'discord', 'discord tag', 'discord user']
const scoreAliases = ['score', 'z-score', 'zscore', 'z score', 'average', 'avg', 'points', 'total', 'qualifier score', 'sum']
const seedAliases = ['seed', 'seeding', 'rank', 'placement', 'place', 'position', '#']
const slotAliases = ['slot', 'pick', 'map slot', 'mod', 'code', 'map', 'beatmap']
const beatmapAliases = ['beatmap id', 'beatmapid', 'map id', 'mapid', 'b id', 'link', 'url', 'beatmap', 'map link']
const scoreColumnAliases = ['score column', 'column', 'header', 'qualifier column', 'score header']

// High enough that a multi-round mappool sheet (quals through finals, stacked) previews in full, so
// picking a round's row range does not need a second, blinder round-trip.
const PREVIEW_ROWS = 500
const ENRICH_DELAY_MS = 120

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function matchAlias(headers: string[], aliases: string[]): string | null {
  const normalised = new Map(headers.map(header => [header.toLowerCase().trim(), header]))

  for (const alias of aliases) {
    const exact = normalised.get(alias)
    if (exact) return exact
  }

  for (const alias of aliases) {
    for (const [key, header] of normalised) {
      if (key.includes(alias)) return header
    }
  }

  return null
}

/** Headers can repeat, and a repeated header would silently overwrite the column before it. */
function dedupeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>()

  return headers.map((header, index) => {
    const base = header === '' ? `Column ${index + 1}` : header
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)

    return count === 1 ? base : `${base} (${count})`
  })
}

/**
 * Turns whatever the user pasted into a CSV export URL.
 *
 * Accepts a full sheet link (with or without a `gid` fragment), a bare document ID, or an export URL
 * that is already CSV. Returns `null` if it can't find a document ID.
 */
export function toCsvUrl(input: string, sheetName?: string | null): string | null {
  const trimmed = input.trim()
  if (trimmed === '') return null

  if (trimmed.startsWith('http') && (trimmed.includes('out:csv') || trimmed.includes('format=csv'))) {
    return trimmed
  }

  const docId = docIdPattern.exec(trimmed)?.[1] ?? (bareIdPattern.test(trimmed) ? trimmed : null)
  if (docId == null) return null

  const base = `https://docs.google.com/spreadsheets/d/${docId}`

  if (sheetName?.trim()) {
    return `${base}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName.trim())}`
  }

  const gid = gidPattern.exec(trimmed)?.[1]

  return gid ? `${base}/export?format=csv&gid=${gid}` : `${base}/export?format=csv`
}

/**
 * Downloads and parses the sheet.
 *
 * Uses the public CSV export endpoints rather than the Sheets API, so no Google credentials are
 * involved - the sheet just has to be shared as "anyone with the link can view".
 */
export async function fetchSheet(input: string, sheetName?: string | null): Promise<SheetData> {
  const url = toCsvUrl(input, sheetName)

  if (url == null) {
    throw apiError(400, 'That doesn\'t look like a Google Sheets link or document ID.', 'err.sheet.url')
  }

  let response: Response

  try {
    response = await fetch(url, { redirect: 'follow' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[sheets] Failed to fetch ${url}:`, error)

    throw apiError(502, `Could not reach Google Sheets: ${message}`, 'err.sheet.unreachable', { message })
  }

  if (!response.ok) {
    throw apiError(
      502,
      `Google Sheets returned HTTP ${response.status}. `
      + 'Make sure the sheet is shared with "anyone with the link can view".',
      'err.sheet.http',
      { status: `${response.status}` }
    )
  }

  const body = await response.text()

  // A private sheet redirects to a sign-in page, which comes back as HTML rather than CSV.
  if (body.trimStart().startsWith('<')) {
    throw apiError(
      400,
      'Got a web page instead of CSV - the sheet is most likely not shared publicly, or the tab name is wrong.',
      'err.sheet.html'
    )
  }

  const rows = parseCsv(body).filter(row => row.some(cell => cell.trim() !== ''))
  if (rows.length === 0) throw apiError(400, 'The sheet appears to be empty.', 'err.sheet.empty')

  const headers = dedupeHeaders(rows[0]!.map(header => header.trim()))
  const dataRows = rows.slice(1).map(row =>
    Object.fromEntries(headers.map((header, index) => [header, (row[index] ?? '').trim()]))
  )

  return { headers, rows: dataRows }
}

/** Best-effort guess at which column is which, based on common tournament sheet headers. */
export function suggestMapping(headers: string[]): ColumnMapping | null {
  const username = matchAlias(headers, usernameAliases) ?? matchAlias(headers, osuIdAliases)
  if (username == null) return null

  return {
    username,
    osuId: matchAlias(headers, osuIdAliases),
    discordId: matchAlias(headers, discordAliases),
    score: matchAlias(headers, scoreAliases),
    seed: matchAlias(headers, seedAliases)
  }
}

/** Best-effort guess at which column names the slot, the beatmap and the qualifier score column. */
export function suggestMappoolMapping(headers: string[]): MappoolColumnMapping | null {
  const label = matchAlias(headers, slotAliases)
  if (label == null) return null

  // "Map" and "Beatmap" are plausible names for either column, so whichever one names the slot is
  // off the table for the rest - one column cannot be both.
  const rest = headers.filter(header => header !== label)

  return {
    label,
    beatmapId: matchAlias(rest, beatmapAliases),
    scoreColumn: matchAlias(rest, scoreColumnAliases)
  }
}

export async function previewSheet(input: string, sheetName?: string | null): Promise<SheetPreview> {
  const data = await fetchSheet(input, sheetName)

  return {
    headers: data.headers,
    sampleRows: data.rows.slice(0, PREVIEW_ROWS),
    rowCount: data.rows.length,
    suggestedMapping: suggestMapping(data.headers),
    suggestedMappoolMapping: suggestMappoolMapping(data.headers)
  }
}

/**
 * Maps rows of a mappool sheet onto pool slots, in sheet order.
 *
 * Rows without a slot name are skipped - pool sheets routinely carry blank spacer rows between mod
 * brackets. Beatmap cells may hold a bare ID or any osu! link; only the ID is kept.
 *
 * `startRow`/`endRow` narrow the sheet down to one round's block of rows, when every round is
 * published as rows of the same sheet: they are 1-based and count the header as row 1, matching the
 * row numbers Google Sheets itself shows, so a leftover bound outside the data is simply clamped.
 */
export function toMaps(
  data: SheetData,
  mapping: MappoolColumnMapping,
  startRow?: number | null,
  endRow?: number | null
): QualifierMap[] {
  const clamp = (value: number) => Math.min(Math.max(value, 0), data.rows.length)
  const from = clamp((startRow ?? 2) - 2)
  const to = Math.max(clamp((endRow ?? (data.rows.length + 1)) - 1), from)

  return data.rows.slice(from, to).flatMap((row) => {
    const label = row[mapping.label]?.trim()
    if (!label) return []

    const scoreColumn = mapping.scoreColumn ? row[mapping.scoreColumn]?.trim() || null : null
    const beatmapId = mapping.beatmapId ? beatmapIdIn(row[mapping.beatmapId] ?? '') : null

    return [{
      // Left blank on purpose: the store assigns ids, so a re-import cannot collide with one.
      id: '',
      label,
      stage: '',
      mods: '',
      column: scoreColumn,
      beatmapId
    } satisfies QualifierMap]
  })
}

/**
 * Maps sheet rows onto players and orders them into a seeding.
 *
 * Ordering prefers an explicit seed column, then a qualifier score (highest first), and otherwise
 * keeps sheet order. The result is only a starting point - the dashboard can reorder it by hand.
 */
export function toPlayers(data: SheetData, mapping: ColumnMapping): TournamentPlayer[] {
  const mapped = new Set(
    [mapping.username, mapping.osuId, mapping.discordId, mapping.score, mapping.seed].filter(Boolean) as string[]
  )

  const players = data.rows.flatMap((row) => {
    const username = row[mapping.username]?.trim() ?? ''
    const osuId = (mapping.osuId ? row[mapping.osuId]?.trim() : '') ?? ''
    if (username === '' && osuId === '') return []

    const seedCell = mapping.seed ? row[mapping.seed] : null
    const seedValue = seedCell ? parseSheetNumber(seedCell) : null
    const scoreCell = mapping.score ? row[mapping.score] : null

    return [{
      // Fall back to the username as key until enrichment resolves a real ID.
      osuId: osuId === '' ? `name:${username.toLowerCase()}` : osuId,
      username: username === '' ? osuId : username,
      discordId: (mapping.discordId ? row[mapping.discordId]?.trim() : '') || null,
      qualScore: scoreCell ? parseSheetNumber(scoreCell) : null,
      sheetSeed: seedValue == null ? null : Math.trunc(seedValue),
      captainMode: 'AUTO',
      extra: Object.fromEntries(
        Object.entries(row).filter(([key, value]) => !mapped.has(key) && value !== '')
      )
    } satisfies TournamentPlayer]
  })

  if (players.some(player => player.sheetSeed != null)) {
    return [...players].sort((a, b) => (a.sheetSeed ?? Number.MAX_SAFE_INTEGER) - (b.sheetSeed ?? Number.MAX_SAFE_INTEGER))
  }

  if (players.some(player => player.qualScore != null)) {
    return [...players].sort((a, b) => (b.qualScore ?? -Infinity) - (a.qualScore ?? -Infinity))
  }

  return players
}

/**
 * Fills in osu! IDs, pp and rank from the legacy osu! API, one player at a time.
 *
 * Calls are spaced out to stay well inside the API's rate limit; `onProgress` is invoked after each
 * player so the dashboard can show how far along the import is. Players that can't be resolved are
 * returned unchanged rather than dropped.
 */
export async function enrichPlayers(
  players: TournamentPlayer[],
  onProgress: (done: number, total: number) => void
): Promise<TournamentPlayer[]> {
  if (!osuApiReady()) {
    console.warn('[sheets] Skipping osu! enrichment - the osu! API application is not configured')

    return players
  }

  const enriched: TournamentPlayer[] = []

  for (const [index, player] of players.entries()) {
    const query = player.osuId.replace(/^name:/, '') || player.username
    const fetched = await fetchOsuUser(query)

    onProgress(index + 1, players.length)
    if (index < players.length - 1) await delay(ENRICH_DELAY_MS)

    enriched.push(fetched
      ? { ...player, osuId: fetched.userId, username: fetched.username, ppRaw: fetched.ppRaw, ppRank: fetched.ppRank }
      : player)
  }

  return enriched
}

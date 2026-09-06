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
  /**
   * The 1-based row number each entry of [rows] came from, counting every row of the sheet - blank
   * ones included. Blank rows are dropped from [rows] but they still occupy a line on the
   * organiser's screen, so this is what makes a typed row range mean what it looks like.
   */
  rowNumbers: number[]
}

const docIdPattern = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/
const gidPattern = /[#&?]gid=(\d+)/
const bareIdPattern = /^[a-zA-Z0-9-_]{20,}$/

/**
 * A "publish to web" link: `/spreadsheets/d/e/<token>/pub…`.
 *
 * The token is not the document ID and there is no `/export` under it, so these have to be spotted
 * before [docIdPattern] gets a look - that one would happily read the literal `e` as the document and
 * build a URL Google answers with a 404, under an error message blaming the sheet's sharing.
 */
const publishedPattern = /\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/

const osuIdAliases = ['osu id', 'osuid', 'osu! id', 'user id', 'userid', 'player id', 'uid']
const usernameAliases = ['username', 'osu username', 'player', 'player name', 'name', 'ign', 'nick']
const discordAliases = ['discord id', 'discordid', 'discord', 'discord tag', 'discord user']
const scoreAliases = ['score', 'z-score', 'zscore', 'z score', 'average', 'avg', 'points', 'total', 'qualifier score', 'sum']
const seedAliases = ['seed', 'seeding', 'rank', 'placement', 'place', 'position', '#']
const slotAliases = ['slot', 'pick', 'map slot', 'mod', 'code', 'map', 'beatmap']
const beatmapAliases = ['beatmap id', 'beatmapid', 'map id', 'mapid', 'b id', 'link', 'url', 'beatmap', 'map link']
const scoreColumnAliases = ['score column', 'column', 'header', 'qualifier column', 'score header']

/** What [dedupeHeaders] invents for a blank header. A made-up name can never match a real alias. */
const syntheticPattern = /^Column \d+( \(\d+\))?$/

/** A pool slot as sheets write them: "NM1", "HD2", "TB", "FM3". */
const slotLikePattern = /^(nm|hd|hr|dt|fm|ez|fl|rx|tb)\d*$/

/** A beatmap cell: a bare difficulty id. Four digits and up, which is what keeps BPM out of it. */
const beatmapLikePattern = /^\d{4,9}$/

const normalise = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')

/** How much of a column looks like the thing being asked about, ignoring its empty cells. */
function shareOf(rows: Record<string, string>[], header: string, test: (value: string) => boolean): number {
  const values = rows.map(row => row[header]?.trim()).filter((value): value is string => Boolean(value))
  if (values.length === 0) return 0

  return values.filter(test).length / values.length
}

/** The column that looks most like `test`, as long as it looks like it convincingly enough. */
function columnLooking(
  headers: string[],
  rows: Record<string, string>[],
  test: (value: string) => boolean
): string | null {
  const scored = headers
    .map(header => ({ header, share: shareOf(rows, header, test) }))
    .filter(({ share }) => share >= 0.6)
    .sort((a, b) => b.share - a.share)

  return scored[0]?.header ?? null
}

// High enough that a multi-round mappool sheet (quals through finals, stacked) previews in full, so
// picking a round's row range does not need a second, blinder round-trip.
const PREVIEW_ROWS = 500
const ENRICH_DELAY_MS = 120

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function matchAlias(headers: string[], aliases: string[]): string | null {
  const normalised = new Map(
    headers.filter(header => !syntheticPattern.test(header)).map(header => [header.toLowerCase().trim(), header])
  )

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

const filledCells = (row: string[]): number => row.filter(cell => cell.trim() !== '').length

/**
 * Whether `titles` is a spanning heading over `names` rather than a header row of its own.
 *
 * Sheets like to put one merged heading over a block of columns - "Per-map rank" across ten of them -
 * with the real column names on the line below. A merge only writes its text into its first cell, so
 * such a row comes back with a couple of labels and a lot of blanks, which is what tells it apart
 * from a header row: far fewer filled cells than the row underneath it.
 */
const isSpanningHeading = (titles: string[], names: string[]): boolean =>
  filledCells(titles) > 0 && filledCells(titles) * 2 < filledCells(names)

/**
 * Folds a spanning heading into the names below it, so each column carries its whole heading:
 * "Per-map rank NM1", "Per-map rank NM2", … then "Per-map score NM1", and so on.
 *
 * Without this the second column of each block reads as a bare "NM2" in both blocks, and nothing
 * downstream can tell a rank from a score.
 */
function foldSpanningHeading(titles: string[], names: string[]): string[] {
  let heading = ''

  return names.map((name, index) => {
    const title = titles[index]?.trim()
    if (title) heading = title

    const label = name.trim()

    return heading && label ? `${heading} ${label}` : label
  })
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

  // Already a CSV endpoint, in any of the three spellings Google uses for one.
  if (trimmed.startsWith('http')
    && (trimmed.includes('out:csv') || trimmed.includes('format=csv') || trimmed.includes('output=csv'))) {
    return trimmed
  }

  // A published sheet lives in its own URL space and is read through `pub`, never `export`. A tab
  // name cannot be honoured here - `gviz` does not exist for published documents - so the gid in the
  // link is the only way to pick a sheet, and `single=true` is what stops Google returning them all.
  const publishedToken = publishedPattern.exec(trimmed)?.[1]

  if (publishedToken != null) {
    if (sheetName?.trim()) {
      console.warn('[sheets] A published-to-web link cannot select a tab by name - using the gid in the link')
    }

    const base = `https://docs.google.com/spreadsheets/d/e/${publishedToken}/pub`
    const publishedGid = gidPattern.exec(trimmed)?.[1]

    return publishedGid ? `${base}?gid=${publishedGid}&single=true&output=csv` : `${base}?output=csv`
  }

  const docId = docIdPattern.exec(trimmed)?.[1] ?? (bareIdPattern.test(trimmed) ? trimmed : null)
  if (docId == null) return null

  const base = `https://docs.google.com/spreadsheets/d/${docId}`
  const gid = gidPattern.exec(trimmed)?.[1]

  // A link that carries a gid already says which tab it means, and `export` answers with the raw
  // grid - the same rows, in the same positions, that Google Sheets puts on the organiser's screen.
  // `gviz` trims leading empty rows away before it answers, which silently shifts every row number,
  // so it is only used when the tab name is the one thing identifying the sheet.
  if (gid) {
    if (sheetName?.trim()) {
      console.warn(`[sheets] The link already points at a tab (gid=${gid}) - ignoring the tab name`)
    }

    return `${base}/export?format=csv&gid=${gid}`
  }

  if (sheetName?.trim()) {
    return `${base}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName.trim())}`
  }

  return `${base}/export?format=csv`
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
    console.warn(`[sheets] ${url} returned HTTP ${response.status}`)

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
    console.warn(`[sheets] ${url} answered with a web page instead of CSV`)

    throw apiError(
      400,
      'Got a web page instead of CSV - the sheet is most likely not shared publicly, or the tab name is wrong.',
      'err.sheet.html'
    )
  }

  // Numbered before the blank ones are dropped: a sheet that opens with two empty rows still has its
  // header on row 3, and that is the number the organiser sees beside it.
  const numbered = parseCsv(body)
    .map((row, index) => ({ row, number: index + 1 }))
    .filter(({ row }) => row.some(cell => cell.trim() !== ''))

  if (numbered.length === 0) throw apiError(400, 'The sheet appears to be empty.', 'err.sheet.empty')

  const first = numbered[0]!.row
  const second = numbered[1]?.row
  const spanning = second != null && isSpanningHeading(first, second)

  const headers = dedupeHeaders(
    (spanning ? foldSpanningHeading(first, second) : first).map(header => header.trim())
  )
  const data = numbered.slice(spanning ? 2 : 1)

  return {
    headers,
    rows: data.map(({ row }) =>
      Object.fromEntries(headers.map((header, index) => [header, (row[index] ?? '').trim()]))
    ),
    rowNumbers: data.map(({ number }) => number)
  }
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

/**
 * Best-effort guess at which column names the slot, the beatmap and the qualifier score column.
 *
 * The *values* decide the first two, not the header. A pool sheet's slot column is unmistakable from
 * its contents - NM1, HD2, TB - while its header is routinely blank or something like "Map" that
 * belongs to the title column two along, so going by names picks the wrong one on exactly the sheets
 * this has to work for. The header aliases stay as the fallback.
 */
export function suggestMappoolMapping(
  headers: string[],
  rows: Record<string, string>[] = []
): MappoolColumnMapping | null {
  const label = columnLooking(headers, rows, value => slotLikePattern.test(normalise(value)))
    ?? matchAlias(headers, slotAliases)

  if (label == null) return null

  // "Map" and "Beatmap" are plausible names for either column, so whichever one names the slot is
  // off the table for the rest - one column cannot be both.
  const rest = headers.filter(header => header !== label)

  const beatmapId = columnLooking(rest, rows, value =>
    beatmapLikePattern.test(value.trim()) || value.includes('osu.ppy.sh')
  ) ?? matchAlias(rest, beatmapAliases)

  return {
    label,
    beatmapId,
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
    // The whole sheet, not just the preview slice: the slot and beatmap columns are recognised by
    // what is *in* them, and a pool sheet's first rows are as often a heading as they are data.
    suggestedMappoolMapping: suggestMappoolMapping(data.headers, data.rows)
  }
}

/**
 * Maps rows of a mappool sheet onto pool slots, in sheet order.
 *
 * Rows without a slot name are skipped - pool sheets routinely carry blank spacer rows between mod
 * brackets. Beatmap cells may hold a bare ID or any osu! link; only the ID is kept.
 *
 * `startRow`/`endRow` narrow the sheet down to one round's block of rows, when every round is
 * published as rows of the same sheet. Both bounds are inclusive and are the row numbers Google
 * Sheets itself puts down the left-hand side, matched against [SheetData.rowNumbers] rather than
 * against a position in the list - blank rows are dropped from the list but still take up a line on
 * screen, so counting positions would land somewhere else entirely. A bound outside the sheet simply
 * matches nothing at that end.
 */
export function toMaps(
  data: SheetData,
  mapping: MappoolColumnMapping,
  startRow?: number | null,
  endRow?: number | null
): QualifierMap[] {
  const from = startRow ?? Number.NEGATIVE_INFINITY
  const to = endRow ?? Number.POSITIVE_INFINITY

  const inRange = data.rows.filter((_, index) => {
    const number = data.rowNumbers[index]!

    return number >= from && number <= to
  })

  return inRange.flatMap((row) => {
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

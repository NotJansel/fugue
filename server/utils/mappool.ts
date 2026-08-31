import { randomUUID } from 'node:crypto'
import type { MappoolSheetConfig, QualifierMap } from '#shared/types'
import { beatmapIdIn, fetchBeatmap, osuApiReady } from './osu-api'
import { modsFor, parseMods } from './mods'
import { getTournament, setMappool } from './tournament-store'

const MAP_ID_LENGTH = 8
const LOOKUP_DELAY_MS = 120

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function newMapId(taken: Set<string>): string {
  let id = randomUUID().slice(0, MAP_ID_LENGTH)
  while (taken.has(id)) id = randomUUID().slice(0, MAP_ID_LENGTH)
  taken.add(id)

  return id
}

/** Everything looked up rather than typed, taken from `source` wholesale - `null` clears the lot. */
const withMetadataFrom = (map: QualifierMap, source: QualifierMap | null): QualifierMap => ({
  ...map,
  beatmapsetId: source?.beatmapsetId ?? null,
  artist: source?.artist ?? null,
  title: source?.title ?? null,
  version: source?.version ?? null,
  stars: source?.stars ?? null,
  cs: source?.cs ?? null,
  ar: source?.ar ?? null,
  od: source?.od ?? null,
  hp: source?.hp ?? null,
  bpm: source?.bpm ?? null,
  lengthSeconds: source?.lengthSeconds ?? null
})

/**
 * Fills in what the osu! API knows about a slot's beatmap: title, difficulty name, star rating under
 * the slot's mods, and the set the cover art comes from.
 *
 * Only slots whose beatmap or mods are new, or that are still unresolved, are looked up: the
 * dashboard saves the whole pool on every edit and there is no reason to re-ask about a slot that
 * rates the same as it did before. `force` skips that check, for when the answer itself may have moved.
 *
 * A lookup that fails (no credentials, unknown ID, API down) leaves the slot usable - it keeps
 * whatever it already read as, or shows as its bare label.
 */
async function withBeatmapInfo(
  map: QualifierMap,
  previous: QualifierMap | undefined,
  force: boolean
): Promise<QualifierMap> {
  if (!map.beatmapId) return withMetadataFrom(map, null)

  // The same map under the same mods rates the same, so there is nothing to go and ask about. A slot
  // resolved before the pool knew about difficulty settings has no `cs` and is looked up again.
  const kept = previous
    && previous.beatmapId === map.beatmapId
    && previous.mods === map.mods
    && previous.title != null
    && previous.cs != null
    ? previous
    : null

  if (kept && !force) return withMetadataFrom(map, kept)
  if (!osuApiReady()) return withMetadataFrom(map, kept)

  // Imports resolve a whole pool in one go; space the calls out as the player enrichment does.
  await delay(LOOKUP_DELAY_MS)

  // A failed lookup is news about the API, not about the map, so a slot that already reads fine keeps
  // what it has rather than being blanked - which matters most to a refresh of the whole pool.
  const info = await fetchBeatmap(map.beatmapId, parseMods(map.mods))
  if (!info) return withMetadataFrom(map, kept)

  return {
    ...map,
    beatmapId: info.beatmapId,
    beatmapsetId: info.beatmapsetId,
    artist: info.artist,
    title: info.title,
    version: info.version,
    stars: info.stars,
    cs: info.difficulty.cs ?? null,
    ar: info.difficulty.ar ?? null,
    od: info.difficulty.od ?? null,
    hp: info.difficulty.hp ?? null,
    bpm: info.difficulty.bpm ?? null,
    lengthSeconds: info.difficulty.lengthSeconds ?? null
  }
}

/**
 * Puts a pool on file: gives every slot a stable id, tidies what was typed, and fills in beatmap
 * metadata. Shared by hand edits and sheet imports so both end up with exactly the same shape.
 *
 * `force` re-asks the osu! API about every slot instead of trusting what is already on file - see the
 * `/api/mappool/refresh` route.
 */
export async function saveMappool(
  maps: QualifierMap[],
  sheet: MappoolSheetConfig | null = null,
  force = false
): Promise<QualifierMap[]> {
  const previous = new Map(getTournament().mappool.map(map => [map.id, map]))
  const seen = new Set<string>()

  const tidied = maps.map((map, index) => {
    const trimmedId = (map.id ?? '').trim()
    const id = trimmedId !== '' && !seen.has(trimmedId) ? (seen.add(trimmedId), trimmedId) : newMapId(seen)
    const label = map.label?.trim() || `Map ${index + 1}`

    return {
      ...map,
      id,
      label,
      stage: (map.stage ?? '').trim(),
      mods: modsFor(map.mods ?? '', label),
      column: map.column?.trim() || null,
      beatmapId: map.beatmapId ? beatmapIdIn(map.beatmapId) : null
    } satisfies QualifierMap
  })

  const resolved: QualifierMap[] = []
  for (const map of tidied) {
    resolved.push(await withBeatmapInfo(map, previous.get(map.id), force))
  }

  await setMappool(resolved, sheet)

  return resolved
}

/** Slot names are compared loosely, so "NM1", "nm 1" and "NM_1" are the same slot. */
export const slotKey = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The qualifier column that plainly belongs to a slot: "NM1", "NM1 score", "nm1_score". */
export function columnForSlot(columns: string[], label: string): string | null {
  const slot = slotKey(label)
  if (slot === '') return null

  return columns.find(column => slotKey(column) === slot)
    ?? columns.find(column => slotKey(column).startsWith(slot))
    ?? null
}

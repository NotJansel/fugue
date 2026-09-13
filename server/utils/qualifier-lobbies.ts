import type { ScheduleLobby, ScheduleSection } from '#shared/types'
import { emitChange } from './bus'
import { fetchMatch, fetchMatchPage, osuApiReady } from './osu-api'

/**
 * The osu! lobbies qualifier rows are played in, found by name.
 *
 * Referees name a lobby `TP: (Qualifiers) vs (Lobby 1SO12)`, and the part after `Lobby` is the row's
 * ID in the schedule. osu! knows when a lobby actually opened and closed, which the sheet's start time
 * can only guess at - a lobby started late is running, and one finished early is over.
 *
 * The match history holds every tournament lobby on the server, around a thousand an hour, so it is
 * only read while a qualifier row is close to its start, and then only back to the newest match
 * already seen. Lobbies still open are asked about again each minute to catch them closing.
 */
const POLL_MS = 60_000

/** Qualifiers started after this, so nothing older is looked for however the sheet reads. */
const QUALIFIERS_FROM = Date.UTC(2026, 8, 8)

/** A row is watched from this long before its start... */
const LEAD_MS = 30 * 60_000
/** ...until this long after, which covers a lobby that started late and overran. */
const TRAIL_MS = 2 * 60 * 60_000

/** A backfill stops here even short of its target, rather than hammering the API. */
const MAX_PAGES = 60

const LOBBY_NAME = /^TP:\s*\(Qualifiers\)\s*vs\s*\(Lobby\s*([^)]+)\)\s*$/i

/** `Lobby 12`, `#12` and `12` all name the same row. */
export const lobbyKey = (id: string): string => id.toLowerCase().replace(/^lobby/, '').replace(/[\s#]/g, '')

const lobbies = new Map<string, ScheduleLobby>()
let newestSeen: number | null = null

let timer: NodeJS.Timeout | null = null
let inFlight: Promise<void> | null = null

export const lobbyFor = (id: string): ScheduleLobby | null => lobbies.get(lobbyKey(id)) ?? null

export function startLobbyWatch(sections: () => ScheduleSection[]): void {
  stopLobbyWatch()

  const tick = () => {
    inFlight ??= poll(sections()).catch((error) => {
      console.warn('[lobbies] Could not look qualifier lobbies up:', error)
    }).finally(() => {
      inFlight = null
    })
  }

  tick()
  timer = setInterval(tick, POLL_MS)
  timer.unref()
}

export function stopLobbyWatch(): void {
  if (timer) clearInterval(timer)
  timer = null
}

async function poll(sections: ScheduleSection[]): Promise<void> {
  if (!osuApiReady()) return

  const now = Date.now()
  const starts = sections
    .filter(section => section.qualifiers)
    .flatMap(section => section.rows.flatMap(row => row.startsAt ?? []))
    .filter(start => start - LEAD_MS <= now && now <= start + TRAIL_MS)

  let changed = false

  if (starts.length > 0) {
    changed = await scan(Math.max(Math.min(...starts) - LEAD_MS, QUALIFIERS_FROM))
  }

  for (const [key, lobby] of lobbies) {
    if (lobby.endedAt != null || lobby.startedAt + TRAIL_MS < now) continue

    const found = await fetchMatch(lobby.matchId)
    if (found?.endedAt == null) continue

    lobbies.set(key, { ...lobby, endedAt: found.endedAt })
    changed = true
  }

  if (changed) emitChange()
}

/** Reads the history back to `since`, or to the newest match an earlier scan already saw. */
async function scan(since: number): Promise<boolean> {
  const stopAt = newestSeen
  let cursor: string | null = null
  let changed = false

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchMatchPage(cursor)
    if (result == null) break

    if (page === 0 && result.matches[0]) newestSeen = Math.max(newestSeen ?? 0, result.matches[0].matchId)

    for (const match of result.matches) {
      if (stopAt != null && match.matchId <= stopAt) return changed
      if (match.startedAt < since) return changed

      const id = LOBBY_NAME.exec(match.name)?.[1]
      if (id == null) continue

      // A lobby remade after a crash keeps its name; the newer one is the one being played.
      const key = lobbyKey(id)
      const known = lobbies.get(key)
      if (known && known.matchId >= match.matchId) continue

      lobbies.set(key, { matchId: match.matchId, startedAt: match.startedAt, endedAt: match.endedAt })
      changed = true
    }

    cursor = result.cursor
    if (cursor == null) break
  }

  return changed
}

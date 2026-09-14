import type { LobbyScore, QualifierLobby, ScheduleLobby, ScheduleSection } from '#shared/types'
import { emitChange } from './bus'
import {
  allLobbies,
  allLobbyScores,
  lobbyByMatchId,
  lobbyForKey,
  recordScores,
  removeLobby,
  saveLobby
} from './lobby-store'
import { Mods, formatMods } from './mods'
import type { OsuGame, OsuGameScore, OsuMatch } from './osu-api'
import { fetchMatchHistory, fetchMatchPage, matchIdIn, osuApiReady } from './osu-api'
import { getTournament, reseedByZSum } from './tournament-store'

/**
 * The osu! lobbies qualifier rows are played in, and the scores set in them.
 *
 * Referees name a lobby `TP: (Qualifiers) vs (Lobby 1SO12)`, and the part after `Lobby` is the row's
 * ID in the schedule. osu! knows when a lobby actually opened and closed, which the sheet's start time
 * can only guess at - a lobby started late is running, and one finished early is over. And osu! has
 * every score set in it, which is where the qualifier results come from: each lobby is read again
 * every minute while it is open and once more when it closes, and the seeding follows the results
 * (`seedingByZSum`) until an organiser locks it.
 *
 * The match history holds every tournament lobby on the server, around a thousand an hour, so it is
 * only read while a qualifier row is close to its start, and then only back to the newest match
 * already seen. A lobby the scan missed - named differently, played on another day - is added by
 * link instead (`addLobby`), and read the same way.
 */
const POLL_MS = 60_000

/** Qualifiers started after this, so nothing older is looked for however the sheet reads. */
const QUALIFIERS_FROM = Date.UTC(2026, 8, 8)

/** A row is watched from this long before its start... */
const LEAD_MS = 30 * 60_000
/** ...until this long after, which covers a lobby that started late and overran. */
const TRAIL_MS = 2 * 60 * 60_000

/** A backfill of the history stops here even short of its target, rather than hammering the API. */
const MAX_PAGES = 60

/** A lobby's own history is 100 events a page; a qualifier lobby is a few dozen events in all. */
const MAX_EVENT_PAGES = 10

const LOBBY_NAME = /^TP:\s*\(Qualifiers\)\s*vs\s*\(Lobby\s*([^)]+)\)\s*$/i

/** `Lobby 12`, `#12` and `12` all name the same row. */
export const lobbyKey = (id: string): string => id.toLowerCase().replace(/^lobby/, '').replace(/[\s#]/g, '')

/** The key a lobby gets when its name fits no schedule row. */
const matchKey = (matchId: number): string => `mp:${matchId}`

const keyFor = (match: OsuMatch): string => {
  const id = LOBBY_NAME.exec(match.name)?.[1]

  return id == null ? matchKey(match.matchId) : lobbyKey(id)
}

let newestSeen: number | null = null

let timer: NodeJS.Timeout | null = null
let inFlight: Promise<void> | null = null

/** What the schedule needs to know about a row's lobby: nothing about how far it has been read. */
export function lobbyFor(id: string): ScheduleLobby | null {
  const lobby = lobbyForKey(lobbyKey(id))

  return lobby ? { matchId: lobby.matchId, startedAt: lobby.startedAt, endedAt: lobby.endedAt } : null
}

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

  // Every lobby still open is asked about again, to catch scores as they land and the lobby closing;
  // one never read at all - just found, or added by link - is read whatever its age. A lobby nobody
  // closed stops being asked about after a while, whatever osu! still says.
  for (const lobby of allLobbies()) {
    const settled = lobby.endedAt != null || lobby.startedAt + TRAIL_MS < now
    if (lobby.latestEventId != null && settled) continue

    if (await readLobby(lobby)) changed = true
  }

  if (changed) await publish()
}

/** Reads the history back to `since`, or to the newest match an earlier scan already saw. */
async function scan(since: number): Promise<boolean> {
  const stopAt = newestSeen
  let cursor: string | null = null
  let changed = false

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchMatchHistory(cursor)
    if (result == null) break

    if (page === 0 && result.matches[0]) newestSeen = Math.max(newestSeen ?? 0, result.matches[0].matchId)

    for (const match of result.matches) {
      if (stopAt != null && match.matchId <= stopAt) return changed
      if (match.startedAt < since) return changed

      if (!LOBBY_NAME.test(match.name) || lobbyByMatchId(match.matchId)) continue

      // A lobby remade after a crash keeps its name. Both are kept: the newer one is the one being
      // played, and whatever was played in the older one still counts.
      await saveLobby({
        matchId: match.matchId,
        key: keyFor(match),
        name: match.name,
        startedAt: match.startedAt,
        endedAt: match.endedAt,
        latestEventId: null
      })
      changed = true
    }

    cursor = result.cursor
    if (cursor == null) break
  }

  return changed
}

const toLobbyScore = (matchId: number, game: OsuGame, score: OsuGameScore): LobbyScore => ({
  matchId,
  gameId: game.gameId,
  beatmapId: game.beatmapId,
  osuId: score.osuId,
  username: score.username,
  score: score.score,
  mods: formatMods(game.mods | score.mods),
  // What the player picked themselves: NF is a lobby rule, not a choice, and the game's own mods
  // were forced on everyone.
  ownMods: formatMods(score.mods & ~game.mods & ~Mods.NF),
  passed: score.passed,
  playedAt: game.startedAt
})

/**
 * Reads what a lobby has to say since it was last read: the games finished in the meantime, and
 * whether it has closed. Pages backwards from the newest events until an event already on file, or
 * the first event of the lobby, turns up. Returns whether anything on file changed.
 */
async function readLobby(lobby: QualifierLobby): Promise<boolean> {
  const stopAt = lobby.latestEventId
  const games: OsuGame[] = []
  let match: OsuMatch | null = null
  let settled: number | null = null
  let before: number | null = null

  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const result = await fetchMatchPage(lobby.matchId, before)
    // No answer is news about the API, not about the lobby: it is read again next minute.
    if (result == null) return false

    match ??= result.match
    settled ??= result.settledEventId
    games.push(...result.games)

    if (result.oldestEventId == null) break
    if (stopAt != null && result.oldestEventId <= stopAt) break
    if (result.firstEventId != null && result.oldestEventId <= result.firstEventId) break

    before = result.oldestEventId
  }

  if (match == null) return false

  const scoresChanged = await recordScores(
    games.flatMap(game => game.scores.map(score => toLobbyScore(lobby.matchId, game, score)))
  )

  const next: QualifierLobby = {
    ...lobby,
    name: match.name,
    startedAt: match.startedAt,
    endedAt: match.endedAt,
    latestEventId: settled ?? lobby.latestEventId
  }
  const lobbyChanged = next.endedAt !== lobby.endedAt
    || next.latestEventId !== lobby.latestEventId
    || next.name !== lobby.name
    || next.startedAt !== lobby.startedAt

  if (lobbyChanged) await saveLobby(next)

  return scoresChanged || lobbyChanged
}

/**
 * Tells the dashboard, after putting the seeding where the results now say it belongs. A locked
 * seeding is left alone - that is what the lock is for - and the results still show.
 */
async function publish(): Promise<void> {
  if (!getTournament().seedingLocked) await reseedByZSum(allLobbyScores())

  emitChange()
}

/** How adding a lobby by link went. `added` is `false` for one that was already on file. */
export interface AddedLobby {
  lobby: QualifierLobby
  added: boolean
}

/**
 * Puts a lobby on file by its link or match ID, and reads it straight away.
 *
 * This is for lobbies the scan cannot find: one named differently, or played outside the watched
 * window. A name that does fit still lands the lobby on its schedule row.
 */
export async function addLobby(input: string): Promise<AddedLobby | 'invalid' | 'unknown' | 'unavailable'> {
  if (!osuApiReady()) return 'unavailable'

  const matchId = matchIdIn(input)
  if (matchId == null) return 'invalid'

  const known = lobbyByMatchId(matchId)
  if (known) return { lobby: known, added: false }

  const page = await fetchMatchPage(matchId)
  if (page == null) return 'unknown'

  const lobby: QualifierLobby = {
    matchId,
    key: keyFor(page.match),
    name: page.match.name,
    startedAt: page.match.startedAt,
    endedAt: page.match.endedAt,
    latestEventId: null
  }

  await saveLobby(lobby)
  await readLobby(lobby)
  await publish()

  return { lobby: lobbyByMatchId(matchId) ?? lobby, added: true }
}

/** Takes a lobby and its scores off file - a warm-up lobby added by mistake, say. */
export async function dropLobby(matchId: number): Promise<boolean> {
  const removed = await removeLobby(matchId)
  if (removed) await publish()

  return removed
}

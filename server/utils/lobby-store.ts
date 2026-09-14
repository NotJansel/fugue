import type { LobbyScore, QualifierLobby } from '#shared/types'
import { query, valuesList, withTransaction } from './db'
import { serialiser } from './store-queue'

/**
 * The qualifier lobbies osu! knows about, and every score set in them.
 *
 * Both are persisted: the match history is far too busy to scan back through after a restart, and a
 * lobby's scores are the qualifier results themselves. Scores are kept exactly as osu! reported them,
 * one row per game and player - which slot a beatmap belongs to, and which of a player's runs counts,
 * is derived on every dashboard build (`tournament-model.ts`), so nothing here ever has to be re-read
 * when the pool or the player list changes.
 *
 * Neither the watcher nor the routes emit a change from here: whoever changes scores also reseeds,
 * and one change signal after both is what keeps a dashboard from rendering results and seeding that
 * disagree.
 */
const lobbies = new Map<number, QualifierLobby>()

/** `game id -> user id -> score`, the same key the table has. */
const scores = new Map<number, Map<string, LobbyScore>>()

const write = serialiser()

interface LobbyRow {
  match_id: number
  row_key: string
  name: string
  started_at: number
  ended_at: number | null
  latest_event_id: number | null
}

interface ScoreRow {
  game_id: number
  user_id: string
  match_id: number
  beatmap_id: string
  username: string
  score: number
  mods: string
  passed: boolean
  played_at: number
}

export async function loadLobbies(): Promise<void> {
  const [lobbyRows, scoreRows] = await Promise.all([
    query<LobbyRow>('SELECT * FROM qualifier_lobbies'),
    query<ScoreRow>('SELECT * FROM lobby_scores')
  ])

  lobbies.clear()
  for (const row of lobbyRows) {
    lobbies.set(row.match_id, {
      matchId: row.match_id,
      key: row.row_key,
      name: row.name,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      latestEventId: row.latest_event_id
    })
  }

  scores.clear()
  for (const row of scoreRows) {
    remember({
      matchId: row.match_id,
      gameId: row.game_id,
      beatmapId: row.beatmap_id,
      osuId: row.user_id,
      username: row.username,
      score: row.score,
      mods: row.mods,
      passed: row.passed,
      playedAt: row.played_at
    })
  }
}

function remember(score: LobbyScore): void {
  let game = scores.get(score.gameId)
  if (!game) scores.set(score.gameId, game = new Map())

  game.set(score.osuId, score)
}

/** Every lobby on file, newest first. */
export const allLobbies = (): QualifierLobby[] =>
  [...lobbies.values()].sort((a, b) => b.matchId - a.matchId)

export const lobbyByMatchId = (matchId: number): QualifierLobby | null => lobbies.get(matchId) ?? null

/**
 * The lobby a schedule row was played in. A lobby remade after a crash keeps its name, so the newest
 * match under the key is the one being played - the older one's scores still count.
 */
export function lobbyForKey(key: string): QualifierLobby | null {
  let found: QualifierLobby | null = null

  for (const lobby of lobbies.values()) {
    if (lobby.key === key && (found == null || lobby.matchId > found.matchId)) found = lobby
  }

  return found
}

export const allLobbyScores = (): LobbyScore[] =>
  [...scores.values()].flatMap(game => [...game.values()])

/** Writes one lobby, new or changed. */
export function saveLobby(lobby: QualifierLobby): Promise<void> {
  return write(async () => {
    await query(
      `INSERT INTO qualifier_lobbies (match_id, row_key, name, started_at, ended_at, latest_event_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (match_id) DO UPDATE SET
         row_key = EXCLUDED.row_key,
         name = EXCLUDED.name,
         started_at = EXCLUDED.started_at,
         ended_at = EXCLUDED.ended_at,
         latest_event_id = EXCLUDED.latest_event_id`,
      [lobby.matchId, lobby.key, lobby.name, lobby.startedAt, lobby.endedAt, lobby.latestEventId]
    )

    lobbies.set(lobby.matchId, lobby)
  })
}

/**
 * Puts a batch of scores on file, replacing any already held for the same game and player - a lobby
 * is re-read in whole pages, so most of what arrives is already known. Returns whether anything is
 * actually new or different, which is what decides whether the seeding is worth recomputing.
 */
export function recordScores(incoming: LobbyScore[]): Promise<boolean> {
  return write(async () => {
    const changed = incoming.filter((score) => {
      const known = scores.get(score.gameId)?.get(score.osuId)

      return known == null
        || known.score !== score.score
        || known.passed !== score.passed
        || known.beatmapId !== score.beatmapId
    })

    if (changed.length === 0) return false

    // Only lobbies on file can hold scores, and every score arrives from a lobby the watcher already
    // saved - the constraint is there to take the scores with a lobby that is removed.
    const rows = valuesList(changed, (score: LobbyScore) => [
      score.gameId, score.osuId, score.matchId, score.beatmapId, score.username, score.score,
      score.mods, score.passed, score.playedAt
    ])
    if (!rows) return false

    await query(
      `INSERT INTO lobby_scores (
         game_id, user_id, match_id, beatmap_id, username, score, mods, passed, played_at
       ) VALUES ${rows.text}
       ON CONFLICT (game_id, user_id) DO UPDATE SET
         match_id = EXCLUDED.match_id,
         beatmap_id = EXCLUDED.beatmap_id,
         username = EXCLUDED.username,
         score = EXCLUDED.score,
         mods = EXCLUDED.mods,
         passed = EXCLUDED.passed,
         played_at = EXCLUDED.played_at`,
      rows.values
    )

    for (const score of changed) remember(score)

    return true
  })
}

/** Takes a lobby off file together with every score set in it. Returns whether there was one. */
export function removeLobby(matchId: number): Promise<boolean> {
  return write(async () => {
    if (!lobbies.has(matchId)) return false

    await withTransaction(async (client) => {
      await client.query('DELETE FROM lobby_scores WHERE match_id = $1', [matchId])
      await client.query('DELETE FROM qualifier_lobbies WHERE match_id = $1', [matchId])
    })

    lobbies.delete(matchId)
    for (const [gameId, game] of scores) {
      for (const score of game.values()) {
        if (score.matchId === matchId) game.delete(score.osuId)
      }
      if (game.size === 0) scores.delete(gameId)
    }

    return true
  })
}

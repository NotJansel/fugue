import type { BeatmapDifficulty } from './difficulty'
import { config, osuOauthConfigured } from './config'
import { withMods } from './difficulty'
import { Mods, difficultyMask, parseMods } from './mods'

/**
 * The osu! API v2, authenticated as the *application* rather than as a user.
 *
 * A client-credentials grant against the same OAuth2 application that powers the osu! half of the
 * login (`OSU_CLIENT_ID`/`OSU_CLIENT_SECRET`) buys a token with the `public` scope, which is all the
 * lookups here need. That is the whole reason the legacy v1 key is gone: one credential now covers
 * both signing users in and reading players and beatmaps.
 */
const API = 'https://osu.ppy.sh/api/v2'
const TOKEN_URL = 'https://osu.ppy.sh/oauth/token'

/** Pins the response shapes so an osu-web deploy can't change them under us. */
const API_VERSION = '20220705'

/** Refresh a little before the token actually lapses, so a request never races the expiry. */
const EXPIRY_MARGIN_SECONDS = 60

/** A minimal view of an osu! user, with the fields the auction card and the seeding need. */
export interface OsuUser {
  userId: string
  username: string
  ppRaw: number
  ppRank: number
}

/** The parts of a beatmap the mappool page shows: what it is, and what it looks like. */
export interface BeatmapInfo {
  beatmapId: string
  beatmapsetId: string | null
  artist: string | null
  title: string | null
  version: string | null
  /** Star rating with whatever mods were asked for, or `null` when the API would not rate it. */
  stars: number | null
  /** CS, AR, OD, HP, BPM and length, under those same mods. */
  difficulty: BeatmapDifficulty
}

interface V2User {
  id?: number
  username?: string
  statistics?: { pp?: number | null, global_rank?: number | null }
}

interface V2Beatmap {
  id?: number
  beatmapset_id?: number
  version?: string
  difficulty_rating?: number
  cs?: number
  ar?: number
  accuracy?: number
  drain?: number
  bpm?: number
  total_length?: number
  beatmapset?: { artist?: string, title?: string }
}

interface V2Attributes {
  attributes?: { star_rating?: number }
}

interface V2Match {
  id?: number
  name?: string
  start_time?: string | null
  end_time?: string | null
}

/**
 * A score inside a match game. These come back in the *legacy* match-score shape whatever API
 * version is asked for, with `total_score` mirrored into `legacy_total_score`; both are read in case
 * one of them goes.
 */
interface V2MatchScore {
  user_id?: number
  total_score?: number
  legacy_total_score?: number
  score?: number
  passed?: boolean
  mods?: (string | { acronym?: string })[]
  match?: { pass?: boolean }
}

interface V2MatchGame {
  id?: number
  beatmap_id?: number
  start_time?: string | null
  end_time?: string | null
  mods?: string[]
  scores?: V2MatchScore[]
}

interface V2MatchEvent {
  id?: number
  game?: V2MatchGame
}

interface V2MatchDetail {
  match?: V2Match
  events?: V2MatchEvent[]
  users?: { id?: number, username?: string }[]
  first_event_id?: number | null
  latest_event_id?: number | null
}

/** A multiplayer lobby as the match history lists it: no games, no players, just when it ran. */
export interface OsuMatch {
  matchId: number
  name: string
  startedAt: number
  /** `null` while the lobby is still open. */
  endedAt: number | null
}

export interface OsuGameScore {
  osuId: string
  username: string
  score: number
  /** Legacy bitmask of the player's own mods on top of the game's. */
  mods: number
  passed: boolean
}

/** One map played in a lobby, with everyone's score on it. Only games that have finished are listed. */
export interface OsuGame {
  gameId: number
  beatmapId: string
  /** Legacy bitmask of the mods the game was set up with. */
  mods: number
  startedAt: number
  scores: OsuGameScore[]
}

/** One page of a lobby's history - the match itself, and the finished games on that page. */
export interface OsuMatchPage {
  match: OsuMatch
  games: OsuGame[]
  /** Oldest event on this page; `null` for an empty one. */
  oldestEventId: number | null
  /**
   * Newest event on this page that a later read need not look at again: a game still being played
   * sits on an event that will only carry scores once it ends, so everything from it on is left for
   * the next read. `null` for an empty page.
   */
  settledEventId: number | null
  /** The very first event of the lobby, which is where paging backwards stops. */
  firstEventId: number | null
}

let token: { value: string, expiresAt: number } | null = null
let pending: Promise<string | null> | null = null

/** Whether player and beatmap lookups are possible at all - i.e. whether the OAuth app is set up. */
export const osuApiReady = (): boolean => osuOauthConfigured()

async function requestToken(): Promise<string | null> {
  if (!osuOauthConfigured()) return null

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({
        client_id: Number(config.osuClientId),
        client_secret: config.osuClientSecret,
        grant_type: 'client_credentials',
        scope: 'public'
      })
    })

    if (!response.ok) {
      console.warn(`[osu] Client-credentials token request returned HTTP ${response.status}`)

      return null
    }

    const body = await response.json() as { access_token?: string, expires_in?: number }
    if (!body.access_token) return null

    const lifetime = Math.max((body.expires_in ?? 3600) - EXPIRY_MARGIN_SECONDS, EXPIRY_MARGIN_SECONDS)
    token = { value: body.access_token, expiresAt: Date.now() + lifetime * 1000 }

    return token.value
  } catch (error) {
    console.error('[osu] Could not reach the osu! token endpoint:', error)

    return null
  }
}

/**
 * The app token, fetched once and reused until it lapses.
 *
 * Concurrent callers share the one in-flight request - a mappool refresh fires a lookup per slot, and
 * there is no reason for the first few to each ask for their own token.
 */
function accessToken(): Promise<string | null> {
  if (token && token.expiresAt > Date.now()) return Promise.resolve(token.value)

  pending ??= requestToken().finally(() => {
    pending = null
  })

  return pending
}

/**
 * One authenticated call.
 *
 * `null` covers every way an answer can fail to arrive - unknown ID, refused credentials, API down -
 * because every caller here treats them the same way: keep whatever was already on file.
 */
async function api<T>(path: string, body?: unknown, allowRetry = true): Promise<T | null> {
  const bearer = await accessToken()
  if (!bearer) return null

  try {
    const response = await fetch(`${API}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'authorization': `Bearer ${bearer}`,
        'accept': 'application/json',
        'content-type': 'application/json',
        'x-api-version': API_VERSION
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

    // A token can be revoked, or lapse earlier than it said it would. Drop it and try once more.
    if (response.status === 401 && allowRetry) {
      token = null

      return api<T>(path, body, false)
    }

    // A 404 is news about the ID that was asked for, not about the API, so it is not worth a log line.
    if (response.status === 404) return null

    if (!response.ok) {
      console.warn(`[osu] ${path} returned HTTP ${response.status}`)

      return null
    }

    return await response.json() as T
  } catch (error) {
    console.error(`[osu] Request to ${path} failed:`, error)

    return null
  }
}

/**
 * Takes the beatmap ID out of whatever was pasted or imported: a bare ID, `/b/123`, or a full
 * `…/beatmapsets/1#osu/123` link. The last number wins, which in a set link is the difficulty.
 */
export function beatmapIdIn(input: string): string | null {
  const numbers = input.trim().match(/\d+/g)

  return numbers?.at(-1) ?? null
}

/**
 * Fetches a user.
 *
 * `user` may be a numeric ID or a username, and `key` says which - without it the API guesses, which
 * would pick the wrong person for anyone whose name is all digits. The canonical ID is taken from the
 * response either way.
 */
export async function fetchOsuUser(user: string): Promise<OsuUser | null> {
  const query = user.trim()
  if (query === '') return null

  const key = /^\d+$/.test(query) ? 'id' : 'username'
  const found = await api<V2User>(`/users/${encodeURIComponent(query)}/osu?key=${key}`)

  if (found?.id == null) return null

  return {
    userId: String(found.id),
    username: found.username ?? String(found.id),
    ppRaw: found.statistics?.pp ?? 0,
    ppRank: found.statistics?.global_rank ?? 0
  }
}

/**
 * Two decimals, the way every other stored difficulty number is rounded.
 *
 * v2 hands back the calculator's raw double - 9.24275016784668 - and nothing shows more than two of
 * those digits, so storing them all would only make the pool file harder to read.
 */
const rounded = (rating: number | null | undefined): number | null =>
  rating != null && rating > 0 ? Math.round(rating * 100) / 100 : null

/** The star rating under `mods`, from the difficulty calculator itself. */
async function starRating(beatmapId: number, mods: number): Promise<number | null> {
  const attributes = await api<V2Attributes>(`/beatmaps/${beatmapId}/attributes`, { mods, ruleset: 'osu' })

  return rounded(attributes?.attributes?.star_rating)
}

/**
 * Looks a single beatmap up.
 *
 * `mods` is a legacy bitmask, and the rating comes back adjusted for it: `GET /beatmaps/{id}` answers
 * the plain rating, so anything modded is re-rated through `POST /beatmaps/{id}/attributes`, which is
 * the difficulty calculator itself. The mask is still cut down first, exactly as it was for v1: asked
 * about a contradictory pair (EZ+HR, DT+HT) the endpoint answers a rating of *zero* rather than an
 * error, so a zero is read here as "not known" - and the same mask feeds `withMods` below.
 *
 * The rating is the *only* thing the API adjusts: AR, OD, CS, HP, BPM and length come back plain
 * whatever is asked for, so they are put through `withMods` here and everything on a `BeatmapInfo`
 * then describes the same, modded map.
 */
export async function fetchBeatmap(beatmapId: string, mods: number = Mods.NONE): Promise<BeatmapInfo | null> {
  const difficultyMods = difficultyMask(mods)
  const map = await api<V2Beatmap>(`/beatmaps/${encodeURIComponent(beatmapId)}`)

  if (map?.id == null) return null

  // Every mod the mask keeps moves the number, HD and TD included - the current calculator rates a
  // hidden map higher and a touch-device one lower - so only a genuinely plain slot skips the second
  // call and takes the rating the first one already carried.
  const stars = difficultyMods === Mods.NONE
    ? rounded(map.difficulty_rating)
    : await starRating(map.id, difficultyMods)

  return {
    beatmapId: String(map.id),
    beatmapsetId: map.beatmapset_id == null ? null : String(map.beatmapset_id),
    artist: map.beatmapset?.artist ?? null,
    title: map.beatmapset?.title ?? null,
    version: map.version ?? null,
    stars,
    difficulty: withMods({
      cs: map.cs ?? null,
      ar: map.ar ?? null,
      od: map.accuracy ?? null,
      hp: map.drain ?? null,
      bpm: map.bpm ?? null,
      lengthSeconds: map.total_length ?? null
    }, difficultyMods)
  }
}

const toMatch = (match: V2Match | undefined): OsuMatch | null =>
  match?.id != null && match.start_time
    ? {
        matchId: match.id,
        name: match.name ?? '',
        startedAt: Date.parse(match.start_time),
        endedAt: match.end_time ? Date.parse(match.end_time) : null
      }
    : null

/**
 * One page of the match history, newest first, and the cursor to the page after it.
 *
 * The history is every tournament lobby on the server - around a thousand an hour - so a caller reads
 * back only as far as it has to.
 */
export async function fetchMatchHistory(cursor: string | null): Promise<{ matches: OsuMatch[], cursor: string | null } | null> {
  const page = await api<{ matches?: V2Match[], cursor_string?: string | null }>(
    `/matches?limit=50&sort=id_desc${cursor ? `&cursor_string=${encodeURIComponent(cursor)}` : ''}`
  )
  if (page == null) return null

  return {
    matches: (page.matches ?? []).flatMap(match => toMatch(match) ?? []),
    cursor: page.cursor_string ?? null
  }
}

/** A game's or a score's mods, whichever spelling the API used, as one legacy bitmask. */
const modMask = (mods: (string | { acronym?: string })[] | undefined): number =>
  (mods ?? []).reduce<number>((mask, mod) => {
    const acronym = typeof mod === 'string' ? mod : mod.acronym ?? ''

    return mask | parseMods(acronym)
  }, Mods.NONE)

function toGame(game: V2MatchGame | undefined, usernames: Map<number, string>): OsuGame | null {
  // A game still being played has no end time and no scores worth reading yet.
  if (game?.id == null || game.beatmap_id == null || !game.start_time || !game.end_time) return null

  const scores = (game.scores ?? []).flatMap((score): OsuGameScore[] => {
    if (score.user_id == null) return []

    const value = score.total_score ?? score.legacy_total_score ?? score.score ?? 0

    return [{
      osuId: String(score.user_id),
      username: usernames.get(score.user_id) ?? String(score.user_id),
      score: value,
      mods: modMask(score.mods),
      passed: score.passed ?? score.match?.pass ?? true
    }]
  })

  return {
    gameId: game.id,
    beatmapId: String(game.beatmap_id),
    mods: modMask(game.mods),
    startedAt: Date.parse(game.start_time),
    scores
  }
}

/**
 * One page of a lobby's history: the match itself, and the finished games among the events on it.
 *
 * Events come back oldest first, up to 100 a page, and the newest page is what arrives without
 * `before`. Reading a whole lobby is therefore a matter of asking for the page before the oldest
 * event seen until the first event of the match turns up - or until an event already on file does,
 * which for a lobby polled every minute is the first page nearly every time.
 */
export async function fetchMatchPage(matchId: number, before: number | null = null): Promise<OsuMatchPage | null> {
  const detail = await api<V2MatchDetail>(
    `/matches/${matchId}?limit=100${before == null ? '' : `&before=${before}`}`
  )
  const match = toMatch(detail?.match)
  if (match == null) return null

  const usernames = new Map(
    (detail?.users ?? []).flatMap(user => user.id != null && user.username ? [[user.id, user.username] as const] : [])
  )
  const events = (detail?.events ?? []).filter(event => event.id != null)
  const ids = events.map(event => event.id!)
  const unfinished = events.filter(event => event.game != null && !event.game.end_time).map(event => event.id!)

  return {
    match,
    games: events.flatMap(event => toGame(event.game, usernames) ?? []),
    oldestEventId: ids.length > 0 ? Math.min(...ids) : null,
    settledEventId: ids.length === 0
      ? null
      : unfinished.length > 0 ? Math.min(...unfinished) - 1 : Math.max(...ids),
    firstEventId: detail?.first_event_id ?? null
  }
}

/** The match ID in a pasted lobby link - `/community/matches/123`, `/mp/123` - or a bare number. */
export function matchIdIn(input: string): number | null {
  const match = /(?:\/(?:matches|mp)\/|^)(\d+)(?:[/#?].*)?$/.exec(input.trim())

  return match ? Number(match[1]) : null
}

/**
 * Asks for a token once at boot, so refused or missing credentials show up in the log then rather
 * than as a mappool that quietly refuses to resolve hours later.
 */
export async function checkOsuApi(): Promise<void> {
  if (!osuApiReady()) {
    console.warn('[osu] OSU_CLIENT_ID/OSU_CLIENT_SECRET are not set - player and beatmap lookups are unavailable')

    return
  }

  if (await accessToken()) console.info('[osu] API v2 credentials accepted')
  else console.error('[osu] osu! refused the API credentials - player and beatmap lookups will fail')
}

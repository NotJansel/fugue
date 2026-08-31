import type { BeatmapDifficulty } from './difficulty'
import { config, osuOauthConfigured } from './config'
import { withMods } from './difficulty'
import { Mods, difficultyMask } from './mods'

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

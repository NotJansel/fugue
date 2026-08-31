import type { OsuLink } from '#shared/types'
import { config } from './config'

export const OSU_STATE_COOKIE = 'ba_osu_state'

const TOKEN_URL = 'https://osu.ppy.sh/oauth/token'
const ME_URL = 'https://osu.ppy.sh/api/v2/me'

/**
 * Swaps the OAuth code for the osu! account behind it.
 *
 * Only the `identify` scope is requested, and the tokens are dropped as soon as the account has been
 * read: nothing here needs to call the API on a user's behalf afterwards.
 */
export async function exchangeOsuCode(code: string): Promise<OsuLink | null> {
  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'accept': 'application/json' },
    body: new URLSearchParams({
      client_id: config.osuClientId ?? '',
      client_secret: config.osuClientSecret ?? '',
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${config.publicUrl}/osu/callback`
    })
  })

  if (!tokenResponse.ok) {
    console.warn(`[auth] osu! token exchange returned HTTP ${tokenResponse.status}`)

    return null
  }

  const accessToken = (await tokenResponse.json() as { access_token?: string }).access_token
  if (!accessToken) return null

  const meResponse = await fetch(ME_URL, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }
  })

  if (!meResponse.ok) {
    console.warn(`[auth] osu! /me returned HTTP ${meResponse.status}`)

    return null
  }

  const me = await meResponse.json() as {
    id?: number | string
    username?: string
    avatar_url?: string | null
    country_code?: string | null
    statistics?: { pp?: number | null, global_rank?: number | null }
  }

  if (me.id == null) return null

  const osuId = String(me.id)

  return {
    osuId,
    username: me.username ?? osuId,
    avatarUrl: me.avatar_url ?? null,
    countryCode: me.country_code ?? null,
    ppRaw: me.statistics?.pp ?? null,
    ppRank: me.statistics?.global_rank ?? null,
    linkedAt: Date.now()
  }
}

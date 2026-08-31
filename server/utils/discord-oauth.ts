import type { UserSession } from '#shared/types'
import { PermissionsBitField } from 'discord.js'
import { getClient } from '../bot/client'
import { config } from './config'

export const DISCORD_STATE_COOKIE = 'ba_oauth_state'

const TOKEN_URL = 'https://discord.com/api/v10/oauth2/token'
const ME_URL = 'https://discord.com/api/v10/users/@me'

/**
 * Why a login could not be completed.
 *
 * None of these answer with a gateway status: a proxy that generates its own 502/504 pages
 * (Cloudflare does) replaces the body of those, so the explanation never reaches the browser and a
 * plain misconfiguration reads as a broken reverse proxy.
 */
export type LoginFailure
  /** Discord refused the code or would not say who it belongs to. */
  = | 'UPSTREAM'
  /** The bot cannot vouch for anyone right now - see the log for which half is missing. */
    | 'UNAVAILABLE'
  /** Signed in to Discord, but not a member of the tournament guild. */
    | 'OUTSIDER'

export type LoginOutcome
  = | { kind: 'ok', session: UserSession }
    | { kind: 'failed', reason: LoginFailure }

type Standing
  = | { kind: 'member', admin: boolean }
    | { kind: 'outsider' }
    | { kind: 'unknown' }

/**
 * Asks the tournament guild what the user is. Non-members get no access, since the dashboard exposes
 * the whole tournament.
 *
 * The ways this can come up empty are kept apart and each logged, because they need different answers
 * and are indistinguishable from the outside: a stale `GUILD_ID` fails every login exactly like a bot
 * that has not finished connecting.
 */
async function resolveStanding(userId: string): Promise<Standing> {
  const client = getClient()

  if (!client?.isReady()) {
    console.warn(`[auth] Cannot place ${userId}: the bot has not connected to Discord yet`)

    return { kind: 'unknown' }
  }

  if (!config.guildId) {
    console.warn(`[auth] Cannot place ${userId}: GUILD_ID is not set`)

    return { kind: 'unknown' }
  }

  try {
    const guild = await client.guilds.fetch(config.guildId).catch(() => null)

    if (!guild) {
      console.error(
        `[auth] GUILD_ID ${config.guildId} is not a guild this bot is in - `
        + 'every dashboard login will fail until that is fixed'
      )

      return { kind: 'unknown' }
    }

    if (guild.ownerId === userId) return { kind: 'member', admin: true }

    const member = await guild.members.fetch(userId).catch(() => null)

    if (!member) {
      console.info(`[auth] ${userId} tried to sign in but is not a member of ${guild.name}`)

      return { kind: 'outsider' }
    }

    return { kind: 'member', admin: member.permissions.has(PermissionsBitField.Flags.Administrator) }
  } catch (error) {
    console.error(`[auth] Failed to check guild standing for ${userId}:`, error)

    return { kind: 'unknown' }
  }
}

/** Swaps the OAuth code for a user, then resolves their standing in the tournament guild. */
export async function exchangeDiscordCode(code: string): Promise<LoginOutcome> {
  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.oauthClientId ?? '',
      client_secret: config.oauthClientSecret ?? '',
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${config.publicUrl}/callback`
    })
  })

  if (!tokenResponse.ok) {
    console.warn(`[auth] Discord token exchange returned HTTP ${tokenResponse.status}`)

    return { kind: 'failed', reason: 'UPSTREAM' }
  }

  const accessToken = (await tokenResponse.json() as { access_token?: string }).access_token

  if (!accessToken) {
    console.warn('[auth] Discord accepted the code but returned no access_token')

    return { kind: 'failed', reason: 'UPSTREAM' }
  }

  const meResponse = await fetch(ME_URL, { headers: { authorization: `Bearer ${accessToken}` } })

  if (!meResponse.ok) {
    console.warn(`[auth] Discord identity lookup returned HTTP ${meResponse.status}`)

    return { kind: 'failed', reason: 'UPSTREAM' }
  }

  const me = await meResponse.json() as {
    id?: string
    username?: string
    global_name?: string | null
    avatar?: string | null
  }

  if (!me.id) {
    console.warn('[auth] Discord identity response carried no user id')

    return { kind: 'failed', reason: 'UPSTREAM' }
  }

  const standing = await resolveStanding(me.id)

  if (standing.kind === 'outsider') return { kind: 'failed', reason: 'OUTSIDER' }
  if (standing.kind === 'unknown') return { kind: 'failed', reason: 'UNAVAILABLE' }

  return {
    kind: 'ok',
    session: {
      id: me.id,
      username: me.global_name ?? me.username ?? me.id,
      avatar: me.avatar ?? null,
      admin: standing.admin
    }
  }
}

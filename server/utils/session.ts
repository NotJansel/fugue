import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import { useSession } from 'h3'
import type { UserSession } from '#shared/types'
import { config, osuLinkEnforced } from './config'
import { apiError } from './http-error'

const SESSION_COOKIE = 'ba_session'
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

/** Path that starts the osu! half of the login flow. */
export const OSU_LINK_PATH = '/link/osu'

// h3 seals the cookie with this, and wants at least 32 characters - hashing means any SESSION_SECRET
// is long enough, including the short ones people paste in while setting a deployment up.
const password = createHash('sha256').update(config.sessionSecret).digest('hex')

const sessionOptions = {
  name: SESSION_COOKIE,
  password,
  maxAge: SESSION_TTL_SECONDS,
  cookie: {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.publicUrl.startsWith('https://')
  }
}

/** The signed-in user, or `null` for an anonymous visitor. */
export async function getUserSession(event: H3Event): Promise<UserSession | null> {
  const session = await useSession<{ user?: UserSession }>(event, sessionOptions)

  return session.data.user ?? null
}

export async function setUserSession(event: H3Event, user: UserSession): Promise<void> {
  const session = await useSession<{ user?: UserSession }>(event, sessionOptions)
  await session.update({ user })
}

export async function clearUserSession(event: H3Event): Promise<void> {
  const session = await useSession<{ user?: UserSession }>(event, sessionOptions)
  await session.clear()
}

/** Whether the session may use the dashboard: linking is only a gate once it is set up *and* required. */
export const osuLinkSatisfied = (user: UserSession): boolean => !osuLinkEnforced() || user.osuId != null

/**
 * The session behind a write.
 *
 * A session that exists but has not finished the osu! half of the login is told to go and link,
 * rather than being made to sign in all over again - the same two answers the Ktor challenge gave.
 */
export async function requireSession(event: H3Event): Promise<UserSession> {
  const user = await getUserSession(event)

  if (!user) throw apiError(401, 'Not signed in.', 'err.session.none')

  if (!osuLinkSatisfied(user)) {
    throw apiError(403, 'Link your osu! account to continue.', 'err.session.link', {}, OSU_LINK_PATH)
  }

  return user
}

/** Requires the caller to be an administrator in the tournament guild. */
export async function requireAdmin(event: H3Event): Promise<UserSession> {
  const user = await requireSession(event)

  if (!user.admin) {
    throw apiError(403, 'You need Administrator in the tournament server to do that.', 'err.admin')
  }

  return user
}

import { randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { deleteCookie, getCookie, getQuery, setCookie } from 'h3'
import { config } from './config'

const STATE_TTL_SECONDS = 600

/**
 * Starts an OAuth2 round-trip: returns a fresh `state` value and remembers it in a one-shot cookie,
 * so the callback can tell its own redirect apart from one someone else triggered.
 */
export function issueState(event: H3Event, cookieName: string): string {
  const state = randomBytes(24).toString('hex')

  setCookie(event, cookieName, state, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.publicUrl.startsWith('https://'),
    maxAge: STATE_TTL_SECONDS
  })

  return state
}

/**
 * Checks the `state` query parameter against the cookie and clears the cookie either way, so a failed
 * or replayed callback cannot be retried with the same value.
 */
export function consumeState(event: H3Event, cookieName: string): boolean {
  const expected = getCookie(event, cookieName)
  const actual = getQuery(event).state

  deleteCookie(event, cookieName, { path: '/' })

  return typeof actual === 'string' && actual !== '' && actual === expected
}

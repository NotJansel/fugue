import type { UserSession } from '#shared/types'
import { changeGeneration } from './bus'
import { buildDashboardState } from './dashboard'

/**
 * The dashboard state as the event stream sends it, built once per change for everyone who sees
 * the same thing rather than once per open tab.
 *
 * Apart from the `user` field, what `buildDashboardState` returns depends only on who is looking -
 * a guest, a signed-in member, an organiser - so one build and one `JSON.stringify` serves every
 * connection in that audience. Built per connection, an evening's worth of open tabs turned every
 * bid into dozens of full builds, qualifier Z-sums and all, blocking the server while it did.
 */
type Audience = 'guest' | 'member' | 'admin'

const audienceOf = (user: UserSession | null): Audience =>
  user == null ? 'guest' : user.admin ? 'admin' : 'member'

/**
 * How long a build is reused while nothing has emitted a change. Short: the odd piece of state that
 * moves without a change signal still reaches the page by the next heartbeat.
 */
const REUSE_MS = 1_000

const cache = new Map<Audience, { generation: number, builtAt: number, json: string }>()

/** The state for `user`'s audience as JSON, without the two fields each message fills in itself. */
export function sharedStateJson(user: UserSession | null): string {
  const audience = audienceOf(user)
  const generation = changeGeneration()
  const hit = cache.get(audience)

  if (hit && hit.generation === generation && Date.now() - hit.builtAt < REUSE_MS) return hit.json

  const { user: _user, serverTime: _serverTime, ...shared } = buildDashboardState(user)
  const json = JSON.stringify(shared)
  cache.set(audience, { generation, builtAt: Date.now(), json })

  return json
}

/** One full `DashboardState` message: this connection's `user` and the clock, then the shared rest. */
export const stateMessage = (userJson: string, sharedJson: string): string =>
  `{"serverTime":${Date.now()},"user":${userJson},${sharedJson.slice(1)}`

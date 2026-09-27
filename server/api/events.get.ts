import { createEventStream, defineEventHandler } from 'h3'
import { onChange } from '../utils/bus'
import { sharedStateJson, stateMessage } from '../utils/dashboard-feed'
import { trackPresence } from '../utils/presence'
import { getUserSession, osuLinkSatisfied } from '../utils/session'

const HEARTBEAT_MS = 20_000
const COALESCE_MS = 100

/**
 * Pushes the full dashboard state whenever it changes for this viewer.
 *
 * Sending the whole state rather than deltas keeps clients trivially consistent. But every push makes
 * the page re-render from scratch, which on a big seeding table is work a slower machine notices - so
 * nothing is sent that this viewer would see no difference in: a change only an organiser can see
 * (who is online), or a heartbeat with nothing new. Updates are conflated and slightly delayed so a
 * burst of bids collapses into one send. The heartbeat keeps idle connections alive through proxies
 * and, when there is nothing else to say, just carries the server's clock (`clock` event).
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const user = session && osuLinkSatisfied(session) ? session : null
  const userJson = JSON.stringify(user)

  const stream = createEventStream(event)

  let pending: NodeJS.Timeout | null = null
  let lastSent: string | null = null

  /** Sends the state if it differs from what this connection last got. Returns whether it did. */
  const push = (): boolean => {
    const shared = sharedStateJson(user)
    if (shared === lastSent) return false

    lastSent = shared
    void stream.push(stateMessage(userJson, shared))

    return true
  }

  const schedule = () => {
    if (pending) return

    pending = setTimeout(() => {
      pending = null
      push()
    }, COALESCE_MS)
  }

  const unsubscribe = onChange(schedule)
  // An open stream is what "on the dashboard right now" means - what organisers see as online.
  const leave = user ? trackPresence(user.id) : null

  const heartbeat = setInterval(() => {
    if (!push()) void stream.push({ event: 'clock', data: String(Date.now()) })
  }, HEARTBEAT_MS)

  stream.onClosed(() => {
    unsubscribe()
    leave?.()
    clearInterval(heartbeat)
    if (pending) clearTimeout(pending)
  })

  push()

  return stream.send()
})

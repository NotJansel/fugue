import { createEventStream, defineEventHandler } from 'h3'
import { onChange } from '../utils/bus'
import { buildDashboardState } from '../utils/dashboard'
import { trackPresence } from '../utils/presence'
import { getUserSession, osuLinkSatisfied } from '../utils/session'

const HEARTBEAT_MS = 20_000
const COALESCE_MS = 100

/**
 * Pushes the full dashboard state on every change.
 *
 * Sending the whole state rather than deltas keeps clients trivially consistent; the payload is a few
 * KB at most. Updates are conflated and slightly delayed so a burst of bids collapses into one send,
 * and a periodic tick keeps idle connections alive through proxies.
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const user = session && osuLinkSatisfied(session) ? session : null

  const stream = createEventStream(event)

  let pending: NodeJS.Timeout | null = null

  const push = () => {
    void stream.push(JSON.stringify(buildDashboardState(user)))
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
  const heartbeat = setInterval(push, HEARTBEAT_MS)

  stream.onClosed(() => {
    unsubscribe()
    leave?.()
    clearInterval(heartbeat)
    if (pending) clearTimeout(pending)
  })

  push()

  return stream.send()
})

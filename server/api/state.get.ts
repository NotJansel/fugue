import { defineEventHandler } from 'h3'
import { buildDashboardState } from '../utils/dashboard'
import { getUserSession, osuLinkSatisfied } from '../utils/session'

/**
 * The dashboard's one public read: reachable without a login.
 *
 * A signed-in caller gets their own session back in the payload; an anonymous one gets a redacted
 * state instead of a 401. A session that exists but hasn't finished linking osu! counts as anonymous
 * here rather than being turned away, so the page can still render behind the "link your account"
 * prompt.
 */
export default defineEventHandler(async (event) => {
  const user = await getUserSession(event)

  return buildDashboardState(user && osuLinkSatisfied(user) ? user : null)
})

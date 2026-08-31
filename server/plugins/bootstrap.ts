import { defineNitroPlugin } from 'nitropack/runtime'
import { startBot, stopBot } from '../bot'
import { shutdownAuction } from '../utils/auction'
import { warnAboutMissingValues } from '../utils/config'
import { checkOsuApi } from '../utils/osu-api'
import { loadOsuLinks } from '../utils/osu-link-store'
import { loadPurses } from '../utils/purse-store'
import { loadTournament } from '../utils/tournament-store'

/**
 * Boots everything that isn't a request.
 *
 * The stores are read first so the very first page load already has the tournament on it, then the
 * bot is started *without* being awaited: Discord can take a few seconds to hand over a session, and
 * there is no reason for the dashboard to be down while it does.
 */
export default defineNitroPlugin((nitro) => {
  warnAboutMissingValues()

  const ready = Promise.all([loadTournament(), loadPurses(), loadOsuLinks()])
    .then(() => Promise.all([startBot(), checkOsuApi()]))
    .catch(error => console.error('[boot] Startup failed:', error))

  nitro.hooks.hook('close', async () => {
    shutdownAuction()
    await ready
    await stopBot()
  })
})

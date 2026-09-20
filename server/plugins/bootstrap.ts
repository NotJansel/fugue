import { defineNitroPlugin } from 'nitropack/runtime'
import { startBot, stopBot } from '../bot'
import { shutdownAuction } from '../utils/auction'
import { warnAboutMissingValues } from '../utils/config'
import { closeDatabase, migrate } from '../utils/db'
import { importLegacyData } from '../utils/legacy-import'
import { loadLobbies } from '../utils/lobby-store'
import { loadManualScores } from '../utils/manual-score-store'
import { checkOsuApi } from '../utils/osu-api'
import { loadOsuLinks } from '../utils/osu-link-store'
import { loadPurses } from '../utils/purse-store'
import { startLobbyWatch, stopLobbyWatch } from '../utils/qualifier-lobbies'
import { loadTournament } from '../utils/tournament-store'

/**
 * Boots everything that isn't a request.
 *
 * The schema is applied and the stores are read first, so the very first page load already has the
 * tournament on it; then the bot is started *without* being awaited, because Discord can take a few
 * seconds to hand over a session and there is no reason for the dashboard to be down while it does.
 *
 * An unreachable database is the one thing that is fatal. Everything else here degrades - no token
 * runs the dashboard alone, no osu! credentials means no lookups - but without storage there is no
 * tournament to serve, and starting anyway would let an evening's work be typed into nothing.
 */
export default defineNitroPlugin((nitro) => {
  warnAboutMissingValues()

  const ready = migrate()
    .then(importLegacyData)
    .then(() => Promise.all([
      loadTournament(), loadPurses(), loadOsuLinks(), loadLobbies(), loadManualScores()
    ]))
    .then(() => Promise.all([startBot(), checkOsuApi()]))
    // After the stores, so the first poll already knows which lobbies are still to be read.
    .then(startLobbyWatch)
    .catch((error) => {
      console.error('[boot] Startup failed:', error)

      // Nitro is already listening by now, so leaving it up would serve an empty tournament over a
      // real one. Exiting instead lets whatever supervises the process bring it back when the
      // database is there - which is what `depends_on` and a restart policy are for.
      setTimeout(() => process.exit(1), 0).unref()
    })

  nitro.hooks.hook('close', async () => {
    shutdownAuction()
    stopLobbyWatch()
    await ready.catch(() => {})
    await stopBot()
    await closeDatabase()
  })
})

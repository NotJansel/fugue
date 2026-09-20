import { defineEventHandler, setHeader } from 'h3'
import { formatCsv } from '../../utils/csv'
import { allLobbyScores } from '../../utils/lobby-store'
import { fetchCountryCodes, osuApiReady } from '../../utils/osu-api'
import { scoresCsv } from '../../utils/seeding-export'
import { requireAdmin } from '../../utils/session'
import { qualifierResults } from '../../utils/tournament-model'
import { getTournament, saveCountryCodes } from '../../utils/tournament-store'

/**
 * The qualifier results as the `scores.csv` a bracket tool reads.
 *
 * Flags are the one thing the dashboard has no use for and therefore may not have on file, so anyone
 * in the export still missing a country code is looked up first - fifty at a time, so a full field
 * costs a request or two - and what comes back is kept, which leaves the next export doing nothing.
 * A lookup that fails, or an osu! API that isn't configured, writes a blank flag rather than a 503:
 * the scores are the point of the file and they are all on file already.
 */
export default defineEventHandler(async (event): Promise<string> => {
  await requireAdmin(event)

  const scored = new Set(qualifierResults(getTournament(), allLobbyScores()).scored)
  const missing = getTournament().players
    .filter(player => scored.has(player.osuId) && !player.countryCode)
    .map(player => player.osuId)

  if (missing.length > 0 && osuApiReady()) await saveCountryCodes(await fetchCountryCodes(missing))

  setHeader(event, 'content-type', 'text/csv; charset=utf-8')
  setHeader(event, 'content-disposition', 'attachment; filename="scores.csv"')

  return formatCsv(scoresCsv(getTournament(), allLobbyScores()))
})

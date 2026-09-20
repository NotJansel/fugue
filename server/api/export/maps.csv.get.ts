import { defineEventHandler, setHeader } from 'h3'
import { formatCsv } from '../../utils/csv'
import { mapsCsv } from '../../utils/seeding-export'
import { requireAdmin } from '../../utils/session'
import { getTournament } from '../../utils/tournament-store'

/** The qualifier pool as the `maps.csv` that goes with `scores.csv`: slot names, then beatmap IDs. */
export default defineEventHandler(async (event): Promise<string> => {
  await requireAdmin(event)

  setHeader(event, 'content-type', 'text/csv; charset=utf-8')
  setHeader(event, 'content-disposition', 'attachment; filename="maps.csv"')

  return formatCsv(mapsCsv(getTournament()))
})

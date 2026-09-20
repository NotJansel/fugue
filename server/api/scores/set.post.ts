import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { emitChange } from '../../utils/bus'
import { apiError } from '../../utils/http-error'
import { allLobbyScores } from '../../utils/lobby-store'
import { allManualScores, clearManualScore, setManualScore } from '../../utils/manual-score-store'
import { requireAdmin } from '../../utils/session'
import { getTournament, reseedByZSum } from '../../utils/tournament-store'

interface Body {
  osuId?: string
  mapId?: string
  /** As osu! would have reported it. `null` takes the typed-in score off again. */
  score?: number | null
  /** The whole combination it was played with, the slot's own mods included. */
  mods?: string | null
}

/**
 * Tells the dashboard, after putting the seeding where the results now say it belongs.
 *
 * The same order the lobby watch uses, and for the same reason: reseeding first and emitting once
 * keeps a dashboard from rendering results and a seeding that disagree. A locked seeding is left
 * alone - that is what the lock is for - and the new score still shows.
 */
async function publish(): Promise<void> {
  if (!getTournament().seedingLocked) await reseedByZSum(allLobbyScores(), allManualScores())

  emitChange()
}

/**
 * Puts a score on a player's cell by hand, or takes one off again.
 *
 * What this is for is a run osu! has no usable record of - a disconnect early enough to submit
 * nothing, or early enough to submit something worse than nothing. Neither can be fixed by reading
 * the lobby again, so the number goes in by hand and wins over whatever the lobby or the sheet says
 * about that one cell. Clearing it hands the cell straight back to them.
 *
 * The score is taken as osu! would have reported it, mods and all, so it is normalised on the way to
 * the dashboard exactly like a score that was read - an organiser types what they saw, not what they
 * worked out it ought to count as.
 */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<Body>(event)
  const osuId = (body.osuId ?? '').trim()
  const mapId = (body.mapId ?? '').trim()

  const tournament = getTournament()
  const player = tournament.players.find(candidate => candidate.osuId === osuId)
  if (!player) throw apiError(404, 'That player isn\'t in the tournament.', 'err.player.unknown')

  const slot = tournament.mappool.find(map => map.id === mapId)
  if (!slot) throw apiError(404, 'That map is not in the pool.', 'err.map.unknown')

  const args = { name: player.username, slot: slot.label }

  if (body.score == null) {
    const cleared = await clearManualScore(osuId, mapId)
    if (!cleared) throw apiError(404, 'No score was entered for that cell.', 'err.score.notManual')

    await publish()

    return {
      ok: true,
      message: `Removed the score entered for ${player.username} on ${slot.label}.`,
      code: 'ok.score.cleared',
      args
    }
  }

  if (!Number.isFinite(body.score) || body.score < 0) {
    throw apiError(400, 'A score has to be a number, and not a negative one.', 'err.score.invalid')
  }

  const score = Math.round(body.score)

  await setManualScore(osuId, mapId, score, body.mods ?? '')
  await publish()

  return {
    ok: true,
    message: `Entered ${score} for ${player.username} on ${slot.label}.`,
    code: 'ok.score.set',
    args: { ...args, score: `${score}` }
  }
})

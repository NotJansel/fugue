import type { LobbyScore, QualifierMap, TournamentState } from '#shared/types'
import { qualifierMaps, qualifierResults } from './tournament-model'

/**
 * The qualifier results and the mappool, in the two CSV shapes a bracket tool reads.
 *
 * Neither file is a view of this dashboard: they are handed to something else, so the columns are
 * fixed by that format rather than by what the results page happens to show. Both are built from the
 * same derivation the dashboard renders (`qualifierResults`), so an export can never disagree with
 * the screen it was taken from.
 *
 * Qualifiers here are *solo*, which is why every row is a team of one: the team is the player, its
 * flag is their country, and the team size column is always 1. The format keeps the team columns all
 * the same so a team tournament's file and this one can be read by the same code.
 */

/** A row of `scores.csv` before it is flattened - kept apart so the header can be built from it. */
interface TeamRow {
  name: string
  flag: string
  osuId: string
  /** Per qualifier slot, in pool order: the score that counts, 0 for a slot they never played. */
  values: number[]
  /** Per qualifier slot, the Z-score behind that value - the term the seeding is a sum of. */
  zs: number[]
}

/** One bracket of the pool - the slots sharing a prefix, in the order the pool first names them. */
interface ModPool {
  name: string
  /** Indices into the slot list, so a pool's scores are read straight off a row. */
  slots: number[]
}

/**
 * Which bracket a slot belongs to: the letters its name starts with ("NM1" -> NM, "TB" -> TB).
 *
 * A slot named without letters at all has no bracket to speak of, so it falls back to the mods it is
 * played with, and failing those to NM - the export has to name a column either way.
 */
const bracketOf = (map: QualifierMap): string =>
  (/^[a-z]+/i.exec(map.label.trim())?.[0] ?? '').toUpperCase() || map.mods || 'NM'

/** The brackets of a pool, in the order their first slot appears. */
function modPools(maps: QualifierMap[]): ModPool[] {
  const pools: ModPool[] = []

  for (const [index, map] of maps.entries()) {
    const name = bracketOf(map)
    const pool = pools.find(candidate => candidate.name === name)

    if (pool) pool.slots.push(index)
    else pools.push({ name, slots: [index] })
  }

  return pools
}

/**
 * Competition-style ranks over `values`, highest first: equal values share a rank and the next one
 * skips, so two teams tied for second are both 2 and the one behind them is 4.
 *
 * Returned in the order the values came in, since every block of the row is indexed by team.
 */
function ranks(values: number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value)
  const result = new Array<number>(values.length).fill(0)

  let previous: number | null = null
  let previousRank = 0

  order.forEach(({ value, index }, position) => {
    const rank = value === previous ? previousRank : position + 1
    previous = value
    previousRank = rank
    result[index] = rank
  })

  return result
}

/**
 * `scores.csv`: one row per team, in seeding order.
 *
 * Left to right: team name, team flag, every map score, the overall seeding, the seeding within each
 * mod bracket, the seeding on each map, the team size, then every player ID and every player flag.
 *
 * Everyone who played the qualifiers is written, the field cut notwithstanding: the cut decides who
 * is bought at auction, not who turned up and set a score, and a bracket tool asking for the results
 * is asking for all of them. Only a player with no result at all is left out, since a row of zeroes
 * is not a seeding. Scores are the ones the seeding goes by, normalised to what the play would have
 * been worth at 1x. A map a team never played is a 0, and is ranked as one, which is how the Z-sum
 * counts it.
 *
 * The overall seeding is this tournament's own - the order of the list, which follows the Z-sum
 * while the seeding is unlocked and follows the organiser once it isn't - numbered 1..N over the
 * rows that made it into the file, so the export can never disagree with the seed on screen. The
 * other two blocks are ranks among those same teams: a bracket's is the Z-sum over that bracket's
 * slots alone, a map's is the score on it.
 */
export function scoresCsv(state: TournamentState, lobbyScores: LobbyScore[]): string[][] {
  const maps = qualifierMaps(state)
  const pools = modPools(maps)
  const results = qualifierResults(state, lobbyScores)
  const scored = new Set(results.scored)

  const teams: TeamRow[] = state.players
    .filter(player => scored.has(player.osuId))
    .map((player) => {
      const values = maps.map(map => results.scores[player.osuId]?.[map.id]?.value ?? 0)

      return {
        name: player.username,
        flag: player.countryCode ?? '',
        osuId: player.osuId,
        values,
        // Not the `z` on the score itself: a slot a team never played has no score to carry one, and
        // it still counts against them as a zero.
        zs: maps.map((map, index) => {
          const stats = results.mapStats[map.id]

          return stats ? (values[index]! - stats.mean) / stats.sd : 0
        })
      }
    })

  const sumOver = (team: TeamRow, slots: number[]): number =>
    slots.reduce((sum, slot) => sum + team.zs[slot]!, 0)

  const poolSeeds = pools.map(pool => ranks(teams.map(team => sumOver(team, pool.slots))))
  const mapSeeds = maps.map((_, index) => ranks(teams.map(team => team.values[index]!)))

  const header = [
    'Team',
    'Flag',
    ...maps.map(map => map.label),
    'Seed',
    ...pools.map(pool => `${pool.name} Seed`),
    ...maps.map(map => `${map.label} Seed`),
    'Size',
    'Player 1 ID',
    'Player 1 Flag'
  ]

  const rows = teams.map((team, index) => [
    team.name,
    team.flag,
    ...team.values.map(value => String(Math.round(value))),
    String(index + 1),
    ...poolSeeds.map(seeds => String(seeds[index])),
    ...mapSeeds.map(seeds => String(seeds[index])),
    '1',
    team.osuId,
    team.flag
  ])

  return [header, ...rows]
}

/**
 * `maps.csv`: the slot names as a header row, the beatmap IDs as the one row under it.
 *
 * The same slots `scores.csv` writes its score columns for, in the same order, so the two files line
 * up. A slot with no beatmap on it yet leaves its cell empty rather than shifting the columns along.
 */
export function mapsCsv(state: TournamentState): string[][] {
  const maps = qualifierMaps(state)

  return [maps.map(map => map.label), maps.map(map => map.beatmapId ?? '')]
}

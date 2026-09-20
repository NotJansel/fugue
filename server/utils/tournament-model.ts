import type {
  LobbyScore,
  MapScore,
  QualifierMap,
  TournamentPlayer,
  TournamentState,
  TournamentWarning
} from '#shared/types'
import { difficultyMask, formatMods, normalizeMods, osuMultiplier, parseMods, scoringMods } from './mods'

export const DEFAULT_TEAM_SIZE = 4

/**
 * Defaults that leave an existing tournament behaving exactly as it did: no field cut, no reserve,
 * no ceiling on a raise. Every rule below is something an organiser turns on deliberately.
 */
export const emptyTournament = (): TournamentState => ({
  players: [],
  fieldSize: null,
  minTeamSize: 0,
  minBidIncrement: 1,
  maxBidIncrement: 0,
  secondRun: false,
  modMultipliers: {},
  teamSize: DEFAULT_TEAM_SIZE,
  captainCountOverride: null,
  seedingLocked: false,
  defaultStartingBid: 0,
  defaultMaxBid: 0,
  rosters: {},
  teamNames: {},
  mappool: [],
  removedPlayers: [],
  sheet: null,
  mappoolSheet: null,
  registrationSheet: null
})

/** `1,234,567` or `12,345` - digits in groups of three, i.e. thousands separators, not a decimal comma. */
const thousandsGrouped = /^-?\d{1,3}(,\d{3})+$/

/**
 * Reads a number out of a spreadsheet cell.
 *
 * CSV exports carry whatever the organiser typed, so this copes with percent signs, spaces and both
 * comma conventions. A comma is only read as a decimal separator when the value is *not* grouped into
 * threes - so `0,85` is 0.85 while `987,654` is 987654, which is what tournament sheets mean by each.
 */
export function parseSheetNumber(input: string): number | null {
  const cleaned = input.trim().replaceAll('%', '').replaceAll(' ', '').replaceAll('\'', '')

  const normalised = thousandsGrouped.test(cleaned)
    ? cleaned.replaceAll(',', '')
    : (cleaned.split(',').length - 1) === 1 && !cleaned.includes('.')
        ? cleaned.replace(',', '.')
        : cleaned.replaceAll(',', '')

  if (normalised === '' || Number.isNaN(Number(normalised))) return null

  return Number(normalised)
}

/**
 * The players who take part: the top `fieldSize` of the seeding, or everyone when it is unset.
 *
 * Everything below is derived from this rather than from `players`, so a qualifier who missed the
 * cut keeps their seed and their results but is out of the captain count, the pool and the auction.
 */
export function field(state: TournamentState): TournamentPlayer[] {
  const size = state.fieldSize

  return size == null || size <= 0 ? state.players : state.players.slice(0, size)
}

/**
 * How many captains this tournament should have.
 *
 * Derived as `field / teamSize` (floored) so that adding or removing qualifiers automatically
 * changes the number of teams, unless `captainCountOverride` pins it.
 */
export function captainCount(state: TournamentState): number {
  const taking = field(state)

  if (state.captainCountOverride != null) {
    return Math.min(Math.max(state.captainCountOverride, 0), taking.length)
  }

  if (state.teamSize <= 0) return 0

  return Math.floor(taking.length / state.teamSize)
}

/**
 * The captains, in seeding order: everyone marked `FORCE` first, then the highest seeds still on
 * `AUTO` until the target count is reached. `EXCLUDE` players are never picked, which is what makes
 * "top seed, but not a captain" expressible.
 *
 * `FORCE` is taken off the whole list rather than off the field: an organiser saying someone is a
 * captain settles it, and a captain who never played the qualifiers - a stand-in, or someone brought
 * in to lead a team rather than to qualify for one - has no Z-sum, so the reseed puts them at the
 * bottom of the list where a field cut would otherwise quietly drop them again. `AUTO` still only
 * picks out of the field, since that is the whole point of the cut.
 */
export function captains(state: TournamentState): TournamentPlayer[] {
  const taking = field(state)
  const target = captainCount(state)
  const forced = state.players.filter(player => player.captainMode === 'FORCE')
  const remaining = Math.max(target - forced.length, 0)
  const auto = taking.filter(player => player.captainMode === 'AUTO').slice(0, remaining)
  const chosen = new Set([...forced, ...auto].map(player => player.osuId))

  return state.players.filter(player => chosen.has(player.osuId))
}

/** Players that are not captains - the pool the auction draws from. */
export function pool(state: TournamentState): TournamentPlayer[] {
  const captainIds = new Set(captains(state).map(player => player.osuId))

  return field(state).filter(player => !captainIds.has(player.osuId))
}

/** osu! IDs of every player already bought by some captain. */
export function soldPlayerIds(state: TournamentState): Set<string> {
  return new Set(Object.values(state.rosters).flat().map(member => member.osuId))
}

/** Pool players that have not been auctioned off yet, in seeding order. */
export function unsoldPool(state: TournamentState): TournamentPlayer[] {
  const sold = soldPlayerIds(state)

  return pool(state).filter(player => !sold.has(player.osuId))
}

/**
 * What an auction started right now opens at.
 *
 * The second time round the pool, whatever went unsold is offered at half price - the ceiling and
 * the increments stay where they were, only the entry gets cheaper.
 */
export const startingBid = (state: TournamentState): number =>
  state.secondRun ? Math.round(state.defaultStartingBid / 2) : state.defaultStartingBid

/**
 * Gold a captain must still be able to spend after a bid, to fill their team to the smallest legal
 * size at the starting price. Counting the player currently being bid on as already theirs.
 */
export function reserveFor(state: TournamentState, captainOsuId: string): number {
  const bought = state.rosters[captainOsuId]?.length ?? 0
  const stillNeeded = Math.max((state.minTeamSize - 1) - (bought + 1), 0)

  return stillNeeded * startingBid(state)
}

/** Finds the captain a Discord user controls, if any. */
export function captainForDiscordId(state: TournamentState, discordId: string): TournamentPlayer | null {
  return captains(state).find(player => player.discordId === discordId) ?? null
}

/**
 * The slots a qualifier lobby plays: the round whose name says so, or the whole pool when no round
 * does - a tournament that never labels its rounds still has a qualifier pool.
 */
export function qualifierMaps(state: TournamentState): QualifierMap[] {
  const named = state.mappool.filter(map => /qualif/i.test(map.stage))

  return named.length > 0 ? named : state.mappool
}

/**
 * What a score is multiplied by before it is compared with anything else.
 *
 * Every score, on every slot, is brought back to what it would have been worth at 1x - a forced-mod
 * slot as much as a freemod one, so a DT map's numbers can be read beside a no-mod map's rather than
 * only against each other. The mods asked about are the whole set the score was played with, the
 * lobby's and the player's together.
 *
 * Two different things, either side of EZ. An EZ run - `EZ` or `EZHD` after `normalizeMods`, so an
 * EZ run is scored the same however else it was dressed up - takes the tournament's own rate out of
 * `modMultipliers`, because what EZ is worth is a rule nobody but the organisers can settle. Every
 * other combination is *normalised*: osu! already paid HD 1.06, HR 1.1, HDHR 1.17 and DT 1.2 before
 * the score ever reached us, so the factor is the reciprocal of that and what is left is the play
 * rather than the mods. A combination with no stated figure divides by 1 and stays as it arrived.
 */
export function modMultiplier(state: TournamentState, mods: string): number {
  const played = scoringMods(parseMods(mods))
  const key = formatMods(normalizeMods(played))

  if (key === '') return 1 / osuMultiplier(played)

  const factor = state.modMultipliers?.[key]

  return factor != null && factor > 0 ? factor : 1
}

/** A player's standing after qualifiers: the Z-sum the seeding goes by, and the raw total behind it. */
export interface QualifierStanding {
  zSum: number
  total: number
}

export interface QualifierResults {
  /** `osu! ID -> map id -> score`, for every slot with results from either source. */
  scores: Record<string, Record<string, MapScore>>
  /** Everyone with at least one result on a qualifier slot. */
  standings: Record<string, QualifierStanding>
  /**
   * Per qualifier slot, the field's mean and sample standard deviation - the two numbers every
   * Z-score on that slot comes out of. Absent for a slot with too few scores to deviate. Kept so a
   * caller can work out the Z of a score the results do not list, an unplayed map counting as 0,
   * without re-deriving the field: the seeding export needs exactly that, per mod bracket.
   */
  mapStats: Record<string, { mean: number, sd: number }>
  /** Everyone the deviations are taken over, in seeding order: the field with at least one result. */
  scored: string[]
}

/** Mean and *sample* standard deviation, which is what the seeding method is defined over. */
function deviation(values: number[]): { mean: number, sd: number } | null {
  if (values.length < 2) return null

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  const sd = Math.sqrt(variance)

  return sd > 0 ? { mean, sd } : null
}

/**
 * Every qualifier result and the standings they add up to.
 *
 * Each slot's scores come from the lobbies first: every game played on the slot's beatmap, in any
 * lobby on file, and a player's *best* of them - each player has two runs, and only the better one
 * counts, whichever run it was. `modMultiplier` is applied first, on every slot, so what is compared
 * is what the play would have been worth at 1x: an HDHR run has the 1.17 osu! already paid for it
 * divided back out, and a 1.8x EZ run is ranked at 1.8 times what osu! reported.
 * A slot no lobby has played yet falls back to the sheet column it is bound to, so a tournament that
 * only ever imports a sheet reads exactly as before. A game on a beatmap outside the qualifier pool -
 * a warm-up - matches no slot and is ignored.
 *
 * Standings follow the Z-sum method: on every qualifier slot, each player's score is expressed as
 * the number of standard deviations above or below the mean across the field, and those are summed.
 * The field is everyone with at least one qualifier result, and a map one of them did not play is a
 * score of zero, the way a qualifier sheet counts it. A slot nobody has played contributes nothing.
 *
 * Ranks are competition style: players tied on a map share a rank and the next one skips, and a
 * player with no score on a map simply has no entry - they are not ranked last.
 */
export function qualifierResults(state: TournamentState, lobbyScores: LobbyScore[]): QualifierResults {
  const known = new Set(state.players.map(player => player.osuId))
  // A player imported without an osu! ID is only ever matched by name, so a score set under a name
  // that later turns out to be theirs attaches once enrichment supplies the ID.
  const placeholders = new Map(
    state.players
      .filter(player => player.osuId.startsWith('name:'))
      .map(player => [player.username.toLowerCase(), player.osuId])
  )
  const playerFor = (score: LobbyScore): string | null =>
    known.has(score.osuId) ? score.osuId : placeholders.get(score.username.toLowerCase()) ?? null

  const qualifiers = new Set(qualifierMaps(state).map(map => map.id))

  // Which slot a game belongs to. Two slots on one beatmap - the same map as NM and as DT - are told
  // apart by the mods the game was played with.
  const slotsByBeatmap = new Map<string, QualifierMap[]>()
  for (const map of qualifierMaps(state)) {
    if (map.beatmapId) slotsByBeatmap.set(map.beatmapId, [...(slotsByBeatmap.get(map.beatmapId) ?? []), map])
  }

  const slotFor = (score: LobbyScore): QualifierMap | null => {
    const slots = slotsByBeatmap.get(score.beatmapId) ?? []
    if (slots.length <= 1) return slots[0] ?? null

    const played = difficultyMask(parseMods(score.mods))

    return slots.find(slot => difficultyMask(parseMods(slot.mods)) === played) ?? slots[0]!
  }

  interface Entry {
    value: number
    display: string
    mods: string
    multiplier: number
  }

  const perMap = new Map<string, { source: MapScore['source'], values: Map<string, Entry> }>()

  for (const score of lobbyScores) {
    const slot = slotFor(score)
    const osuId = playerFor(score)
    if (!slot || !osuId) continue

    let entry = perMap.get(slot.id)
    if (!entry) perMap.set(slot.id, entry = { source: 'lobby', values: new Map() })

    const multiplier = modMultiplier(state, score.mods)
    const value = score.score * multiplier

    const best = entry.values.get(osuId)
    if (!best || value > best.value) {
      entry.values.set(osuId, { value, display: String(Math.round(value)), mods: score.ownMods, multiplier })
    }
  }

  for (const map of state.mappool) {
    const column = map.column?.trim()
    if (!column || perMap.has(map.id)) continue

    const values = new Map<string, Entry>()

    for (const player of state.players) {
      const raw = player.extra?.[column]?.trim()
      if (!raw) continue

      const value = parseSheetNumber(raw)
      if (value != null) values.set(player.osuId, { value, display: raw, mods: '', multiplier: 1 })
    }

    if (values.size > 0) perMap.set(map.id, { source: 'sheet', values })
  }

  const field = state.players
    .map(player => player.osuId)
    .filter(osuId => [...perMap].some(([mapId, entry]) => qualifiers.has(mapId) && entry.values.has(osuId)))

  const scores: Record<string, Record<string, MapScore>> = {}
  const standings: Record<string, QualifierStanding> = {}
  const mapStats: Record<string, { mean: number, sd: number }> = {}

  for (const [mapId, { source, values }] of perMap) {
    const stats = qualifiers.has(mapId) ? deviation(field.map(osuId => values.get(osuId)?.value ?? 0)) : null
    if (stats) mapStats[mapId] = stats
    const zOf = (value: number): number | null => stats ? (value - stats.mean) / stats.sd : null

    const ranked = [...values.entries()].sort((a, b) => b[1].value - a[1].value)
    let previous: number | null = null
    let previousRank = 0

    ranked.forEach(([osuId, entry], index) => {
      const rank = entry.value === previous ? previousRank : index + 1
      previous = entry.value
      previousRank = rank

      scores[osuId] ??= {}
      scores[osuId]![mapId] = {
        value: entry.value,
        display: entry.display,
        rank,
        z: zOf(entry.value),
        source,
        mods: entry.mods,
        multiplier: entry.multiplier
      }
    })

    if (!qualifiers.has(mapId)) continue

    for (const osuId of field) {
      const value = values.get(osuId)?.value ?? 0
      const standing = standings[osuId] ??= { zSum: 0, total: 0 }

      standing.zSum += zOf(value) ?? 0
      standing.total += value
    }
  }

  return { scores, standings, mapStats, scored: field }
}

/**
 * The seeding the qualifier results call for: highest Z-sum first, a tie going to the higher raw
 * total and then to whoever was seeded higher already. Players with no qualifier result keep their
 * order below everyone who has one.
 */
export function seedingByZSum(state: TournamentState, lobbyScores: LobbyScore[]): TournamentPlayer[] {
  const { standings } = qualifierResults(state, lobbyScores)
  const position = new Map(state.players.map((player, index) => [player.osuId, index]))

  const ranked = state.players
    .filter(player => standings[player.osuId] != null)
    .sort((a, b) => {
      const left = standings[a.osuId]!
      const right = standings[b.osuId]!

      return right.zSum - left.zSum || right.total - left.total || position.get(a.osuId)! - position.get(b.osuId)!
    })

  return [...ranked, ...state.players.filter(player => standings[player.osuId] == null)]
}

/**
 * Sheet columns that were imported but not mapped onto a player field, in the order they first
 * appear. These are the candidates for a mappool slot's score column.
 */
export function spareSheetColumns(state: TournamentState): string[] {
  return [...new Set(state.players.flatMap(player => Object.keys(player.extra ?? {})))]
}

/**
 * Problems worth surfacing on the dashboard. These are warnings, never hard errors - an organiser
 * may well want an uneven bracket mid-setup.
 */
export function warnings(state: TournamentState): TournamentWarning[] {
  const taking = field(state)

  if (state.players.length === 0) {
    return [{
      code: 'warn.noPlayers',
      args: {},
      text: 'No players imported yet - import the qualifier sheet to get started.'
    }]
  }

  const result: TournamentWarning[] = []
  const chosen = captains(state)
  const target = captainCount(state)

  if (state.teamSize > 0) {
    const leftover = taking.length - (target * state.teamSize)

    if (leftover !== 0) {
      result.push({
        code: 'warn.uneven',
        args: { count: `${leftover}`, teams: `${target}`, size: `${state.teamSize}` },
        text: `${leftover} player(s) beyond an even ${target}x${state.teamSize} split - `
          + 'adjust the team size or pin the captain count.'
      })
    }
  }

  if (chosen.length < target) {
    result.push({
      code: 'warn.fewCaptains',
      args: { have: `${chosen.length}`, target: `${target}` },
      text: `Only ${chosen.length} of ${target} captain slots can be filled - `
        + 'too many players are excluded from captaincy.'
    })
  }

  if (chosen.length > target) {
    result.push({
      code: 'warn.manyCaptains',
      args: { have: `${chosen.length}`, target: `${target}` },
      text: `${chosen.length} captains are forced, which is more than the target of ${target}.`
    })
  }

  const unlinked = chosen.filter(player => !player.discordId)

  if (unlinked.length > 0) {
    const names = unlinked.map(player => player.username).join(', ')

    result.push({
      code: 'warn.noDiscord',
      args: { names },
      text: `No Discord account linked for: ${names} - they cannot bid or be assigned players.`
    })
  }

  return result
}

import type { MapScore, TournamentPlayer, TournamentState, TournamentWarning } from '#shared/types'

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
  teamSize: DEFAULT_TEAM_SIZE,
  captainCountOverride: null,
  seedingLocked: false,
  defaultStartingBid: 0,
  defaultMaxBid: 0,
  rosters: {},
  teamNames: {},
  mappool: [],
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
 */
export function captains(state: TournamentState): TournamentPlayer[] {
  const taking = field(state)
  const target = captainCount(state)
  const forced = taking.filter(player => player.captainMode === 'FORCE')
  const remaining = Math.max(target - forced.length, 0)
  const auto = taking.filter(player => player.captainMode === 'AUTO').slice(0, remaining)
  const chosen = new Set([...forced, ...auto].map(player => player.osuId))

  return taking.filter(player => chosen.has(player.osuId))
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
 * Every qualifier result, as `osu! ID -> map id -> score`.
 *
 * Ranks are competition style: players tied on a map share a rank and the next one skips, and a
 * player with no readable score in that map's column simply has no entry - they are not ranked last.
 */
export function mapScores(state: TournamentState): Record<string, Record<string, MapScore>> {
  const results: Record<string, Record<string, MapScore>> = {}

  for (const map of state.mappool) {
    const column = map.column?.trim()
    if (!column) continue

    const scored = state.players.flatMap((player) => {
      const raw = player.extra?.[column]?.trim()
      if (!raw) return []

      const value = parseSheetNumber(raw)
      if (value == null) return []

      return [{ osuId: player.osuId, raw, value }]
    }).sort((a, b) => b.value - a.value)

    let previous: number | null = null
    let previousRank = 0

    scored.forEach((entry, index) => {
      const rank = entry.value === previous ? previousRank : index + 1
      previous = entry.value
      previousRank = rank

      results[entry.osuId] ??= {}
      results[entry.osuId]![map.id] = { value: entry.value, display: entry.raw, rank }
    })
  }

  return results
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

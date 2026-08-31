import type { MapScore, TournamentPlayer, TournamentState, TournamentWarning } from '#shared/types'

export const DEFAULT_TEAM_SIZE = 4

export const emptyTournament = (): TournamentState => ({
  players: [],
  teamSize: DEFAULT_TEAM_SIZE,
  captainCountOverride: null,
  seedingLocked: false,
  defaultStartingBid: 0,
  defaultMaxBid: 0,
  rosters: {},
  teamNames: {},
  mappool: [],
  sheet: null,
  mappoolSheet: null
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
 * How many captains this tournament should have.
 *
 * Derived as `qualified / teamSize` (floored) so that adding or removing qualifiers automatically
 * changes the number of teams, unless `captainCountOverride` pins it.
 */
export function captainCount(state: TournamentState): number {
  if (state.captainCountOverride != null) {
    return Math.min(Math.max(state.captainCountOverride, 0), state.players.length)
  }

  if (state.teamSize <= 0) return 0

  return Math.floor(state.players.length / state.teamSize)
}

/**
 * The captains, in seeding order: everyone marked `FORCE` first, then the highest seeds still on
 * `AUTO` until the target count is reached. `EXCLUDE` players are never picked, which is what makes
 * "top seed, but not a captain" expressible.
 */
export function captains(state: TournamentState): TournamentPlayer[] {
  const target = captainCount(state)
  const forced = state.players.filter(player => player.captainMode === 'FORCE')
  const remaining = Math.max(target - forced.length, 0)
  const auto = state.players.filter(player => player.captainMode === 'AUTO').slice(0, remaining)
  const chosen = new Set([...forced, ...auto].map(player => player.osuId))

  return state.players.filter(player => chosen.has(player.osuId))
}

/** Players that are not captains - the pool the auction draws from. */
export function pool(state: TournamentState): TournamentPlayer[] {
  const captainIds = new Set(captains(state).map(player => player.osuId))

  return state.players.filter(player => !captainIds.has(player.osuId))
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
    const leftover = state.players.length - (target * state.teamSize)

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

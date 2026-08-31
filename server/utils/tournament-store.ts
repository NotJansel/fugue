import type {
  CaptainMode,
  MappoolSheetConfig,
  QualifierMap,
  SheetImportConfig,
  TournamentPlayer,
  TournamentState
} from '#shared/types'
import { emitChange } from './bus'
import { JsonStore } from './json-store'
import { captainForDiscordId, emptyTournament } from './tournament-model'

/**
 * Single source of truth for the tournament: qualified players, seeding order, captains and team
 * rosters. Everything derived - who is a captain, who is in the pool, per-map ranks - is computed
 * from this on demand (`tournament-model.ts`), never stored, so the two can't drift.
 */
const store = new JsonStore<TournamentState>('tournament.json', emptyTournament())

export const loadTournament = () => store.load()
export const getTournament = (): TournamentState => store.get()

async function update(block: (current: TournamentState) => TournamentState): Promise<TournamentState> {
  const next = await store.update(block)
  emitChange()

  return next
}

const updatePlayer = (
  osuId: string,
  block: (player: TournamentPlayer) => TournamentPlayer
): Promise<TournamentState> =>
  update(current => ({
    ...current,
    players: current.players.map(player => player.osuId === osuId ? block(player) : player)
  }))

/**
 * Replaces the player list from a fresh import.
 *
 * Manual work is preserved wherever it can be: a player who is still in the sheet keeps their
 * Discord link (unless the sheet now supplies one) and their captain override. Rosters are pruned to
 * players that still exist.
 */
export function replacePlayers(
  players: TournamentPlayer[],
  sheet: SheetImportConfig | null
): Promise<TournamentState> {
  return update((current) => {
    const previous = new Map(current.players.map(player => [player.osuId, player]))

    const merged = players.map((imported) => {
      const existing = previous.get(imported.osuId)
      if (!existing) return imported

      return {
        ...imported,
        discordId: imported.discordId ?? existing.discordId,
        captainMode: imported.captainMode === 'AUTO' ? existing.captainMode : imported.captainMode
      }
    })

    const known = new Set(merged.map(player => player.osuId))

    const rosters: TournamentState['rosters'] = {}
    for (const [captainOsuId, members] of Object.entries(current.rosters)) {
      if (!known.has(captainOsuId)) continue

      const kept = members.filter(member => known.has(member.osuId))
      if (kept.length > 0) rosters[captainOsuId] = kept
    }

    const teamNames = Object.fromEntries(
      Object.entries(current.teamNames).filter(([captainOsuId]) => known.has(captainOsuId))
    )

    return { ...current, players: merged, rosters, teamNames, sheet: sheet ?? current.sheet }
  })
}

/** Moves a player to a new seeding position, shifting everyone in between. */
export function moveSeed(osuId: string, toIndex: number): Promise<TournamentState> {
  return update((current) => {
    const from = current.players.findIndex(player => player.osuId === osuId)
    if (from < 0) return current

    const reordered = [...current.players]
    const [player] = reordered.splice(from, 1)
    reordered.splice(Math.min(Math.max(toIndex, 0), reordered.length), 0, player!)

    return { ...current, players: reordered }
  })
}

export const setCaptainMode = (osuId: string, mode: CaptainMode): Promise<TournamentState> =>
  updatePlayer(osuId, player => ({ ...player, captainMode: mode }))

export const setDiscordId = (osuId: string, discordId: string | null): Promise<TournamentState> =>
  updatePlayer(osuId, player => ({ ...player, discordId: discordId?.trim() || null }))

/**
 * Links a player to the Discord account that just proved ownership of their osu! account.
 *
 * The Discord ID is taken off any other player first: bids are keyed by Discord ID, so one account
 * controlling two players would make an auction result ambiguous. Returns whether the osu! ID
 * belongs to a player at all - most people signing in are not in the tournament.
 */
export async function claimDiscordId(osuId: string, discordId: string): Promise<boolean> {
  let claimed = false

  await update((current) => {
    if (!current.players.some(player => player.osuId === osuId)) return current

    claimed = true

    return {
      ...current,
      players: current.players.map((player) => {
        if (player.osuId === osuId) return { ...player, discordId }
        if (player.discordId === discordId) return { ...player, discordId: null }

        return player
      })
    }
  })

  return claimed
}

export function setTeamName(captainOsuId: string, name: string | null): Promise<TournamentState> {
  return update((current) => {
    const { [captainOsuId]: _dropped, ...rest } = current.teamNames
    const trimmed = name?.trim()

    return { ...current, teamNames: trimmed ? { ...rest, [captainOsuId]: trimmed } : rest }
  })
}

export const setSeedingLocked = (locked: boolean): Promise<TournamentState> =>
  update(current => ({ ...current, seedingLocked: locked }))

/**
 * Replaces the qualifier mappool wholesale - the dashboard edits it as one list, and slots carry no
 * state of their own beyond what is saved here, so there is nothing to merge.
 *
 * `sheet` records where an imported pool came from; passing `null` keeps whatever is on file, so
 * hand edits after an import do not erase the source.
 */
export const setMappool = (
  maps: QualifierMap[],
  sheet: MappoolSheetConfig | null = null
): Promise<TournamentState> =>
  update(current => ({ ...current, mappool: maps, mappoolSheet: sheet ?? current.mappoolSheet }))

export interface ConfigPatch {
  teamSize?: number | null
  captainCountOverride?: number | null
  clearCaptainCountOverride?: boolean
  defaultStartingBid?: number | null
  defaultMaxBid?: number | null
}

export function updateTournamentConfig(patch: ConfigPatch): Promise<TournamentState> {
  return update(current => ({
    ...current,
    teamSize: patch.teamSize != null ? Math.max(patch.teamSize, 1) : current.teamSize,
    captainCountOverride: patch.clearCaptainCountOverride
      ? null
      : patch.captainCountOverride != null
        ? Math.max(patch.captainCountOverride, 0)
        : current.captainCountOverride,
    defaultStartingBid: patch.defaultStartingBid != null
      ? Math.max(patch.defaultStartingBid, 0)
      : current.defaultStartingBid,
    defaultMaxBid: patch.defaultMaxBid != null ? Math.max(patch.defaultMaxBid, 0) : current.defaultMaxBid
  }))
}

/**
 * Records an auction result against the captain the winning Discord user controls.
 *
 * Returns the captain's name on success, or `null` when the bidder isn't a captain - in which case
 * the sale is simply not tracked, rather than being attributed to the wrong team.
 */
export async function recordSale(
  playerOsuId: string,
  winnerDiscordId: string,
  price: number
): Promise<string | null> {
  let captainName: string | null = null

  await update((current) => {
    const captain = captainForDiscordId(current, winnerDiscordId)
    if (!captain) return current
    if (!current.players.some(player => player.osuId === playerOsuId)) return current

    captainName = captain.username

    const members = current.rosters[captain.osuId] ?? []
    if (members.some(member => member.osuId === playerOsuId)) return current

    return {
      ...current,
      rosters: { ...current.rosters, [captain.osuId]: [...members, { osuId: playerOsuId, price }] }
    }
  })

  return captainName
}

/** Removes a player from a team, e.g. to undo a mis-recorded auction. */
export function removeFromRoster(captainOsuId: string, playerOsuId: string): Promise<TournamentState> {
  return update((current) => {
    const members = current.rosters[captainOsuId]
    if (!members) return current

    const { [captainOsuId]: _dropped, ...rest } = current.rosters
    const remaining = members.filter(member => member.osuId !== playerOsuId)

    return { ...current, rosters: remaining.length === 0 ? rest : { ...rest, [captainOsuId]: remaining } }
  })
}

/** Wipes every roster, keeping players and seeding - used to restart an auction night. */
export const clearRosters = (): Promise<TournamentState> => update(current => ({ ...current, rosters: {} }))

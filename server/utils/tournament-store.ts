import type { PoolClient } from 'pg'
import type {
  CaptainMode,
  ColumnMapping,
  LobbyScore,
  ManualScore,
  MappoolColumnMapping,
  MappoolSheetConfig,
  QualifierMap,
  RegistrationColumnMapping,
  RegistrationSheetConfig,
  SheetImportConfig,
  TeamMember,
  TeamProxy,
  TournamentPlayer,
  TournamentState
} from '#shared/types'
import { emitChange } from './bus'
import { query, valuesList, withTransaction } from './db'
import { formatMods, parseMods } from './mods'
import { serialiser } from './store-queue'
import { captains, emptyTournament, seedingByZSum } from './tournament-model'

/**
 * Single source of truth for the tournament: qualified players, seeding order, captains and team
 * rosters. Everything derived - who is a captain, who is in the pool, per-map ranks - is computed
 * from this on demand (`tournament-model.ts`), never stored, so the two can't drift.
 *
 * The rows are read once at startup and held as one `TournamentState`, which is what every reader
 * gets; a mutation produces the next whole state and writes it back inside a single transaction.
 * Rewriting all of it is what the JSON file it replaces did, and at a few dozen players it is still
 * the cheaper thing - it keeps the code free of "did anything actually change" branches, and a
 * half-applied import can't survive a crash.
 */
let state: TournamentState = emptyTournament()

const write = serialiser()

export const getTournament = (): TournamentState => state

interface SettingsRow {
  team_size: number
  min_team_size: number
  field_size: number | null
  min_bid_increment: number
  max_bid_increment: number
  second_run: boolean
  captain_count_override: number | null
  seeding_locked: boolean
  default_starting_bid: number
  default_max_bid: number
  mod_multipliers: Record<string, number> | null
}

interface PlayerRow {
  osu_id: string
  username: string
  discord_id: string | null
  discord_username: string | null
  qual_score: number | null
  sheet_seed: number | null
  pp_raw: number | null
  pp_rank: number | null
  country_code: string | null
  captain_mode: string
  description: string | null
  description_override: string | null
  extra: Record<string, string>
}

interface RosterRow {
  captain_osu_id: string
  player_osu_id: string
  price: number
}

interface MappoolRow {
  id: string
  label: string
  stage: string
  mods: string
  score_column: string | null
  beatmap_id: string | null
  beatmapset_id: string | null
  artist: string | null
  title: string | null
  version: string | null
  stars: number | null
  cs: number | null
  ar: number | null
  od: number | null
  hp: number | null
  bpm: number | null
  length_seconds: number | null
}

interface SheetRow {
  kind: string
  url: string
  sheet_name: string | null
  mapping: ColumnMapping & MappoolColumnMapping & RegistrationColumnMapping
  imported_at: number | null
  stage: string | null
}

/** Reads the whole tournament back into memory. Nothing else in the process queries these tables. */
export async function loadTournament(): Promise<void> {
  const [
    settings, players, rosterRows, teamNameRows, proxyRows, mappoolRows, sheetRows, removedRows
  ] = await Promise.all([
    query<SettingsRow>('SELECT * FROM tournament_settings WHERE id'),
    query<PlayerRow>('SELECT * FROM players ORDER BY seed'),
    query<RosterRow>('SELECT captain_osu_id, player_osu_id, price FROM rosters ORDER BY captain_osu_id, position'),
    query<{ captain_osu_id: string, name: string }>('SELECT captain_osu_id, name FROM team_names'),
    query<{ captain_osu_id: string, discord_id: string, username: string | null }>(
      'SELECT captain_osu_id, discord_id, username FROM team_proxies'
    ),
    query<MappoolRow>('SELECT * FROM mappool ORDER BY position'),
    query<SheetRow>('SELECT * FROM sheet_config'),
    query<{ player: TournamentPlayer }>('SELECT player FROM removed_players ORDER BY position')
  ])

  const rosters: Record<string, TeamMember[]> = {}
  for (const row of rosterRows) {
    (rosters[row.captain_osu_id] ??= []).push({ osuId: row.player_osu_id, price: row.price })
  }

  const qualifier = sheetRows.find(row => row.kind === 'qualifier')
  const mappoolSheet = sheetRows.find(row => row.kind === 'mappool')
  const registrationSheet = sheetRows.find(row => row.kind === 'registration')

  // A database that has never been written to leaves the defaults in place rather than erroring, the
  // same way a missing file used to.
  const defaults = emptyTournament()
  const row = settings[0]

  state = {
    players: players.map(readPlayer),
    teamSize: row?.team_size ?? defaults.teamSize,
    minTeamSize: row?.min_team_size ?? defaults.minTeamSize,
    fieldSize: row?.field_size ?? null,
    minBidIncrement: row?.min_bid_increment ?? defaults.minBidIncrement,
    maxBidIncrement: row?.max_bid_increment ?? defaults.maxBidIncrement,
    secondRun: row?.second_run ?? defaults.secondRun,
    modMultipliers: row?.mod_multipliers ?? defaults.modMultipliers,
    captainCountOverride: row?.captain_count_override ?? null,
    seedingLocked: row?.seeding_locked ?? defaults.seedingLocked,
    defaultStartingBid: row?.default_starting_bid ?? defaults.defaultStartingBid,
    defaultMaxBid: row?.default_max_bid ?? defaults.defaultMaxBid,
    rosters,
    teamNames: Object.fromEntries(teamNameRows.map(name => [name.captain_osu_id, name.name])),
    proxies: Object.fromEntries(proxyRows.map(proxy => [
      proxy.captain_osu_id,
      { discordId: proxy.discord_id, username: proxy.username }
    ])),
    mappool: mappoolRows.map(readMap),
    removedPlayers: removedRows.map(row => row.player),
    sheet: qualifier ? readSheet(qualifier) : null,
    mappoolSheet: mappoolSheet ? readMappoolSheet(mappoolSheet) : null,
    registrationSheet: registrationSheet ? readSheet(registrationSheet) : null
  }
}

const readPlayer = (row: PlayerRow): TournamentPlayer => ({
  osuId: row.osu_id,
  username: row.username,
  discordId: row.discord_id,
  discordUsername: row.discord_username,
  qualScore: row.qual_score,
  sheetSeed: row.sheet_seed,
  ppRaw: row.pp_raw,
  ppRank: row.pp_rank,
  countryCode: row.country_code,
  captainMode: row.captain_mode as CaptainMode,
  description: row.description,
  descriptionOverride: row.description_override,
  extra: row.extra ?? {}
})

const readMap = (row: MappoolRow): QualifierMap => ({
  id: row.id,
  label: row.label,
  stage: row.stage,
  mods: row.mods,
  column: row.score_column,
  beatmapId: row.beatmap_id,
  beatmapsetId: row.beatmapset_id,
  artist: row.artist,
  title: row.title,
  version: row.version,
  stars: row.stars,
  cs: row.cs,
  ar: row.ar,
  od: row.od,
  hp: row.hp,
  bpm: row.bpm,
  lengthSeconds: row.length_seconds
})

/** The qualifier and the registration sheet have the same shape; only their mappings differ. */
const readSheet = (row: SheetRow): SheetImportConfig & RegistrationSheetConfig => ({
  url: row.url,
  sheetName: row.sheet_name,
  mapping: row.mapping,
  importedAt: row.imported_at
})

const readMappoolSheet = (row: SheetRow): MappoolSheetConfig => ({
  url: row.url,
  sheetName: row.sheet_name,
  mapping: row.mapping,
  importedAt: row.imported_at,
  stage: row.stage
})

/**
 * Writes a whole tournament out.
 *
 * Players go first and everything keyed by a player follows, because rosters and team names reference
 * them - clearing the players cascades those away, and they are put back in the same transaction.
 * Exported for the one-time import of a legacy `data/` directory.
 */
export async function persistTournament(client: PoolClient, next: TournamentState): Promise<void> {
  await client.query(
    `INSERT INTO tournament_settings (
       id, team_size, min_team_size, field_size, min_bid_increment, max_bid_increment, second_run,
       captain_count_override, seeding_locked, default_starting_bid, default_max_bid, mod_multipliers
     ) VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (id) DO UPDATE SET
       team_size = EXCLUDED.team_size,
       min_team_size = EXCLUDED.min_team_size,
       field_size = EXCLUDED.field_size,
       min_bid_increment = EXCLUDED.min_bid_increment,
       max_bid_increment = EXCLUDED.max_bid_increment,
       second_run = EXCLUDED.second_run,
       captain_count_override = EXCLUDED.captain_count_override,
       seeding_locked = EXCLUDED.seeding_locked,
       default_starting_bid = EXCLUDED.default_starting_bid,
       default_max_bid = EXCLUDED.default_max_bid,
       mod_multipliers = EXCLUDED.mod_multipliers`,
    [
      next.teamSize, next.minTeamSize, next.fieldSize ?? null, next.minBidIncrement,
      next.maxBidIncrement, next.secondRun, next.captainCountOverride ?? null, next.seedingLocked,
      next.defaultStartingBid, next.defaultMaxBid, JSON.stringify(next.modMultipliers ?? {})
    ]
  )

  await client.query('DELETE FROM players')

  const players = valuesList(next.players, (player: TournamentPlayer, seed) => [
    player.osuId, seed, player.username, player.discordId ?? null, player.discordUsername ?? null,
    player.qualScore ?? null, player.sheetSeed ?? null, player.ppRaw ?? null, player.ppRank ?? null,
    player.countryCode ?? null, player.captainMode, player.description ?? null,
    player.descriptionOverride ?? null, JSON.stringify(player.extra ?? {})
  ])
  if (players) {
    await client.query(
      `INSERT INTO players (
         osu_id, seed, username, discord_id, discord_username, qual_score, sheet_seed, pp_raw, pp_rank,
         country_code, captain_mode, description, description_override, extra
       ) VALUES ${players.text}`,
      players.values
    )
  }

  const roster = valuesList(
    Object.entries(next.rosters).flatMap(([captainOsuId, members]) =>
      members.map((member, position) => ({ captainOsuId, member, position }))),
    entry => [entry.captainOsuId, entry.member.osuId, entry.member.price, entry.position]
  )
  if (roster) {
    await client.query(
      `INSERT INTO rosters (captain_osu_id, player_osu_id, price, position) VALUES ${roster.text}`,
      roster.values
    )
  }

  const names = valuesList(Object.entries(next.teamNames), entry => entry)
  if (names) {
    await client.query(`INSERT INTO team_names (captain_osu_id, name) VALUES ${names.text}`, names.values)
  }

  const proxies = valuesList(
    Object.entries(next.proxies ?? {}),
    ([captainOsuId, proxy]) => [captainOsuId, proxy.discordId, proxy.username ?? null]
  )
  if (proxies) {
    await client.query(
      `INSERT INTO team_proxies (captain_osu_id, discord_id, username) VALUES ${proxies.text}`,
      proxies.values
    )
  }

  await client.query('DELETE FROM mappool')

  const maps = valuesList(next.mappool, (map: QualifierMap, position) => [
    map.id, position, map.label, map.stage, map.mods, map.column ?? null,
    map.beatmapId ?? null, map.beatmapsetId ?? null, map.artist ?? null, map.title ?? null,
    map.version ?? null, map.stars ?? null, map.cs ?? null, map.ar ?? null, map.od ?? null,
    map.hp ?? null, map.bpm ?? null, map.lengthSeconds ?? null
  ])
  if (maps) {
    await client.query(
      `INSERT INTO mappool (
         id, position, label, stage, mods, score_column, beatmap_id, beatmapset_id, artist, title,
         version, stars, cs, ar, od, hp, bpm, length_seconds
       ) VALUES ${maps.text}`,
      maps.values
    )
  }

  await client.query('DELETE FROM removed_players')

  const removed = valuesList(next.removedPlayers ?? [], (player: TournamentPlayer, position) => [
    player.osuId, JSON.stringify(player), position
  ])
  if (removed) {
    await client.query(`INSERT INTO removed_players (osu_id, player, position) VALUES ${removed.text}`, removed.values)
  }

  await persistSheet(client, 'qualifier', next.sheet)
  await persistSheet(client, 'mappool', next.mappoolSheet)
  await persistSheet(client, 'registration', next.registrationSheet)
}

/** Any of the sheets, stored as one row per kind. A cleared sheet is a deleted row, not an empty one. */
async function persistSheet(
  client: PoolClient,
  kind: 'qualifier' | 'mappool' | 'registration',
  sheet: SheetImportConfig | MappoolSheetConfig | RegistrationSheetConfig | null | undefined
): Promise<void> {
  if (!sheet) {
    await client.query('DELETE FROM sheet_config WHERE kind = $1', [kind])

    return
  }

  await client.query(
    `INSERT INTO sheet_config (kind, url, sheet_name, mapping, imported_at, stage)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (kind) DO UPDATE SET
       url = EXCLUDED.url,
       sheet_name = EXCLUDED.sheet_name,
       mapping = EXCLUDED.mapping,
       imported_at = EXCLUDED.imported_at,
       stage = EXCLUDED.stage`,
    [
      kind,
      sheet.url,
      sheet.sheetName ?? null,
      JSON.stringify(sheet.mapping),
      sheet.importedAt ?? null,
      'stage' in sheet ? sheet.stage ?? null : null
    ]
  )
}

/**
 * Applies `block` to the current state, writes the result, and tells the dashboard.
 *
 * Returning the state unchanged is how a no-op mutation is expressed; it is written either way.
 */
async function update(block: (current: TournamentState) => TournamentState): Promise<TournamentState> {
  const next = await write(async () => {
    const candidate = block(state)
    await withTransaction(client => persistTournament(client, candidate))
    state = candidate

    return candidate
  })

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
 * Finds the player on file that an imported row stands for: by osu! ID, and failing that by name.
 *
 * The name matters because an import without enrichment only has a `name:` placeholder for an ID, so
 * the same player can arrive under two different keys from two imports.
 */
function existingPlayerLookup(players: TournamentPlayer[]): (imported: TournamentPlayer) => TournamentPlayer | undefined {
  const byId = new Map(players.map(player => [player.osuId, player]))
  const byName = new Map(players.map(player => [player.username.toLowerCase(), player]))

  return imported => byId.get(imported.osuId) ?? byName.get(imported.username.toLowerCase())
}

/**
 * Rosters, team names and stand-ins cut down to the players in `players` - whoever else is gone, so
 * is their team.
 */
function prunedTo(
  current: TournamentState,
  players: TournamentPlayer[]
): Pick<TournamentState, 'rosters' | 'teamNames' | 'proxies'> {
  const known = new Set(players.map(player => player.osuId))

  const rosters: TournamentState['rosters'] = {}
  for (const [captainOsuId, members] of Object.entries(current.rosters)) {
    if (!known.has(captainOsuId)) continue

    const kept = members.filter(member => known.has(member.osuId))
    if (kept.length > 0) rosters[captainOsuId] = kept
  }

  const teamNames = Object.fromEntries(
    Object.entries(current.teamNames).filter(([captainOsuId]) => known.has(captainOsuId))
  )

  const proxies = Object.fromEntries(
    Object.entries(current.proxies ?? {}).filter(([captainOsuId]) => known.has(captainOsuId))
  )

  return { rosters, teamNames, proxies }
}

/** Whether an imported row stands for a player an organiser took off the list. */
const removedLookup = (current: TournamentState): (imported: TournamentPlayer) => boolean => {
  const removed = existingPlayerLookup(current.removedPlayers ?? [])

  return imported => removed(imported) != null
}

/**
 * Replaces the player list from a fresh import.
 *
 * Manual work is preserved wherever it can be: a player who is still in the sheet keeps their
 * Discord link (unless the sheet now supplies one), their captain override, their description
 * (unless the import maps a description column) and, whatever the sheet says, an organiser's
 * override of that description. Rosters are pruned to players that still exist,
 * and anyone an organiser removed by hand stays removed however often the sheet lists them.
 */
export function replacePlayers(
  players: TournamentPlayer[],
  sheet: SheetImportConfig | null
): Promise<TournamentState> {
  return update((current) => {
    const existingFor = existingPlayerLookup(current.players)
    const isRemoved = removedLookup(current)

    const merged = players.filter(imported => !isRemoved(imported)).map((imported) => {
      const existing = existingFor(imported)
      if (!existing) return imported

      return {
        ...imported,
        discordId: imported.discordId ?? existing.discordId,
        discordUsername: imported.discordUsername ?? existing.discordUsername,
        countryCode: imported.countryCode ?? existing.countryCode,
        captainMode: imported.captainMode === 'AUTO' ? existing.captainMode : imported.captainMode,
        description: imported.description === undefined ? existing.description : imported.description,
        descriptionOverride: existing.descriptionOverride
      }
    })

    return { ...current, players: merged, ...prunedTo(current, merged), sheet: sheet ?? current.sheet }
  })
}

/**
 * Fills in country codes for players that had none, `osu! ID -> code`.
 *
 * Nothing else needs a flag, so this is not worth a lookup of its own during an import: the seeding
 * export asks the osu! API for whoever is still missing one and hands the answers here, where they
 * stay for the next export. A code already on file is left alone, and a write that would change
 * nothing is skipped rather than pushing a no-op state at every dashboard.
 */
export async function saveCountryCodes(codes: Record<string, string>): Promise<void> {
  const missing = state.players.some(player => !player.countryCode && codes[player.osuId])
  if (!missing) return

  await update(current => ({
    ...current,
    players: current.players.map(player =>
      player.countryCode || !codes[player.osuId] ? player : { ...player, countryCode: codes[player.osuId] })
  }))
}

/**
 * Takes a player off the list, and out of any roster or captaincy, keeping them aside so a later
 * import does not bring them straight back. Returns whether there was such a player.
 */
export async function removePlayer(osuId: string): Promise<boolean> {
  let removed = false

  await update((current) => {
    const player = current.players.find(candidate => candidate.osuId === osuId)
    if (!player) return current

    removed = true
    const players = current.players.filter(candidate => candidate.osuId !== osuId)

    return {
      ...current,
      players,
      ...prunedTo(current, players),
      removedPlayers: [...(current.removedPlayers ?? []).filter(kept => kept.osuId !== osuId), player]
    }
  })

  return removed
}

/**
 * Puts a player on the list by hand, at the bottom of the seeding.
 *
 * The way in for anyone no sheet knows about: a stand-in for a test run, a late sign-up, a player an
 * import could not resolve. They arrive with no qualifier result, so the next reseed sorts them to
 * the bottom on their own; nothing else here is special-cased for them.
 *
 * Adding someone an organiser had removed takes them off the removed list too - otherwise the next
 * import would drop them again - which makes this the same thing as a restore for that player.
 * `false` when they are already on the list, since adding them twice is not a thing.
 */
export async function addPlayer(player: TournamentPlayer): Promise<boolean> {
  let added = false

  await update((current) => {
    if (current.players.some(candidate => candidate.osuId === player.osuId)) return current

    added = true

    return {
      ...current,
      players: [...current.players, player],
      removedPlayers: (current.removedPlayers ?? []).filter(candidate => candidate.osuId !== player.osuId)
    }
  })

  return added
}

/** Puts a removed player back, at the bottom of the seeding. Returns whether there was one to restore. */
export async function restorePlayer(osuId: string): Promise<boolean> {
  let restored = false

  await update((current) => {
    const player = (current.removedPlayers ?? []).find(candidate => candidate.osuId === osuId)
    if (!player) return current

    restored = true

    return {
      ...current,
      players: current.players.some(candidate => candidate.osuId === osuId)
        ? current.players
        : [...current.players, player],
      removedPlayers: current.removedPlayers.filter(candidate => candidate.osuId !== osuId)
    }
  })

  return restored
}

export interface RegistrationResult {
  added: number
  updated: number
}

/**
 * Folds a registration sheet into the player list instead of replacing it.
 *
 * A registration sheet knows who signed up and what they wrote about themselves, not how anyone did
 * in qualifiers. So a player already on file keeps their seed, results, captain override and anything
 * bought, and only has their name, Discord username, pp and description brought up to date; anyone new
 * joins at the bottom of the seeding, in sheet order.
 *
 * A Discord ID is only ever filled in, never replaced: the one on file may be a verified link from the
 * player signing in, and a username the sheet got wrong must not take that away. Nobody is removed - missing from a registration export
 * is not the same as withdrawn.
 *
 * A player on file under a `name:` placeholder takes the real osu! ID once the sheet or enrichment
 * supplies one, and their roster and team name move with them. Anyone removed by hand is skipped.
 */
export async function mergeRegistrations(
  registered: TournamentPlayer[],
  sheet: RegistrationSheetConfig
): Promise<RegistrationResult> {
  const result: RegistrationResult = { added: 0, updated: 0 }

  await update((current) => {
    const existingFor = existingPlayerLookup(current.players)
    const isRemoved = removedLookup(current)
    const replaced = new Map<string, TournamentPlayer>()
    const added: TournamentPlayer[] = []
    const rekeyed = new Map<string, string>()

    for (const incoming of registered) {
      if (isRemoved(incoming)) continue

      const existing = existingFor(incoming)

      if (!existing) {
        if (added.some(player => player.osuId === incoming.osuId)) continue

        added.push({ ...incoming, qualScore: null, sheetSeed: null, captainMode: 'AUTO', extra: {} })
        continue
      }

      if (replaced.has(existing.osuId)) continue

      const osuId = existing.osuId.startsWith('name:') && !incoming.osuId.startsWith('name:')
        ? incoming.osuId
        : existing.osuId
      if (osuId !== existing.osuId) rekeyed.set(existing.osuId, osuId)

      replaced.set(existing.osuId, {
        ...existing,
        osuId,
        username: incoming.username,
        discordId: existing.discordId ?? incoming.discordId,
        discordUsername: incoming.discordUsername ?? existing.discordUsername,
        ppRaw: incoming.ppRaw ?? existing.ppRaw,
        ppRank: incoming.ppRank ?? existing.ppRank,
        countryCode: incoming.countryCode ?? existing.countryCode,
        description: incoming.description === undefined ? existing.description : incoming.description
      })
    }

    // A placeholder upgraded to a real ID above can collide with a sign-up that brought the same ID.
    const kept = current.players.map(player => replaced.get(player.osuId) ?? player)
    const taken = new Set(kept.map(player => player.osuId))
    const fresh = added.filter(player => !taken.has(player.osuId))

    result.added = fresh.length
    result.updated = replaced.size

    const rekey = (osuId: string) => rekeyed.get(osuId) ?? osuId

    return {
      ...current,
      players: [...kept, ...fresh],
      rosters: Object.fromEntries(Object.entries(current.rosters).map(([captainOsuId, members]) => [
        rekey(captainOsuId),
        members.map(member => ({ ...member, osuId: rekey(member.osuId) }))
      ])),
      teamNames: Object.fromEntries(
        Object.entries(current.teamNames).map(([captainOsuId, name]) => [rekey(captainOsuId), name])
      ),
      proxies: Object.fromEntries(
        Object.entries(current.proxies ?? {}).map(([captainOsuId, proxy]) => [rekey(captainOsuId), proxy])
      ),
      registrationSheet: sheet
    }
  })

  return result
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

/**
 * Puts the seeding in the order the qualifier results call for - see `seedingByZSum`.
 *
 * The lobby scores are handed in rather than fetched, so this store stays ignorant of where results
 * come from. Callers decide what the seeding lock means to them: the route refuses, the lobby watcher
 * simply leaves a locked seeding alone. Returns whether the order actually moved.
 */
export async function reseedByZSum(lobbyScores: LobbyScore[], manualScores: ManualScore[] = []): Promise<boolean> {
  let moved = false

  await update((current) => {
    const reseeded = seedingByZSum(current, lobbyScores, manualScores)
    moved = reseeded.some((player, index) => player.osuId !== current.players[index]?.osuId)

    return moved ? { ...current, players: reseeded } : current
  })

  return moved
}

export const setCaptainMode = (osuId: string, mode: CaptainMode): Promise<TournamentState> =>
  updatePlayer(osuId, player => ({ ...player, captainMode: mode }))

export const setDiscordId = (osuId: string, discordId: string | null): Promise<TournamentState> =>
  updatePlayer(osuId, player => ({ ...player, discordId: discordId?.trim() || null }))

/**
 * Sets what an organiser wants shown in place of a player's own description, or with `null` takes
 * the override away so the sheet's text shows again. An empty string is kept as one: it hides the
 * description rather than falling back to it.
 */
export const setDescriptionOverride = (osuId: string, text: string | null): Promise<TournamentState> =>
  updatePlayer(osuId, player => ({ ...player, descriptionOverride: text == null ? null : text.trim() }))

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

/**
 * Lets `proxy` bid for the team `captainOsuId` leads, or with `null` stops anyone but the captain
 * from doing so. One stand-in per team; setting another replaces the first.
 */
export function setProxy(captainOsuId: string, proxy: TeamProxy | null): Promise<TournamentState> {
  return update((current) => {
    const { [captainOsuId]: _dropped, ...rest } = current.proxies ?? {}

    return { ...current, proxies: proxy ? { ...rest, [captainOsuId]: proxy } : rest }
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
  minTeamSize?: number | null
  /** `null` leaves it as it was; pass `clearFieldSize` to let the whole field back in. */
  fieldSize?: number | null
  clearFieldSize?: boolean
  captainCountOverride?: number | null
  clearCaptainCountOverride?: boolean
  defaultStartingBid?: number | null
  defaultMaxBid?: number | null
  minBidIncrement?: number | null
  maxBidIncrement?: number | null
  secondRun?: boolean | null
  /** The whole table, replaced as one - `null` leaves it as it was. */
  modMultipliers?: Record<string, number> | null
}

/**
 * Tidies a multiplier table as typed: every key spelt canonically so `HDEZ` and `EZHD` land on one
 * rule, and only factors that would change a score kept - a factor of 1 is the same as no rule.
 */
function tidyMultipliers(typed: Record<string, number>): Record<string, number> {
  const tidied: Record<string, number> = {}

  for (const [mods, factor] of Object.entries(typed)) {
    const key = formatMods(parseMods(mods))
    const value = Number(factor)

    if (key !== '' && Number.isFinite(value) && value > 0 && value !== 1) tidied[key] = value
  }

  return tidied
}

export function updateTournamentConfig(patch: ConfigPatch): Promise<TournamentState> {
  return update(current => ({
    ...current,
    modMultipliers: patch.modMultipliers != null ? tidyMultipliers(patch.modMultipliers) : current.modMultipliers,
    teamSize: patch.teamSize != null ? Math.max(patch.teamSize, 1) : current.teamSize,
    minTeamSize: patch.minTeamSize != null ? Math.max(patch.minTeamSize, 0) : current.minTeamSize,
    fieldSize: patch.clearFieldSize
      ? null
      : patch.fieldSize != null ? Math.max(patch.fieldSize, 0) : current.fieldSize,
    minBidIncrement: patch.minBidIncrement != null
      ? Math.max(patch.minBidIncrement, 1)
      : current.minBidIncrement,
    maxBidIncrement: patch.maxBidIncrement != null
      ? Math.max(patch.maxBidIncrement, 0)
      : current.maxBidIncrement,
    secondRun: patch.secondRun ?? current.secondRun,
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
 * Records an auction result on `captainOsuId`'s roster - the captain the auction already resolved the
 * winning bid to, so the sale lands on exactly the team the purse was settled for.
 *
 * Returns whether it was recorded. A captain who is no longer one, or a player no longer on the list,
 * is simply not tracked rather than being attributed to the wrong team.
 */
export async function recordSale(playerOsuId: string, captainOsuId: string, price: number): Promise<boolean> {
  let recorded = false

  await update((current) => {
    if (!captains(current).some(captain => captain.osuId === captainOsuId)) return current
    if (!current.players.some(player => player.osuId === playerOsuId)) return current

    recorded = true

    const members = current.rosters[captainOsuId] ?? []
    if (members.some(member => member.osuId === playerOsuId)) return current

    return {
      ...current,
      rosters: { ...current.rosters, [captainOsuId]: [...members, { osuId: playerOsuId, price }] }
    }
  })

  return recorded
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

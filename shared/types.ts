/**
 * Everything the dashboard and the server agree on.
 *
 * `TournamentState` and everything under it is what the stores hold in memory and what the dashboard
 * renders from; Postgres keeps it as the tables in `server/utils/db.ts`. These are also the shapes
 * the Kotlin version wrote as JSON, which is what lets `server/utils/legacy-import.ts` read a
 * `data/tournament.json`, `data/purses.json` and `data/osu_links.json` from an older deployment.
 */

/** How a player's captain status is decided. */
export type CaptainMode = 'AUTO' | 'FORCE' | 'EXCLUDE'

/**
 * A player imported from the qualifier sheet. The seeding position is *not* stored here - it is the
 * player's index in `TournamentState.players`, so reordering is a list operation.
 */
export interface TournamentPlayer {
  /** osu! user ID. Used as the stable primary key everywhere, including roster entries. */
  osuId: string
  username: string
  /** Discord user this player controls. Required for captains, since bids are keyed by Discord ID. */
  discordId?: string | null
  /**
   * Discord username as the registration sheet wrote it, without the `@`. Kept beside `discordId`
   * because a name the tournament server could not match still tells an organiser who to link.
   */
  discordUsername?: string | null
  /** Qualifier metric the import sorted on (z-score, accuracy, points - whatever the sheet holds). */
  qualScore?: number | null
  /** Seed as stated by the sheet, kept for reference after manual reordering. */
  sheetSeed?: number | null
  ppRaw?: number | null
  ppRank?: number | null
  /**
   * Two-letter country code as osu! spells it ("DE", "US"), filled in by enrichment and by the CSV
   * export when it is missing. What the seeding export writes as a flag.
   */
  countryCode?: string | null
  captainMode: CaptainMode
  /** What the player wrote about themselves on the sheet. Shown with the seeding and at auction. */
  description?: string | null
  /**
   * What an organiser wrote in place of `description`, which it wins over wherever a description is
   * shown. Kept apart rather than written over it so an import can go on refreshing the sheet's text
   * without undoing the edit, and so resetting brings the sheet's back. `null` means no override; an
   * empty string is one, and hides the description altogether.
   */
  descriptionOverride?: string | null
  /** Remaining sheet columns, kept so the dashboard can show them without a schema change. */
  extra: Record<string, string>
}

/**
 * One slot of the qualifier mappool.
 *
 * Scores are *not* copied in here: `column` names the sheet column that holds them, and the values
 * stay in `TournamentPlayer.extra` where the import left them. That way the pool can be defined,
 * re-labelled or re-pointed at a different column long after the import, with no migration.
 */
export interface QualifierMap {
  /** Stable key, so results survive re-labelling and reordering. Assigned on save when blank. */
  id: string
  /** Slot name as the pool sheet calls it, e.g. "NM1". */
  label: string
  /** Round this slot belongs to, e.g. "Qualifiers", "RO16". Blank means ungrouped, not hidden. */
  stage: string
  /**
   * Mods the slot is played with, canonical and uppercase ("HDDT"), empty for a no-mod, free-mod or
   * tiebreaker slot. Taken from `label` whenever the organiser leaves it alone.
   */
  mods: string
  /** Header of the sheet column holding each player's score on this map. */
  column?: string | null
  /** osu! beatmap (difficulty) ID - the link target, and what metadata is looked up with. */
  beatmapId?: string | null
  /** Filled in from the osu! API, so the pool reads as maps rather than as column names. */
  beatmapsetId?: string | null
  artist?: string | null
  title?: string | null
  version?: string | null
  /** Star rating *with `mods` applied* - a DT slot is worth naming at its DT rating. */
  stars?: number | null
  /** Difficulty settings, also with `mods` applied - see `server/utils/difficulty.ts`. */
  cs?: number | null
  ar?: number | null
  od?: number | null
  hp?: number | null
  bpm?: number | null
  lengthSeconds?: number | null
}

/** What a player put up on one qualifier map, and where that placed them in the field. */
export interface MapScore {
  value: number
  /**
   * The cell as the sheet wrote it, so separators and decimals show up the way organisers expect.
   * A score read from a lobby, or typed in by an organiser, is a plain number the dashboard formats
   * itself.
   */
  display: string
  rank: number
  /**
   * How many standard deviations above or below the map's mean this score sits - the per-map term of
   * the Z-sum. `null` when the map has too few scores for a deviation to mean anything.
   */
  z: number | null
  /**
   * Where the score came from: the osu! lobby it was set in, the qualifier sheet's column, or an
   * organiser who typed it in for a run osu! has no record of.
   */
  source: 'lobby' | 'sheet' | 'manual'
  /** The player's own mods on the run that counts, beyond what the slot forces - what a freemod slot shows. */
  mods: string
  /**
   * What `value` was multiplied by to bring it back to 1x: the tournament's rate for an EZ run, and
   * the reciprocal of osu!'s own multiplier - so below 1 - for every other combination. 1 for a
   * score set unmodded, and for one read off a sheet, whose mods nobody knows.
   */
  multiplier: number
}

/**
 * A score an organiser typed in, for one player on one pool slot.
 *
 * The last word on that cell: a disconnect early enough to submit nothing leaves no lobby score at
 * all, and one early enough to submit a broken one leaves something worse than nothing, so this wins
 * over both. Kept as osu! would have reported it - mods and all - so it is normalised on the way to
 * the dashboard exactly like a score that was read rather than typed.
 */
export interface ManualScore {
  osuId: string
  /** `QualifierMap.id`, so the entry survives the slot being re-labelled or re-pointed. */
  mapId: string
  score: number
  /** The whole combination it was played with, the slot's own mods included. Canonical, empty for none. */
  mods: string
}

/**
 * One score a player set in a qualifier lobby, as osu! reported it.
 *
 * Kept raw, per game and user, rather than folded into the player: which of a player's runs counts,
 * and which pool slot a beatmap belongs to, are worked out on every dashboard build - so a slot
 * re-pointed at another beatmap, or a player imported after their lobby, needs nothing re-read.
 */
export interface LobbyScore {
  matchId: number
  gameId: number
  /** osu! beatmap (difficulty) ID the game was played on - what ties it to a pool slot. */
  beatmapId: string
  /** osu! user ID, as a string like every other osu! ID here. */
  osuId: string
  /** As osu! listed the player in the lobby; what a `name:` placeholder is matched on. */
  username: string
  score: number
  /** Mods the game was played with plus the player's own, canonical ("HDDT"), empty for none. */
  mods: string
  /**
   * The player's own mods beyond the game's, NF left out - what they chose on a freemod slot, and
   * all the results have to show, since the slot's own mods go without saying. Canonical, empty for
   * none. What a score is *normalised* by is `mods`, the whole set it was played with.
   */
  ownMods: string
  passed: boolean
  /** When the game started, epoch millis. */
  playedAt: number
}

/**
 * A qualifier lobby osu! knows about, found by name in the match history or added by link.
 *
 * `key` is the lobby ID out of its name (see `lobbyKey` in `server/utils/qualifier-lobbies.ts`); a
 * lobby whose name carries none is keyed by its match ID instead, and still has its scores read.
 */
export interface QualifierLobby {
  matchId: number
  key: string
  name: string
  startedAt: number
  /** `null` while the lobby is still open. */
  endedAt: number | null
  /** Newest match event already read, so the next read only asks for what came after it. */
  latestEventId: number | null
}

/** A lobby as the dashboard lists it: when it ran, and how much of it was read into results. */
export interface QualifierLobbyDto {
  matchId: number
  key: string
  name: string
  startedAt: number
  endedAt: number | null
  /** Games whose scores are on file, and distinct players who set one. */
  games: number
  players: number
}

/** A player bought at auction, recorded against the winning captain. */
export interface TeamMember {
  osuId: string
  price: number
}

/** Which sheet column feeds which player field. Values are header names as they appear in the sheet. */
export interface ColumnMapping {
  username: string
  osuId?: string | null
  discordId?: string | null
  score?: string | null
  seed?: string | null
}

/**
 * Which column of the *registration* sheet feeds which player field. A different document to the
 * qualifier results: it knows who signed up and what they wrote, not how anyone placed.
 */
export interface RegistrationColumnMapping {
  username: string
  osuId?: string | null
  discordId?: string | null
  description?: string | null
}

/** Which column of the *mappool* sheet feeds which slot field. A different document to the results. */
export interface MappoolColumnMapping {
  /** Slot name, e.g. "NM1". Required - it is what a row is. */
  label: string
  /** Beatmap ID, or any link with one in it. */
  beatmapId?: string | null
  /** Header of the qualifier-sheet column holding scores for this map. */
  scoreColumn?: string | null
}

/** Everything needed to re-run an import without re-entering it. */
export interface SheetImportConfig {
  url: string
  sheetName?: string | null
  mapping: ColumnMapping
  /** Epoch millis of the last successful import. */
  importedAt?: number | null
}

/** Everything needed to re-run a mappool import without re-entering it. */
export interface MappoolSheetConfig {
  url: string
  sheetName?: string | null
  mapping: MappoolColumnMapping
  importedAt?: number | null
  /** Round the last import filled in - all rounds share the one sheet, so only this varies. */
  stage?: string | null
}

/** Everything needed to re-run a registration import without re-entering it. */
export interface RegistrationSheetConfig {
  url: string
  sheetName?: string | null
  mapping: RegistrationColumnMapping
  importedAt?: number | null
}

/**
 * The whole tournament, as one in-memory snapshot. Spread across `tournament_settings`, `players`,
 * `rosters`, `team_names`, `mappool` and `sheet_config` in the database.
 *
 * Rosters are keyed by captain osu! ID rather than embedded in a team object, so changing who the
 * captains are can never leave a team record orphaned or duplicated.
 */
export interface TournamentState {
  /** Players in seeding order: index 0 is seed 1. */
  players: TournamentPlayer[]
  /**
   * How many of the seeded players take part at all - the top N of the qualifiers. Everyone below
   * stays imported and keeps their seed, but is out of the captain count, the pool and the auction.
   * `null` lets the whole field in.
   */
  fieldSize?: number | null
  /** Largest team, captain included. Drives the captain count and closes a roster when reached. */
  teamSize: number
  /**
   * Smallest team a captain has to end up with, captain included. Nothing forces them to fill it,
   * but it is what a captain must keep enough gold in reserve for on every bid.
   */
  minTeamSize: number
  /** How much a bid has to raise the standing one by, at the least. */
  minBidIncrement: number
  /** And at the most - measured from the starting price for the opening bid. 0 means no ceiling. */
  maxBidIncrement: number
  /**
   * Whether the pool is on its second time round, where whatever went unsold is offered again at
   * half the starting price, and the minimum raise is brought down to 50 if it is above that. The
   * ceiling and the maximum raise are unchanged by it.
   */
  secondRun: boolean
  /**
   * What EZ is worth on a freemod slot: `{ EZ: 1.8, EZHD: 2 }`. Those are the only two keys that can
   * apply - the player's own mods are reduced to `EZ`, `EZHD` or nothing first (`normalizeMods`), so
   * an EZ run counts the same however else it was dressed up. Every other pick is not a rule but a
   * correction, and is normalised instead: osu!'s own multiplier is divided back out of it.
   */
  modMultipliers: Record<string, number>
  /** Set to pin the captain count instead of deriving it from `teamSize`. */
  captainCountOverride?: number | null
  seedingLocked: boolean
  defaultStartingBid: number
  defaultMaxBid: number
  /** captain osu! ID -> players they won. */
  rosters: Record<string, TeamMember[]>
  /** captain osu! ID -> team name. */
  teamNames: Record<string, string>
  /**
   * captain osu! ID -> a stand-in who may bid for that team - a captain who can't be there on auction
   * night, say. The stand-in spends the captain's purse and fills the captain's roster; they have
   * none of either themselves.
   */
  proxies: Record<string, TeamProxy>
  /** The qualifier mappool, in pool order. */
  mappool: QualifierMap[]
  /**
   * Players taken off the list by hand - staff who qualified on paper, say. Kept whole so a restore
   * puts them back as they were, and so a later import recognises and skips them: without this, the
   * next sheet import would simply bring them back.
   */
  removedPlayers: TournamentPlayer[]
  /**
   * osu! IDs put up for auction in each run whom nobody bid on. None of them can be offered again
   * while that run lasts; the second run keeps a list of its own, which is how the first run's
   * leftovers come back round.
   */
  passedOver: { first: string[], second: string[] }
  sheet?: SheetImportConfig | null
  /** Where the mappool was last imported from - a different document to `sheet` as a rule. */
  mappoolSheet?: MappoolSheetConfig | null
  /** Where registrations were last imported from - also its own document. */
  registrationSheet?: RegistrationSheetConfig | null
}

/** Someone besides the captain who may bid for a team. */
export interface TeamProxy {
  discordId: string
  /**
   * Their Discord username, as the tournament guild knew it when an organiser named them - so the
   * team card reads as a person rather than a number. `null` when nobody could look it up then.
   */
  username: string | null
}

/** An osu! account whose owner proved themselves through osu! OAuth2. */
export interface OsuLink {
  osuId: string
  username: string
  avatarUrl?: string | null
  countryCode?: string | null
  ppRaw?: number | null
  ppRank?: number | null
  /** Epoch millis of the most recent successful osu! login. */
  linkedAt: number
}

/**
 * A problem worth surfacing on the dashboard.
 *
 * `code` and `args` are what the dashboard translates; `text` is the same thing in English, so a
 * warning still reads correctly anywhere the dictionary is not available.
 */
export interface TournamentWarning {
  code: string
  args: Record<string, string>
  text: string
}

/** A logged-in dashboard user. */
export interface UserSession {
  id: string
  username: string
  avatar?: string | null
  /**
   * Resolved once at login from the user's Discord permissions; losing Administrator in the guild
   * therefore only takes effect on their next login, which is fine for an event-day tool.
   */
  admin: boolean
  osuId?: string | null
  osuUsername?: string | null
  osuAvatar?: string | null
}

/** Read-only view of the running auction, safe to serialise to the dashboard. */
export interface AuctionSnapshot {
  osuId: string
  username: string
  ppRaw: number
  ppRank: number
  seed: number
  description: string | null
  startingBid: number
  maxBid: number
  highestBid: number
  highestBidderId: string | null
  /** Epoch millis from which bids are taken - a few seconds after the auction opens. */
  opensAt: number
  /** Epoch millis at which the current countdown lapses, so clients can render it themselves. */
  endsAt: number
  channelId: string
  messageId: string
}

/** How the last auction ended - what the dashboard's banner announces. */
export interface AuctionResult {
  /** The auction card's message ID, so a client can tell one result from the next. */
  id: string
  osuId: string
  username: string
  /** Who bought the player and for how much, or `null` when nobody bid. */
  sale: { captainOsuId: string, price: number } | null
  /** Epoch millis at which the hammer fell. */
  at: number
}

/** A result as the dashboard shows it, with the buying team's name resolved. */
export interface AuctionResultDto extends Omit<AuctionResult, 'sale'> {
  sale: { captainOsuId: string, teamName: string, price: number } | null
}

/** A message an organiser sent to every open dashboard. */
export interface Broadcast {
  /** Tells one message from the next, so a client announces each exactly once. */
  id: string
  /** As the organiser typed it - shown as text, never as markup. */
  message: string
  /** The organiser's name, as the dashboard shows it for them. */
  from: string
  /** Epoch millis at which it was sent. */
  at: number
  /** How long it stays up from `at`, in milliseconds; `null` keeps it up until the viewer closes it. */
  durationMs: number | null
}

/** A player as the dashboard sees them: stored fields plus everything derived from them. */
export interface PlayerDto {
  osuId: string
  username: string
  /** 1-based position in the seeding. */
  seed: number
  discordId: string | null
  discordUsername: string | null
  /** Whether `discordId` comes from this player signing in with their own osu! account. */
  discordVerified: boolean
  qualScore: number | null
  sheetSeed: number | null
  /**
   * Sum of the player's per-map Z-scores across the qualifier pool - what the seeding is derived
   * from. `null` for a player with no qualifier result on file.
   */
  zSum: number | null
  ppRaw: number | null
  ppRank: number | null
  captainMode: CaptainMode
  /** What is shown: an organiser's override if there is one, the sheet's text otherwise. */
  description: string | null
  /**
   * The sheet's own text, and whether an organiser has overridden it. Organisers only - an override
   * is sometimes there precisely to keep the sheet's text off screen - so `null`/`false` otherwise.
   */
  sheetDescription: string | null
  descriptionOverridden: boolean
  /** Whether this seed is inside the field that takes part - see `TournamentState.fieldSize`. */
  inField: boolean
  isCaptain: boolean
  /** osu! ID of the captain who bought this player, if any. */
  soldTo: string | null
  /** Nobody bid on them in the run under way, so they can't be offered again until the next one. */
  passedOver: boolean
  price: number | null
  /** Purse balance of the linked Discord account, for captains. `null` for a guest viewer. */
  balance: number | null
  held: number | null
  /** Qualifier results keyed by mappool slot id. */
  mapScores: Record<string, MapScore>
  extra: Record<string, string>
}

export interface TeamMemberDto {
  osuId: string
  username: string
  seed: number
  price: number
}

/** `balance`/`held` are `null` for a guest viewer - not "empty purse". */
export interface TeamDto {
  captainOsuId: string
  captainName: string
  captainSeed: number
  name: string
  discordId: string | null
  /** Discord ID of whoever may bid for this team besides the captain. `null` for a guest viewer. */
  proxyDiscordId: string | null
  /** And their Discord username, when it could be looked up. `null` for a guest viewer. */
  proxyUsername: string | null
  balance: number | null
  held: number | null
  spent: number
  members: TeamMemberDto[]
  slotsLeft: number
  /** How far this roster still is from the smallest legal team. */
  slotsToMinimum: number
  /** Gold this captain has to keep back to still fill `slotsToMinimum` at the starting price. */
  reserved: number
  /**
   * Whether the captain and the stand-in have the dashboard open right now - who could bid if an
   * auction started. Organisers only: `null` for everyone else. Either side is `null` when there is
   * no Discord account to look for (a captain with none linked, or no stand-in named).
   */
  presence: { captain: PresenceDto | null, proxy: PresenceDto | null } | null
}

export interface PresenceDto {
  /** At least one dashboard tab of theirs is connected. */
  online: boolean
  /** When their last tab closed; `null` if they have not been on the dashboard since the server started. */
  lastSeenAt: number | null
}

export interface ConfigDto {
  teamSize: number
  minTeamSize: number
  /** How many players take part, and how many were imported in total. */
  fieldSize: number | null
  fieldTotal: number
  /** Effective number of captains, whether derived or pinned. */
  captainCount: number
  /** Set when the count is pinned rather than derived from the team size. */
  captainCountOverride: number | null
  defaultStartingBid: number
  defaultMaxBid: number
  minBidIncrement: number
  maxBidIncrement: number
  secondRun: boolean
  modMultipliers: Record<string, number>
  /** What an auction started right now would open at - halved while `secondRun` is on. */
  startingBid: number
  /** The minimum raise in force right now - `minBidIncrement`, capped at 50 while `secondRun` is on. */
  bidIncrement: number
  seedingLocked: boolean
  auctionChannelConfigured: boolean
  /**
   * Whether the osu! OAuth2 application is set up. One credential covers both halves - linking an
   * account and looking players and beatmaps up - so this gates both.
   */
  osuConfigured: boolean
  botConnected: boolean
}

/** Which lookup a running import is in: osu! players first, then Discord handles. */
export type ImportPhase = 'osu' | 'discord'

/** Progress of a running sheet import. Rendered by the client, so it carries numbers not prose. */
export interface ImportProgress {
  done: number
  total: number
  phase: ImportPhase
}

/**
 * How the last import ended. Imports run after their request has been answered, so this is how the
 * result reaches whoever started one - `finishedAt` changing is the signal.
 */
export interface ImportOutcome {
  ok: boolean
  message: string
  code: string
  args: Record<string, string>
  finishedAt: number
}

/**
 * `user` is `null` for an anonymous viewer - the dashboard is readable without logging in, just with
 * Discord IDs, purse balances, spare sheet columns and the raw sheet links stripped out.
 */
export interface DashboardState {
  /** The server's Nuxt build. A tab built from another one reloads, so a deploy reaches every screen. */
  buildId: string
  user: UserSession | null
  config: ConfigDto
  players: PlayerDto[]
  teams: TeamDto[]
  mappool: QualifierMap[]
  /** Imported sheet columns not bound to a player field - what a mappool slot draws scores from. */
  sheetColumns: string[]
  mappoolSheet: MappoolSheetConfig | null
  auction: AuctionSnapshot | null
  /** Display name of the leading bidder, resolved against the captain list. */
  auctionLeader: string | null
  /** How the last auction ended, for the banner that announces it. Cancelled ones don't count. */
  lastResult: AuctionResultDto | null
  /** The last message an organiser sent to everyone, for the banner that shows it. */
  broadcast: Broadcast | null
  warnings: TournamentWarning[]
  sheet: SheetImportConfig | null
  registrationSheet: RegistrationSheetConfig | null
  importProgress: ImportProgress | null
  importOutcome: ImportOutcome | null
  /** Every qualifier lobby on file, newest first. */
  lobbies: QualifierLobbyDto[]
  /**
   * Scores an organiser typed in, as they typed them. The results already have them applied and
   * normalised; these are what the editor puts back in the box.
   */
  manualScores: ManualScore[]
  /** Players an organiser took off the list. Empty for a guest. */
  removedPlayers: RemovedPlayerDto[]
  poolRemaining: number
}

export interface RemovedPlayerDto {
  osuId: string
  username: string
}

/** What the dashboard shows when you paste a link, so columns can be mapped before importing. */
export interface SheetPreview {
  headers: string[]
  sampleRows: Record<string, string>[]
  rowCount: number
  suggestedMapping: ColumnMapping | null
  suggestedMappoolMapping: MappoolColumnMapping | null
  suggestedRegistrationMapping: RegistrationColumnMapping | null
}

/**
 * `error` is English prose and `code` names the same message in the dashboard's dictionary, with
 * `args` filling its placeholders - so every response stays readable on its own, in a log or to any
 * other caller of this API.
 */
export interface ApiError {
  error: string
  link?: string
  code?: string
  args?: Record<string, string>
}

export interface ApiOk {
  ok: true
  message?: string
  code?: string
  args?: Record<string, string>
}

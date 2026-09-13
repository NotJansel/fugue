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
  captainMode: CaptainMode
  /** What the player wrote about themselves on the sheet. Shown with the seeding and at auction. */
  description?: string | null
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
  /** The cell as the sheet wrote it, so separators and decimals show up the way organisers expect. */
  display: string
  rank: number
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
   * half the starting price. The ceiling and the increments are unchanged by it.
   */
  secondRun: boolean
  /** Set to pin the captain count instead of deriving it from `teamSize`. */
  captainCountOverride?: number | null
  seedingLocked: boolean
  defaultStartingBid: number
  defaultMaxBid: number
  /** captain osu! ID -> players they won. */
  rosters: Record<string, TeamMember[]>
  /** captain osu! ID -> team name. */
  teamNames: Record<string, string>
  /** The qualifier mappool, in pool order. */
  mappool: QualifierMap[]
  sheet?: SheetImportConfig | null
  /** Where the mappool was last imported from - a different document to `sheet` as a rule. */
  mappoolSheet?: MappoolSheetConfig | null
  /** Where registrations were last imported from - also its own document. */
  registrationSheet?: RegistrationSheetConfig | null
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
  /** Epoch millis at which the current countdown lapses, so clients can render it themselves. */
  endsAt: number
  channelId: string
  messageId: string
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
  ppRaw: number | null
  ppRank: number | null
  captainMode: CaptainMode
  description: string | null
  /** Whether this seed is inside the field that takes part - see `TournamentState.fieldSize`. */
  inField: boolean
  isCaptain: boolean
  /** osu! ID of the captain who bought this player, if any. */
  soldTo: string | null
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
  balance: number | null
  held: number | null
  spent: number
  members: TeamMemberDto[]
  slotsLeft: number
  /** How far this roster still is from the smallest legal team. */
  slotsToMinimum: number
  /** Gold this captain has to keep back to still fill `slotsToMinimum` at the starting price. */
  reserved: number
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
  /** What an auction started right now would open at - halved while `secondRun` is on. */
  startingBid: number
  seedingLocked: boolean
  auctionChannelConfigured: boolean
  /**
   * Whether the osu! OAuth2 application is set up. One credential covers both halves - linking an
   * account and looking players and beatmaps up - so this gates both.
   */
  osuConfigured: boolean
  botConnected: boolean
}

/**
 * One column of a published schedule. `list` gathers numbered slot columns - S1 to S12, Team 1 and
 * Team 2 - into one, since they read as a list of names rather than as twelve columns.
 */
export interface ScheduleColumn {
  label: string
  role: 'id' | 'date' | 'time' | 'text' | 'list'
}

export interface ScheduleRow {
  /** One entry per column: a `list` column's names, anything else as zero or one string. */
  cells: string[][]
  /** Start as epoch millis, when the date, the time and the sheet's time zone could all be read. */
  startsAt: number | null
}

/** One schedule from the sheet: everything under one heading, like "Qualifiers Schedule" or "FINALS". */
export interface ScheduleSection {
  title: string
  /** Qualifier lobbies rather than matches, going by the heading. */
  qualifiers: boolean
  columns: ScheduleColumn[]
  /** In start order; rows whose start could not be read follow in sheet order. */
  rows: ScheduleRow[]
}

/** The published schedule. `null` in `DashboardState` while no schedule sheet is set. */
export interface ScheduleDto {
  /** The sheet link - `null` for a guest, like every other sheet link. */
  url: string | null
  sections: ScheduleSection[]
  fetchedAt: number | null
  /** Why the last refresh failed; the sections are then still the last good ones. `null` for a guest. */
  error: ApiError | null
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
  warnings: TournamentWarning[]
  sheet: SheetImportConfig | null
  registrationSheet: RegistrationSheetConfig | null
  importProgress: ImportProgress | null
  importOutcome: ImportOutcome | null
  schedule: ScheduleDto | null
  poolRemaining: number
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

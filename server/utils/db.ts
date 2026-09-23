import type { PoolClient, QueryResultRow } from 'pg'
import pg from 'pg'
import { config } from './config'

/**
 * The one connection pool, and the schema it expects to find.
 *
 * Everything the tournament keeps lives in Postgres: seeding, rosters, the mappool, purses and osu!
 * links. Each store owns its own tables and holds the rows it has read in memory, so a dashboard
 * render is still a synchronous read - the database is what a mutation is written *through*, not
 * something the render path waits on.
 */
const { Pool, types } = pg

/**
 * `bigint` and `numeric` come back as strings by default, since either can hold more than a JS number
 * can. Nothing here stores a value anywhere near that large - epoch millis and star ratings - and the
 * types the dashboard agrees on are plain numbers, so both are parsed on the way out.
 */
types.setTypeParser(types.builtins.INT8, value => Number(value))
types.setTypeParser(types.builtins.NUMERIC, value => Number(value))

let pool: pg.Pool | null = null

/**
 * The pool, created on first use.
 *
 * With no `DATABASE_URL` the driver falls back to the standard `PGHOST`/`PGUSER`/`PGDATABASE`
 * variables, so a deployment that already sets those needs nothing extra.
 */
export function db(): pg.Pool {
  pool ??= new Pool({
    connectionString: config.databaseUrl ?? undefined,
    // An event-day tool has a handful of concurrent writers at most; the rest is idle SSE.
    max: 10,
    application_name: 'fugue'
  })

  return pool
}

/** Runs a statement and hands back the rows. */
export async function query<R extends QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<R[]> {
  const result = await db().query<R>(text, values)

  return result.rows
}

/**
 * Runs `block` inside a transaction on one connection, rolling back if it throws.
 *
 * Every store writes through this rather than statement by statement: a mutation is one new snapshot
 * of the thing being changed, and half of one on disk is worse than none.
 */
export async function withTransaction<T>(block: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect()

  try {
    await client.query('BEGIN')
    const result = await block(client)
    await client.query('COMMIT')

    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})

    throw error
  } finally {
    client.release()
  }
}

/**
 * Builds the `VALUES` list for a multi-row insert, numbering the placeholders across every row.
 *
 * Returns `null` for an empty list, which is the caller's cue to skip the statement entirely -
 * `INSERT ... VALUES` with nothing after it is a syntax error, and a tournament with no players yet
 * is perfectly ordinary.
 */
export function valuesList<T>(
  rows: T[],
  columns: (row: T, index: number) => unknown[]
): { text: string, values: unknown[] } | null {
  if (rows.length === 0) return null

  const values: unknown[] = []
  const text = rows.map((row, index) => {
    const cells = columns(row, index)
    const placeholders = cells.map((_, index) => `$${values.length + index + 1}`)
    values.push(...cells)

    return `(${placeholders.join(', ')})`
  }).join(', ')

  return { text, values }
}

/**
 * Creates every table if it isn't there yet.
 *
 * Kept as plain `IF NOT EXISTS` statements rather than a migration tool: the schema is small, it is
 * applied at boot, and a fresh database and an existing one then take exactly the same path.
 */
const schema = `
  CREATE TABLE IF NOT EXISTS tournament_settings (
    -- One row, forever: the check makes a second one impossible rather than merely unlikely.
    id                      boolean PRIMARY KEY DEFAULT true CHECK (id),
    team_size               integer NOT NULL,
    min_team_size           integer NOT NULL,
    field_size              integer,
    min_bid_increment       integer NOT NULL,
    max_bid_increment       integer NOT NULL,
    second_run              boolean NOT NULL,
    captain_count_override  integer,
    seeding_locked          boolean NOT NULL,
    default_starting_bid    integer NOT NULL,
    default_max_bid         integer NOT NULL,
    -- What EZ is worth, by mod combination: only EZ and EZHD apply, e.g. {"EZ": 1.8}.
    mod_multipliers         jsonb NOT NULL DEFAULT '{}'::jsonb
  );

  ALTER TABLE tournament_settings ADD COLUMN IF NOT EXISTS mod_multipliers jsonb NOT NULL DEFAULT '{}'::jsonb;

  CREATE TABLE IF NOT EXISTS players (
    osu_id        text PRIMARY KEY,
    -- Seeding order. 0-based, so it is the index in the list the dashboard reorders.
    seed          integer NOT NULL,
    username      text NOT NULL,
    discord_id    text,
    -- As the registration sheet wrote it; discord_id is what bids are keyed by.
    discord_username  text,
    qual_score    double precision,
    sheet_seed    integer,
    pp_raw        double precision,
    pp_rank       integer,
    -- Two letters, as osu! spells them; what the seeding export writes as a flag.
    country_code  text,
    captain_mode  text NOT NULL DEFAULT 'AUTO',
    description   text,
    -- What an organiser wrote in place of description. NULL for none; '' hides it.
    description_override  text,
    -- Sheet columns not bound to a field, including the per-map scores.
    extra         jsonb NOT NULL DEFAULT '{}'::jsonb
  );

  -- Added after the first release, so a database created before them gets the columns here.
  ALTER TABLE players ADD COLUMN IF NOT EXISTS description text;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS discord_username text;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS country_code text;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS description_override text;

  CREATE UNIQUE INDEX IF NOT EXISTS players_seed_idx ON players (seed);

  CREATE TABLE IF NOT EXISTS rosters (
    captain_osu_id  text NOT NULL REFERENCES players (osu_id) ON DELETE CASCADE,
    player_osu_id   text NOT NULL REFERENCES players (osu_id) ON DELETE CASCADE,
    price           integer NOT NULL,
    -- Order bought, so a team reads in the order the auction filled it.
    position        integer NOT NULL,
    PRIMARY KEY (captain_osu_id, player_osu_id)
  );

  CREATE TABLE IF NOT EXISTS team_names (
    captain_osu_id  text PRIMARY KEY REFERENCES players (osu_id) ON DELETE CASCADE,
    name            text NOT NULL
  );

  -- Someone besides the captain who may bid for a team, spending the captain's purse.
  CREATE TABLE IF NOT EXISTS team_proxies (
    captain_osu_id  text PRIMARY KEY REFERENCES players (osu_id) ON DELETE CASCADE,
    discord_id      text NOT NULL,
    -- As the guild knew them when they were named; NULL when the bot could not look them up.
    username        text
  );

  ALTER TABLE team_proxies ADD COLUMN IF NOT EXISTS username text;

  CREATE TABLE IF NOT EXISTS mappool (
    id              text PRIMARY KEY,
    position        integer NOT NULL,
    label           text NOT NULL,
    stage           text NOT NULL DEFAULT '',
    mods            text NOT NULL DEFAULT '',
    -- Header of the qualifier-sheet column this slot's scores live in. No scores are stored here.
    score_column    text,
    beatmap_id      text,
    beatmapset_id   text,
    artist          text,
    title           text,
    version         text,
    -- Rating and settings with this slot's mods already applied.
    stars           double precision,
    cs              double precision,
    ar              double precision,
    od              double precision,
    hp              double precision,
    bpm             double precision,
    length_seconds  integer
  );

  CREATE TABLE IF NOT EXISTS removed_players (
    osu_id    text PRIMARY KEY,
    -- The whole player as they were on the list, so a restore puts them back unchanged.
    player    jsonb NOT NULL,
    position  integer NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sheet_config (
    -- 'qualifier', 'registration' or 'mappool' - different documents as a rule.
    -- A 'schedule' row is left over from a feature since removed and is dropped below.
    kind         text PRIMARY KEY,
    url          text NOT NULL,
    sheet_name   text,
    mapping      jsonb NOT NULL,
    imported_at  bigint,
    -- Round the last mappool import filled in. Unused by the qualifier sheet.
    stage        text
  );

  DELETE FROM sheet_config WHERE kind = 'schedule';

  CREATE TABLE IF NOT EXISTS purses (
    -- Keyed by Discord ID: bids and purses are the one half of this that Discord owns.
    discord_id  text PRIMARY KEY,
    balance     integer NOT NULL DEFAULT 0 CHECK (balance >= 0)
  );

  CREATE TABLE IF NOT EXISTS qualifier_lobbies (
    match_id         bigint PRIMARY KEY,
    -- The lobby ID out of the match name, or the match ID for one that carries none.
    row_key          text NOT NULL,
    name             text NOT NULL,
    started_at       bigint NOT NULL,
    ended_at         bigint,
    -- Newest match event already read, so a re-read only asks for what came after it.
    latest_event_id  bigint
  );

  CREATE TABLE IF NOT EXISTS lobby_scores (
    game_id     bigint NOT NULL,
    user_id     text NOT NULL,
    match_id    bigint NOT NULL REFERENCES qualifier_lobbies (match_id) ON DELETE CASCADE,
    beatmap_id  text NOT NULL,
    username    text NOT NULL,
    score       bigint NOT NULL,
    mods        text NOT NULL DEFAULT '',
    -- The player's own mods beyond the game's. NULL on rows written before the column existed,
    -- which is what tells the store to read that lobby again.
    own_mods    text,
    passed      boolean NOT NULL,
    played_at   bigint NOT NULL,
    PRIMARY KEY (game_id, user_id)
  );

  ALTER TABLE lobby_scores ADD COLUMN IF NOT EXISTS own_mods text;

  -- Scores an organiser typed in, for the runs osu! has no record of: a disconnect early enough that
  -- nothing was submitted, a lobby that was never read. One per player and pool slot, and the last
  -- word on that cell whatever a lobby or a sheet says about it. Deliberately without a foreign key:
  -- the players table is rewritten in full on every save, which would take these with it.
  CREATE TABLE IF NOT EXISTS manual_scores (
    osu_id  text NOT NULL,
    map_id  text NOT NULL,
    -- As osu! would have reported it, mods and all; normalising it is the dashboard's business.
    -- Not an integer: what an organiser types is kept exactly as typed, decimals and all.
    score   double precision NOT NULL,
    -- The whole combination it was played with, the slot's own included. Empty for none.
    mods    text NOT NULL DEFAULT '',
    PRIMARY KEY (osu_id, map_id)
  );

  -- Started out as a bigint, which quietly rounded anything typed with a decimal on it.
  ALTER TABLE manual_scores ALTER COLUMN score TYPE double precision;

  CREATE TABLE IF NOT EXISTS osu_links (
    discord_id    text PRIMARY KEY,
    -- One osu! account belongs to exactly one Discord account, enforced here rather than only in code.
    osu_id        text NOT NULL UNIQUE,
    username      text NOT NULL,
    avatar_url    text,
    country_code  text,
    pp_raw        double precision,
    pp_rank       integer,
    linked_at     bigint NOT NULL
  );
`

/** Applies the schema and proves the connection works, so a bad `DATABASE_URL` fails at boot. */
export async function migrate(): Promise<void> {
  await db().query(schema)
}

/** Closes the pool on shutdown so the process can actually exit. */
export async function closeDatabase(): Promise<void> {
  const open = pool
  pool = null

  await open?.end()
}

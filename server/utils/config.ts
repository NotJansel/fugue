import { randomBytes } from 'node:crypto'

/**
 * Central place for every environment-backed setting. Values are read once at startup so that a
 * missing or malformed variable is reported immediately instead of at first use.
 *
 * The names are the same ones the Kotlin version used, so an existing `.env` carries over. Nuxt loads
 * `.env` in development; in production either export the variables or start the built server with
 * `node --env-file=.env .output/server/index.mjs`.
 */
function str(name: string): string | null {
  const value = process.env[name]

  return value != null && value.trim() !== '' ? value.trim() : null
}

function bool(name: string, fallback: boolean): boolean {
  const value = str(name)?.toLowerCase()

  return value === 'true' ? true : value === 'false' ? false : fallback
}

const webPort = Number(str('WEB_PORT') ?? str('PORT') ?? 3000)

export const config = {
  /** Discord bot token. Without one the dashboard still runs, just with no Discord half. */
  token: str('TOKEN'),

  /** Set to false to run the dashboard on its own, e.g. while working on the interface. */
  botEnabled: bool('BOT_ENABLED', true),

  webPort,

  /**
   * Externally reachable base URL of the dashboard, without a trailing slash. This is what both
   * OAuth2 redirects are built from, so it has to match the redirect URIs registered on the Discord
   * and osu! applications exactly.
   */
  publicUrl: (str('PUBLIC_URL') ?? `http://localhost:${webPort}`).replace(/\/+$/, ''),

  oauthClientId: str('OAUTH_CLIENT_ID'),
  oauthClientSecret: str('OAUTH_CLIENT_SECRET'),

  /** Guild whose `Administrator` permission grants write access to the dashboard. */
  guildId: str('GUILD_ID'),

  /** Channel used for auctions started from the dashboard (slash commands use their own channel). */
  auctionChannelId: str('AUCTION_CHANNEL'),

  /**
   * osu! OAuth2 (API v2) application, registered at https://osu.ppy.sh/home/account/edit#oauth with
   * `<PUBLIC_URL>/osu/callback` as its redirect URI.
   *
   * It does double duty: users prove which osu! account is theirs through it, and the same
   * credentials buy an app token for every player and beatmap lookup the tournament needs. There is
   * no separate API key any more.
   */
  osuClientId: str('OSU_CLIENT_ID'),
  osuClientSecret: str('OSU_CLIENT_SECRET'),

  /**
   * Whether the dashboard is usable without a linked osu! account. Only has an effect once the osu!
   * application above is configured, so an unconfigured deployment can never lock itself out.
   */
  osuLinkRequired: bool('OSU_LINK_REQUIRED', true),

  /**
   * Key the session cookie is sealed with. When unset a random one is generated, which is safe but
   * logs everyone out whenever the process restarts.
   */
  sessionSecret: str('SESSION_SECRET') ?? randomBytes(32).toString('hex'),

  /**
   * Postgres connection string - `postgres://user:password@host:5432/database`.
   *
   * Everything the tournament keeps lives there. Left unset, the driver falls back to the standard
   * `PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` variables, so a deployment that already sets those
   * needs nothing extra here.
   */
  databaseUrl: str('DATABASE_URL'),

  /**
   * Where a pre-Postgres deployment left its JSON stores. Read once, on the first boot against an
   * empty database, to carry an existing `data/` directory over; nothing is written back to it.
   */
  dataDir: str('DATA_DIR') ?? 'data'
}

/**
 * Which of the variables Discord login needs are still blank.
 *
 * Named one by one rather than as a yes/no, because "login is not configured" reads as "your
 * credentials are wrong" when in fact two of the three are fine and only the guild is missing.
 */
export const missingOauthVars = (): string[] => ([
  ['OAUTH_CLIENT_ID', config.oauthClientId],
  ['OAUTH_CLIENT_SECRET', config.oauthClientSecret],
  ['GUILD_ID', config.guildId]
] as const).filter(([, value]) => !value).map(([name]) => name)

/** OAuth2 is only usable once the application credentials and the guild to check against are known. */
export const oauthConfigured = (): boolean => missingOauthVars().length === 0

/** The osu! half of the same question - see [missingOauthVars]. */
export const missingOsuVars = (): string[] => ([
  ['OSU_CLIENT_ID', config.osuClientId],
  ['OSU_CLIENT_SECRET', config.osuClientSecret]
] as const).filter(([, value]) => !value).map(([name]) => name)

/** Whether users can be sent through the osu! half of the login flow at all. */
export const osuOauthConfigured = (): boolean => missingOsuVars().length === 0

/** Whether an unlinked session is refused access rather than merely nudged to link. */
export const osuLinkEnforced = (): boolean => osuOauthConfigured() && config.osuLinkRequired

/** Logs anything missing but not fatal, so misconfiguration shows up at boot rather than later on. */
export function warnAboutMissingValues(): void {
  const missingOauth = missingOauthVars()
  if (missingOauth.length > 0) {
    console.warn(`[config] Dashboard login is disabled - still blank: ${missingOauth.join(', ')}`)
  }

  const missingOsu = missingOsuVars()
  if (missingOsu.length > 0) {
    console.warn(
      `[config] Still blank: ${missingOsu.join(', ')} - without them nobody can link an osu! `
      + 'account, and no player or beatmap can be looked up'
    )
  }

  if (!config.auctionChannelId) {
    console.warn('[config] AUCTION_CHANNEL is not set - auctions cannot be started from the dashboard')
  }

  if (config.botEnabled && !config.token) {
    console.warn('[config] TOKEN is not set - the Discord half stays offline')
  }

  if (!config.databaseUrl && !str('PGHOST') && !str('PGDATABASE')) {
    console.warn(
      '[config] DATABASE_URL is not set - falling back to the libpq defaults (localhost, the current '
      + 'user, a database of the same name)'
    )
  }

  if (!str('SESSION_SECRET')) {
    console.warn('[config] SESSION_SECRET is not set - generated a random one, sessions will not survive a restart')
  }
}

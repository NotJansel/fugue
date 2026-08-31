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

  /** Where the JSON stores live. Same layout and file names as the Kotlin version. */
  dataDir: str('DATA_DIR') ?? 'data'
}

/** OAuth2 is only usable once the application credentials and the guild to check against are known. */
export const oauthConfigured = (): boolean =>
  Boolean(config.oauthClientId && config.oauthClientSecret && config.guildId)

/** Whether users can be sent through the osu! half of the login flow at all. */
export const osuOauthConfigured = (): boolean => Boolean(config.osuClientId && config.osuClientSecret)

/** Whether an unlinked session is refused access rather than merely nudged to link. */
export const osuLinkEnforced = (): boolean => osuOauthConfigured() && config.osuLinkRequired

/** Logs anything missing but not fatal, so misconfiguration shows up at boot rather than later on. */
export function warnAboutMissingValues(): void {
  if (!oauthConfigured()) {
    console.warn('[config] Dashboard login is disabled: set OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET and GUILD_ID')
  }

  if (!osuOauthConfigured()) {
    console.warn(
      '[config] Set OSU_CLIENT_ID and OSU_CLIENT_SECRET - without them nobody can link an osu! '
      + 'account, and no player or beatmap can be looked up'
    )
  }

  if (!config.auctionChannelId) {
    console.warn('[config] AUCTION_CHANNEL is not set - auctions cannot be started from the dashboard')
  }

  if (config.botEnabled && !config.token) {
    console.warn('[config] TOKEN is not set - the Discord half stays offline')
  }

  if (!str('SESSION_SECRET')) {
    console.warn('[config] SESSION_SECRET is not set - generated a random one, sessions will not survive a restart')
  }
}

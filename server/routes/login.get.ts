import { defineEventHandler, sendRedirect } from 'h3'
import { config, missingOauthVars } from '../utils/config'
import { lang, pick } from '../utils/lang'
import { renderNotice } from '../utils/notice'
import { DISCORD_STATE_COOKIE } from '../utils/discord-oauth'
import { issueState } from '../utils/oauth-state'

/**
 * Sends the user to Discord.
 *
 * Only the `identify` scope is requested - guild membership and the Administrator permission are
 * checked with the bot's own token instead, which avoids asking users for extra scopes.
 */
export default defineEventHandler(async (event) => {
  const language = lang(event)

  // Naming the ones that are actually blank, rather than all three every time: two of them being
  // right and the third empty is by far the likeliest way to end up on this page.
  const missing = missingOauthVars()

  if (missing.length > 0) {
    return renderNotice(event, {
      status: 503,
      lang: language,
      title: pick(language, 'Login is not configured', 'Die Anmeldung ist nicht konfiguriert'),
      message: pick(
        language,
        `Dashboard login needs OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET and GUILD_ID. Still blank: ${missing.join(', ')}.`,
        `Die Anmeldung braucht OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET und GUILD_ID. Noch leer: ${missing.join(', ')}.`
      ),
      links: [{ href: '/', label: pick(language, 'Back to the dashboard', 'Zurück zum Dashboard') }]
    })
  }

  const url = new URL('https://discord.com/oauth2/authorize')
  url.searchParams.set('client_id', config.oauthClientId ?? '')
  url.searchParams.set('redirect_uri', `${config.publicUrl}/callback`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'identify')
  url.searchParams.set('state', issueState(event, DISCORD_STATE_COOKIE))

  return sendRedirect(event, url.toString())
})

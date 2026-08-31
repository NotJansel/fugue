import { defineEventHandler, sendRedirect } from 'h3'
import { config, oauthConfigured } from '../utils/config'
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

  if (!oauthConfigured()) {
    return renderNotice(event, {
      status: 503,
      lang: language,
      title: pick(language, 'Login is not configured', 'Die Anmeldung ist nicht konfiguriert'),
      message: pick(
        language,
        'Set OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET and GUILD_ID to enable dashboard login.',
        'Setze OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET und GUILD_ID, um die Anmeldung zu aktivieren.'
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

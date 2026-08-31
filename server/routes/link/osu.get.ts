import { defineEventHandler, sendRedirect } from 'h3'
import { config, osuOauthConfigured } from '../../utils/config'
import { lang, pick } from '../../utils/lang'
import { renderNotice } from '../../utils/notice'
import { issueState } from '../../utils/oauth-state'
import { OSU_STATE_COOKIE } from '../../utils/osu-oauth'
import { getUserSession } from '../../utils/session'

/**
 * Starts the second half of the login: proving which osu! account is yours.
 *
 * Linking says something about *this* session, so there has to be one first.
 */
export default defineEventHandler(async (event) => {
  const language = lang(event)

  if (!await getUserSession(event)) return sendRedirect(event, '/login')

  if (!osuOauthConfigured()) {
    return renderNotice(event, {
      status: 503,
      lang: language,
      title: pick(language, 'osu! linking is not configured', 'Die osu!-Verknüpfung ist nicht konfiguriert'),
      message: pick(
        language,
        'Set OSU_CLIENT_ID and OSU_CLIENT_SECRET to enable it.',
        'Setze OSU_CLIENT_ID und OSU_CLIENT_SECRET, um sie zu aktivieren.'
      ),
      links: [{ href: '/', label: pick(language, 'Back to the dashboard', 'Zurück zum Dashboard') }]
    })
  }

  const url = new URL('https://osu.ppy.sh/oauth/authorize')
  url.searchParams.set('client_id', config.osuClientId ?? '')
  url.searchParams.set('redirect_uri', `${config.publicUrl}/osu/callback`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'identify')
  url.searchParams.set('state', issueState(event, OSU_STATE_COOKIE))

  return sendRedirect(event, url.toString())
})

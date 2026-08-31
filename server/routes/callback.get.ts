import { defineEventHandler, getQuery, sendRedirect } from 'h3'
import { osuOauthConfigured } from '../utils/config'
import { DISCORD_STATE_COOKIE, exchangeDiscordCode } from '../utils/discord-oauth'
import type { LoginFailure } from '../utils/discord-oauth'
import { lang, pick } from '../utils/lang'
import { renderNotice } from '../utils/notice'
import { consumeState } from '../utils/oauth-state'
import { getOsuLink } from '../utils/osu-link-store'
import { OSU_LINK_PATH, setUserSession } from '../utils/session'

/** Answers a failed login in the caller's language, with a status that says whose problem it is. */
const failures: Record<LoginFailure, { status: number, en: string, de: string }> = {
  UPSTREAM: {
    status: 503,
    en: 'Discord did not accept the login - please try again.',
    de: 'Discord hat die Anmeldung nicht akzeptiert - bitte versuche es erneut.'
  },
  UNAVAILABLE: {
    status: 503,
    en: 'The bot is not connected to Discord right now - please try again in a moment.',
    de: 'Der Bot ist gerade nicht mit Discord verbunden - bitte versuche es gleich noch einmal.'
  },
  OUTSIDER: {
    status: 403,
    en: 'You are not a member of the tournament server, so the dashboard is not open to you.',
    de: 'Du bist kein Mitglied des Turnier-Servers, daher steht dir das Dashboard nicht offen.'
  }
}

export default defineEventHandler(async (event) => {
  const language = lang(event)
  const code = getQuery(event).code
  const stateOk = consumeState(event, DISCORD_STATE_COOKIE)

  const notice = (status: number, en: string, de: string) => renderNotice(event, {
    status,
    lang: language,
    title: pick(language, 'Sign-in failed', 'Anmeldung fehlgeschlagen'),
    message: pick(language, en, de),
    links: [
      { href: '/login', label: pick(language, 'Try again', 'Erneut versuchen'), primary: true },
      { href: '/', label: pick(language, 'Continue as a guest', 'Als Gast fortfahren') }
    ]
  })

  if (!stateOk || typeof code !== 'string' || code === '') {
    return notice(
      400,
      'Login failed: invalid or expired request.',
      'Anmeldung fehlgeschlagen: ungültige oder abgelaufene Anfrage.'
    )
  }

  let outcome

  try {
    outcome = await exchangeDiscordCode(code)
  } catch (error) {
    console.error('[auth] Discord OAuth2 exchange failed:', error)
    outcome = { kind: 'failed', reason: 'UPSTREAM' } as const
  }

  if (outcome.kind === 'failed') {
    const failure = failures[outcome.reason]

    return notice(failure.status, failure.en, failure.de)
  }

  // Discord is only half the flow: users who have already proved which osu! account they own are
  // restored from the store, everyone else goes on to link theirs.
  const link = getOsuLink(outcome.session.id)

  const session = {
    ...outcome.session,
    osuId: link?.osuId ?? null,
    osuUsername: link?.username ?? null,
    osuAvatar: link?.avatarUrl ?? null
  }

  await setUserSession(event, session)

  return sendRedirect(event, session.osuId == null && osuOauthConfigured() ? OSU_LINK_PATH : '/')
})

import { defineEventHandler, getQuery, sendRedirect } from 'h3'
import { osuLinkEnforced } from '../../utils/config'
import { lang, pick } from '../../utils/lang'
import { renderNotice } from '../../utils/notice'
import { consumeState } from '../../utils/oauth-state'
import { linkOsuAccount } from '../../utils/osu-link-store'
import { OSU_STATE_COOKIE, exchangeOsuCode } from '../../utils/osu-oauth'
import { OSU_LINK_PATH, getUserSession, setUserSession } from '../../utils/session'
import { claimDiscordId } from '../../utils/tournament-store'

export default defineEventHandler(async (event) => {
  const language = lang(event)
  const session = await getUserSession(event)
  const code = getQuery(event).code
  const stateOk = consumeState(event, OSU_STATE_COOKIE)

  if (!session) return sendRedirect(event, '/login')

  /** Failure page for the osu! step, with a way out that does not involve guessing URLs. */
  const notice = (en: string, de: string) => renderNotice(event, {
    status: 400,
    lang: language,
    title: pick(language, 'osu! linking failed', 'osu!-Verknüpfung fehlgeschlagen'),
    message: pick(language, en, de),
    links: [
      { href: OSU_LINK_PATH, label: pick(language, 'Try again', 'Erneut versuchen'), primary: true },
      // Only offered when the dashboard is usable without a link - it would just bounce back otherwise.
      ...(osuLinkEnforced()
        ? []
        : [{ href: '/', label: pick(language, 'Continue without linking', 'Ohne Verknüpfung fortfahren') }]),
      { href: '/logout', label: pick(language, 'Sign out', 'Abmelden') }
    ]
  })

  if (!stateOk || typeof code !== 'string' || code === '') {
    // Also where a user who pressed "Cancel" on osu! ends up, since no code comes back.
    return notice(
      'osu! did not confirm the link - the request expired or was cancelled.',
      'osu! hat die Verknüpfung nicht bestätigt - die Anfrage ist abgelaufen oder wurde abgebrochen.'
    )
  }

  let identity

  try {
    identity = await exchangeOsuCode(code)
  } catch (error) {
    console.error('[auth] osu! OAuth2 exchange failed:', error)
    identity = null
  }

  if (!identity) {
    return notice(
      'Could not read your osu! account - please try again.',
      'Dein osu!-Konto konnte nicht gelesen werden - bitte versuche es erneut.'
    )
  }

  const result = await linkOsuAccount(session.id, identity)

  if (result.kind === 'taken') {
    console.warn(
      `[auth] Discord ${session.id} tried to link osu! ${identity.osuId}, `
      + `already held by Discord ${result.discordId}`
    )

    return notice(
      `${identity.username} is already linked to a different Discord account. `
      + 'Ask an organiser to unlink it first.',
      `${identity.username} ist bereits mit einem anderen Discord-Konto verknüpft. `
      + 'Bitte einen Organisator, die Verknüpfung zuerst zu lösen.'
    )
  }

  await setUserSession(event, {
    ...session,
    osuId: result.link.osuId,
    osuUsername: result.link.username,
    osuAvatar: result.link.avatarUrl ?? null
  })

  // A player logging in with their own osu! account is the most reliable Discord link there is, so it
  // wins over whatever was typed in or imported from the sheet.
  if (await claimDiscordId(identity.osuId, session.id)) {
    console.info(`[auth] Linked osu! ${identity.username} to Discord ${session.username}`)
  }

  return sendRedirect(event, '/')
})

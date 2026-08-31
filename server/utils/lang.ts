import type { H3Event } from 'h3'
import { getCookie, getRequestHeader } from 'h3'

/**
 * Language of the pages the server renders itself - the login failures and the osu!-link notice.
 *
 * The dashboard is translated in the browser, which is also what writes the `ba_lang` cookie read
 * here, so a language picked on the dashboard carries over to these pages. Visitors who have never
 * been that far are served by `Accept-Language` instead.
 */
export type Lang = 'en' | 'de'

export const LANG_COOKIE = 'ba_lang'

const of = (tag: string | undefined | null): Lang | null => {
  const head = tag?.toLowerCase().slice(0, 2)

  return head === 'de' ? 'de' : head === 'en' ? 'en' : null
}

/** The language to answer this call in: what the dashboard last saved, else what the browser asks for. */
export function lang(event: H3Event): Lang {
  const header = getRequestHeader(event, 'accept-language')?.split(',')[0]?.trim().split(';')[0]

  return of(getCookie(event, LANG_COOKIE)) ?? of(header) ?? 'en'
}

/** Picks the wording for a language. Each of these strings appears once, so they live at their site. */
export const pick = (language: Lang, en: string, de: string): string => language === 'de' ? de : en

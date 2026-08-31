import type { OsuLink } from '#shared/types'
import { emitChange } from './bus'
import { JsonStore } from './json-store'

interface LinkSnapshot {
  links: Record<string, OsuLink>
}

/** Outcome of recording a link. */
export type LinkResult
  = | { kind: 'linked', link: OsuLink }
  /** The osu! account is already claimed by `discordId`, a different Discord user. */
    | { kind: 'taken', discordId: string }

/**
 * Single source of truth for "which osu! account does this Discord user own".
 *
 * Only the identity is kept - the OAuth tokens are used once to read the account and then dropped,
 * since nothing here needs to act on a user's behalf later.
 */
const store = new JsonStore<LinkSnapshot>('osu_links.json', { links: {} })

export const loadOsuLinks = () => store.load()

export const getOsuLink = (discordId: string): OsuLink | null => store.get().links[discordId] ?? null

export const allOsuLinks = (): Record<string, OsuLink> => store.get().links

/** The Discord user that owns an osu! account, if anyone does. */
export function discordIdForOsuId(osuId: string): string | null {
  const entry = Object.entries(store.get().links).find(([, link]) => link.osuId === osuId)

  return entry?.[0] ?? null
}

/**
 * Records that `discordId` owns `link`.
 *
 * One osu! account maps to exactly one Discord account: a second Discord user signing in with the
 * same osu! account is rejected rather than silently stealing the link, since bids and purses are
 * keyed by Discord ID. Re-linking the same pair just refreshes the stored profile.
 */
export async function linkOsuAccount(discordId: string, link: OsuLink): Promise<LinkResult> {
  const owner = discordIdForOsuId(link.osuId)
  if (owner && owner !== discordId) return { kind: 'taken', discordId: owner }

  await store.update(current => ({ ...current, links: { ...current.links, [discordId]: link } }))
  emitChange()

  return { kind: 'linked', link }
}

/** Drops a link so the osu! account can be claimed again. Returns whether there was one. */
export async function unlinkOsuAccount(discordId: string): Promise<boolean> {
  if (!store.get().links[discordId]) return false

  await store.update((current) => {
    const { [discordId]: _dropped, ...links } = current.links

    return { ...current, links }
  })

  emitChange()

  return true
}

import type { OsuLink } from '#shared/types'
import { emitChange } from './bus'
import { query } from './db'
import { serialiser } from './store-queue'

/** Outcome of recording a link. */
export type LinkResult
  = | { kind: 'linked', link: OsuLink }
  /** The osu! account is already claimed by `discordId`, a different Discord user. */
    | { kind: 'taken', discordId: string }

/**
 * Single source of truth for "which osu! account does this Discord user own".
 *
 * Only the identity is kept - the OAuth tokens are used once to read the account and then dropped,
 * since nothing here needs to act on a user's behalf later. The `osu_links` table is cached here so
 * that "is this player verified" stays a synchronous question on the dashboard's render path.
 */
const links = new Map<string, OsuLink>()

const write = serialiser()

interface LinkRow {
  discord_id: string
  osu_id: string
  username: string
  avatar_url: string | null
  country_code: string | null
  pp_raw: number | null
  pp_rank: number | null
  linked_at: number
}

export async function loadOsuLinks(): Promise<void> {
  const rows = await query<LinkRow>('SELECT * FROM osu_links')

  links.clear()
  for (const row of rows) {
    links.set(row.discord_id, {
      osuId: row.osu_id,
      username: row.username,
      avatarUrl: row.avatar_url,
      countryCode: row.country_code,
      ppRaw: row.pp_raw,
      ppRank: row.pp_rank,
      linkedAt: row.linked_at
    })
  }
}

export const getOsuLink = (discordId: string): OsuLink | null => links.get(discordId) ?? null

export const allOsuLinks = (): Record<string, OsuLink> => Object.fromEntries(links)

/** The Discord user that owns an osu! account, if anyone does. */
export function discordIdForOsuId(osuId: string): string | null {
  const entry = [...links.entries()].find(([, link]) => link.osuId === osuId)

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

  await write(async () => {
    await query(
      `INSERT INTO osu_links (
         discord_id, osu_id, username, avatar_url, country_code, pp_raw, pp_rank, linked_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (discord_id) DO UPDATE SET
         osu_id = EXCLUDED.osu_id,
         username = EXCLUDED.username,
         avatar_url = EXCLUDED.avatar_url,
         country_code = EXCLUDED.country_code,
         pp_raw = EXCLUDED.pp_raw,
         pp_rank = EXCLUDED.pp_rank,
         linked_at = EXCLUDED.linked_at`,
      [
        discordId, link.osuId, link.username, link.avatarUrl ?? null, link.countryCode ?? null,
        link.ppRaw ?? null, link.ppRank ?? null, link.linkedAt
      ]
    )

    links.set(discordId, link)
  })

  emitChange()

  return { kind: 'linked', link }
}

/** Drops a link so the osu! account can be claimed again. Returns whether there was one. */
export async function unlinkOsuAccount(discordId: string): Promise<boolean> {
  if (!links.has(discordId)) return false

  await write(async () => {
    await query('DELETE FROM osu_links WHERE discord_id = $1', [discordId])
    links.delete(discordId)
  })

  emitChange()

  return true
}

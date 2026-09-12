import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OsuLink, QualifierMap, TournamentState } from '#shared/types'
import { config } from './config'
import { db, valuesList, withTransaction } from './db'
import { emptyTournament } from './tournament-model'
import { persistTournament } from './tournament-store'

/**
 * One-time move of a pre-Postgres deployment's `data/` directory into the database.
 *
 * The three JSON files are the ones both this and the original Kotlin version wrote, so an existing
 * install upgrades by pointing `DATABASE_URL` somewhere empty and restarting. It runs only against an
 * empty database and never deletes the files, so it is safe to leave `DATA_DIR` set afterwards and
 * the directory is still there to fall back to.
 */
export async function importLegacyData(): Promise<void> {
  if (await hasData()) return

  const [tournament, purses, osuLinks] = await Promise.all([
    readJson<TournamentState>('tournament.json'),
    readJson<{ balances: Record<string, number> }>('purses.json'),
    readJson<{ links: Record<string, OsuLink> }>('osu_links.json')
  ])

  if (!tournament && !purses && !osuLinks) return

  const state = { ...emptyTournament(), ...tournament }
  state.mappool = withIds(state.mappool)

  const balances = Object.entries(purses?.balances ?? {})

  // A file written before the one-osu!-account-per-Discord-user rule existed can name the same osu!
  // ID twice; the unique index would then reject the whole import, so the first claim wins.
  const claimed = new Set<string>()
  const links = Object.entries(osuLinks?.links ?? {}).filter(([, link]) => {
    if (claimed.has(link.osuId)) return false
    claimed.add(link.osuId)

    return true
  })

  await withTransaction(async (client) => {
    await persistTournament(client, state)

    const purseRows = valuesList(balances, ([userId, balance]) => [
      userId, Math.max(Math.trunc(balance), 0)
    ])
    if (purseRows) {
      await client.query(
        `INSERT INTO purses (discord_id, balance) VALUES ${purseRows.text}`,
        purseRows.values
      )
    }

    const linkRows = valuesList(links, ([discordId, link]) => [
      discordId, link.osuId, link.username, link.avatarUrl ?? null, link.countryCode ?? null,
      link.ppRaw ?? null, link.ppRank ?? null, link.linkedAt ?? 0
    ])
    if (linkRows) {
      await client.query(
        `INSERT INTO osu_links (
           discord_id, osu_id, username, avatar_url, country_code, pp_raw, pp_rank, linked_at
         ) VALUES ${linkRows.text}`,
        linkRows.values
      )
    }
  })

  console.info(
    `[store] Imported ${config.dataDir} into Postgres: ${state.players.length} players, `
    + `${balances.length} purses, ${links.length} osu! links`
  )
}

/** Whether anything has been written yet. A part-filled database is left alone rather than merged. */
async function hasData(): Promise<boolean> {
  const { rows } = await db().query<{ used: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM tournament_settings)
         OR EXISTS (SELECT 1 FROM players)
         OR EXISTS (SELECT 1 FROM purses)
         OR EXISTS (SELECT 1 FROM osu_links) AS used`
  )

  return rows[0]?.used ?? false
}

/** Reads one store file. A missing, empty or broken file is simply nothing to import. */
async function readJson<T>(fileName: string): Promise<T | null> {
  const file = join(config.dataDir, fileName)

  try {
    const content = await readFile(file, 'utf8')
    if (content.trim() === '') return null

    return JSON.parse(content) as T
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null

    console.error(`[store] Ignoring ${file}, which could not be read:`, error)

    return null
  }
}

/**
 * Gives every slot an id, since the id is the primary key now.
 *
 * Old pools can carry a blank one - it used to be assigned on save - and two blanks would collide.
 */
function withIds(mappool: QualifierMap[]): QualifierMap[] {
  const seen = new Set<string>()

  return mappool.map((map) => {
    const id = map.id && !seen.has(map.id) ? map.id : randomUUID()
    seen.add(id)

    return { ...map, id }
  })
}

import { defineEventHandler, readBody } from 'h3'
import type { ApiOk, RegistrationColumnMapping } from '#shared/types'
import { resolveDiscordUsernames } from '../../utils/discord-users'
import { apiError } from '../../utils/http-error'
import { setImportProgress, startImport } from '../../utils/import-progress'
import { requireAdmin } from '../../utils/session'
import { enrichPlayers, fetchSheet, toPlayers } from '../../utils/sheets'
import { getTournament, mergeRegistrations } from '../../utils/tournament-store'

interface Body {
  url: string
  sheetName?: string | null
  mapping: RegistrationColumnMapping
  enrich?: boolean
}

/**
 * Imports the registration sheet, merged into the players already on file.
 *
 * The registration list is its own document, separate from the qualifier results, so this is the
 * import to run before qualifiers - and after them to pick up edited descriptions - and it must not
 * reorder a seeding or overwrite a result. `mergeRegistrations` keeps both.
 *
 * The sheet is read and checked before answering; the osu! lookups, the Discord matching and the
 * merge run afterwards, in `startImport` - together they take longer than a proxy waits.
 */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<Body>(event)
  const data = await fetchSheet(body.url, body.sheetName)
  const parsed = toPlayers(data, body.mapping)

  if (parsed.length === 0) {
    throw apiError(400, 'No usable rows found - check the column mapping.', 'err.sheet.noRows')
  }

  const sheet = {
    url: body.url,
    sheetName: body.sheetName ?? null,
    mapping: body.mapping,
    importedAt: Date.now()
  }

  startImport(parsed.length, async () => {
    const enriched = body.enrich === false ? parsed : await enrichPlayers(parsed, setImportProgress)

    // A handle already linked to an account needs no second search - the merge keeps that ID anyway.
    const linked = new Set(getTournament().players.flatMap(player =>
      player.discordId && player.discordUsername ? [player.discordUsername] : []))

    const players = await resolveDiscordUsernames(enriched, linked, (done, total) =>
      setImportProgress(done, total, 'discord'))

    const { added, updated } = await mergeRegistrations(players, sheet)

    const unmatched = getTournament().players.filter(player => player.discordUsername && !player.discordId).length
    const args = { added: `${added}`, updated: `${updated}`, unmatched: `${unmatched}` }

    if (unmatched > 0) {
      return {
        message: `Added ${added} new players, updated ${updated}. `
          + `${unmatched} Discord username(s) matched no member of the server.`,
        code: 'ok.registeredUnmatched',
        args
      }
    }

    return { message: `Added ${added} new players, updated ${updated}.`, code: 'ok.registered', args }
  })

  return {
    ok: true,
    message: `Importing ${parsed.length} players in the background.`,
    code: 'ok.importStarted',
    args: { count: `${parsed.length}` }
  }
})

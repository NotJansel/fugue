import { defineEventHandler, readBody } from 'h3'
import type { ApiOk, RegistrationColumnMapping } from '#shared/types'
import { resolveDiscordUsernames } from '../../utils/discord-users'
import { apiError } from '../../utils/http-error'
import { clearImportProgress, setImportProgress } from '../../utils/import-progress'
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
 */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<Body>(event)
  const data = await fetchSheet(body.url, body.sheetName)
  const parsed = toPlayers(data, body.mapping)

  if (parsed.length === 0) {
    throw apiError(400, 'No usable rows found - check the column mapping.', 'err.sheet.noRows')
  }

  let players = parsed

  if (body.enrich !== false) {
    try {
      setImportProgress(0, parsed.length)
      players = await enrichPlayers(parsed, setImportProgress)
    } finally {
      clearImportProgress()
    }
  }

  players = await resolveDiscordUsernames(players)

  const { added, updated } = await mergeRegistrations(players, {
    url: body.url,
    sheetName: body.sheetName ?? null,
    mapping: body.mapping,
    importedAt: Date.now()
  })

  const unmatched = getTournament().players.filter(player => player.discordUsername && !player.discordId).length
  const args = { added: `${added}`, updated: `${updated}`, unmatched: `${unmatched}` }

  if (unmatched > 0) {
    return {
      ok: true,
      message: `Added ${added} new players, updated ${updated}. `
        + `${unmatched} Discord username(s) matched no member of the server.`,
      code: 'ok.registeredUnmatched',
      args
    }
  }

  return { ok: true, message: `Added ${added} new players, updated ${updated}.`, code: 'ok.registered', args }
})

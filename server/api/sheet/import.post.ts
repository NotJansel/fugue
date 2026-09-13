import { defineEventHandler, readBody } from 'h3'
import type { ApiOk, ColumnMapping } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { setImportProgress, startImport } from '../../utils/import-progress'
import { requireAdmin } from '../../utils/session'
import { enrichPlayers, fetchSheet, toPlayers } from '../../utils/sheets'
import { replacePlayers } from '../../utils/tournament-store'

interface Body {
  url: string
  sheetName?: string | null
  mapping: ColumnMapping
  enrich?: boolean
}

/**
 * Reads the qualifier sheet and replaces the player list with it.
 *
 * Everything that can be wrong with the request - the link, the sharing, the mapping - is checked
 * before answering; the osu! lookups and the write happen afterwards, in `startImport`.
 */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<Body>(event)
  const data = await fetchSheet(body.url, body.sheetName)
  // Descriptions belong to the registration sheet. Leaving the column unmapped here is what tells
  // `replacePlayers` to keep the one on file, even if a stale mapping still names one.
  const parsed = toPlayers(data, { ...body.mapping, description: null })

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
    const players = body.enrich === false ? parsed : await enrichPlayers(parsed, setImportProgress)

    await replacePlayers(players, sheet)

    return {
      message: `Imported ${players.length} players.`,
      code: 'ok.imported',
      args: { count: `${players.length}` }
    }
  })

  return {
    ok: true,
    message: `Importing ${parsed.length} players in the background.`,
    code: 'ok.importStarted',
    args: { count: `${parsed.length}` }
  }
})

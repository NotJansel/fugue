import { defineEventHandler, readBody } from 'h3'
import type { ApiOk, ColumnMapping } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { clearImportProgress, setImportProgress } from '../../utils/import-progress'
import { requireAdmin } from '../../utils/session'
import { enrichPlayers, fetchSheet, toPlayers } from '../../utils/sheets'
import { replacePlayers } from '../../utils/tournament-store'

interface Body {
  url: string
  sheetName?: string | null
  mapping: ColumnMapping
  enrich?: boolean
}

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

  let players = parsed

  if (body.enrich !== false) {
    try {
      setImportProgress(0, parsed.length)
      players = await enrichPlayers(parsed, setImportProgress)
    } finally {
      clearImportProgress()
    }
  }

  await replacePlayers(players, {
    url: body.url,
    sheetName: body.sheetName ?? null,
    mapping: body.mapping,
    importedAt: Date.now()
  })

  return {
    ok: true,
    message: `Imported ${players.length} players.`,
    code: 'ok.imported',
    args: { count: `${players.length}` }
  }
})

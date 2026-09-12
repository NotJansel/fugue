import { defineEventHandler, readBody } from 'h3'
import type { ApiOk, ColumnMapping } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { clearImportProgress, setImportProgress } from '../../utils/import-progress'
import { requireAdmin } from '../../utils/session'
import { enrichPlayers, fetchSheet, toPlayers } from '../../utils/sheets'
import { mergeRegistrations } from '../../utils/tournament-store'

interface Body {
  url: string
  sheetName?: string | null
  mapping: ColumnMapping
  enrich?: boolean
}

/**
 * Imports only who is registered, merged into the players already on file.
 *
 * The score and seed columns are ignored even when mapped: this is the import to run before
 * qualifiers, or after them to pick up late sign-ups and edited descriptions, and it must not reorder
 * a seeding or overwrite a result - `mergeRegistrations` keeps both.
 */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<Body>(event)
  const data = await fetchSheet(body.url, body.sheetName)
  const parsed = toPlayers(data, { ...body.mapping, score: null, seed: null })

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

  const { added, updated } = await mergeRegistrations(players, {
    url: body.url,
    sheetName: body.sheetName ?? null,
    mapping: body.mapping,
    importedAt: Date.now()
  })

  return {
    ok: true,
    message: `Added ${added} new players, updated ${updated}.`,
    code: 'ok.registered',
    args: { added: `${added}`, updated: `${updated}` }
  }
})

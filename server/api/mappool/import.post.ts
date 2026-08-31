import { defineEventHandler, readBody } from 'h3'
import type { ApiOk, MappoolColumnMapping } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { columnForSlot, saveMappool, slotKey } from '../../utils/mappool'
import { requireAdmin } from '../../utils/session'
import { fetchSheet, toMaps } from '../../utils/sheets'
import { spareSheetColumns } from '../../utils/tournament-model'
import { getTournament } from '../../utils/tournament-store'

interface Body {
  url: string
  sheetName?: string | null
  mapping: MappoolColumnMapping
  stage?: string
  startRow?: number | null
  endRow?: number | null
}

/**
 * Imports the pool from its own sheet - pools are published as a separate document from qualifier
 * results, so this is a second sheet with its own mapping rather than more columns on the first.
 *
 * Scores still come from the qualifier sheet: the pool sheet at most *names* the column, and where it
 * doesn't, a column named after the slot is bound automatically. Bindings made by hand survive a
 * re-import, matched by slot name.
 *
 * All rounds commonly share one sheet, stacked row after row, so `startRow`/`endRow` narrow the fetch
 * down to one round's rows and `stage` tags the result with it. Only that round's slots are replaced -
 * every other round already on file is left exactly as it was.
 */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<Body>(event)
  const stage = (body.stage ?? '').trim()

  const data = await fetchSheet(body.url, body.sheetName)
  const parsed = toMaps(data, body.mapping, body.startRow, body.endRow).map(map => ({ ...map, stage }))

  if (parsed.length === 0) {
    throw apiError(400, 'No maps found - check the column mapping and row range.', 'err.mappool.noRows')
  }

  const current = getTournament()
  const untouched = current.mappool.filter(map => map.stage !== stage)
  const byLabel = new Map(
    current.mappool.filter(map => map.stage === stage).map(map => [slotKey(map.label), map])
  )
  const columns = spareSheetColumns(current)

  const merged = parsed.map((map) => {
    const existing = byLabel.get(slotKey(map.label))

    return {
      ...map,
      id: existing?.id ?? '',
      column: map.column ?? existing?.column ?? columnForSlot(columns, map.label)
    }
  })

  await saveMappool([...untouched, ...merged], {
    url: body.url,
    sheetName: body.sheetName ?? null,
    mapping: body.mapping,
    importedAt: Date.now(),
    stage: stage === '' ? null : stage
  })

  return {
    ok: true,
    message: `Imported ${merged.length} maps.`,
    code: 'ok.mappool.imported',
    args: {
      count: `${merged.length}`,
      bound: `${merged.filter(map => map.column != null).length}`
    }
  }
})

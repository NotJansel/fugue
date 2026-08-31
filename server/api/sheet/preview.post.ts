import { defineEventHandler, readBody } from 'h3'
import { previewSheet } from '../../utils/sheets'
import { requireAdmin } from '../../utils/session'

interface Body {
  url: string
  sheetName?: string | null
}

/** Reads the headers and a good chunk of rows, so columns can be mapped before importing. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const body = await readBody<Body>(event)

  return previewSheet(body.url, body.sheetName)
})

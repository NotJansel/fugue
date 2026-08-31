import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { requireAdmin } from '../../utils/session'
import { getTournament, moveSeed } from '../../utils/tournament-store'

interface Body {
  osuId: string
  toIndex: number
}

/** Moves one player to a new seeding position. The lock is what stops edits mid-auction. */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<Body>(event)

  if (getTournament().seedingLocked) {
    throw apiError(409, 'Seeding is locked - unlock it to make changes.', 'err.seeding.locked')
  }

  await moveSeed(body.osuId, body.toIndex)

  return { ok: true }
})

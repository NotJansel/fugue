import { defineEventHandler } from 'h3'
import type { ApiOk } from '#shared/types'
import { cancelAuction } from '../../utils/auction'
import { apiError } from '../../utils/http-error'
import { requireAdmin } from '../../utils/session'

export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const cancelled = await cancelAuction()
  if (cancelled == null) throw apiError(409, 'No auction is currently running.', 'err.auction.none')

  return {
    ok: true,
    message: `Cancelled the auction for ${cancelled}.`,
    code: 'ok.auction.cancelled',
    args: { player: cancelled }
  }
})

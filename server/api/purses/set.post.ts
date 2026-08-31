import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { apiError } from '../../utils/http-error'
import { setBalance } from '../../utils/purse-store'
import { requireAdmin } from '../../utils/session'

export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<{ discordId: string, amount: number }>(event)

  if (!/^\d{5,}$/.test(body.discordId?.trim() ?? '')) {
    throw apiError(400, 'That isn\'t a Discord user ID.', 'err.discord.invalid')
  }

  await setBalance(body.discordId.trim(), Number(body.amount) || 0)

  return { ok: true }
})

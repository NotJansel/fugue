import { defineEventHandler, readBody } from 'h3'
import type { ApiOk } from '#shared/types'
import { setBalance } from '../../utils/purse-store'
import { requireAdmin } from '../../utils/session'
import { captains } from '../../utils/tournament-model'
import { getTournament } from '../../utils/tournament-store'

/** Gives every captain the same purse - how an auction night is set up in one click. */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const amount = Number((await readBody<{ amount: number }>(event)).amount) || 0
  const discordIds = captains(getTournament())
    .map(captain => captain.discordId)
    .filter((id): id is string => Boolean(id))

  for (const id of discordIds) await setBalance(id, amount)

  return {
    ok: true,
    message: `Set ${discordIds.length} captain purses to ${amount}.`,
    code: 'ok.purses',
    args: { count: `${discordIds.length}`, amount: `${amount}` }
  }
})

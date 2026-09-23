import { defineEventHandler, readBody } from 'h3'
import type { ApiOk, TeamProxy } from '#shared/types'
import { discordMemberName } from '../../utils/discord-users'
import { apiError } from '../../utils/http-error'
import { requireAdmin } from '../../utils/session'
import { captains } from '../../utils/tournament-model'
import { getTournament, setProxy } from '../../utils/tournament-store'

/**
 * Names the Discord account that may bid for a team besides its captain, or with `discordId: null`
 * takes that away again.
 *
 * A stand-in bids with the captain's purse and for the captain's roster, so an account that already
 * bids for a team of its own - as its captain, or as another team's stand-in - is refused: which of
 * the two teams one of its bids was for would otherwise be anybody's guess.
 *
 * The ID is looked up in the tournament guild on the way in, both to put a name on the team card and
 * to catch a mistyped one: an ID the guild has no member for is refused. With nobody to ask - the bot
 * offline - it is saved without a name rather than not at all.
 */
export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const body = await readBody<{ captainOsuId: string, discordId?: string | null }>(event)
  const discordId = body.discordId?.trim() || null
  const tournament = getTournament()
  const captain = captains(tournament).find(player => player.osuId === body.captainOsuId)

  if (!captain) throw apiError(404, 'That player isn\'t a captain.', 'err.proxy.notCaptain')

  if (discordId != null) {
    if (!/^\d{5,}$/.test(discordId)) throw apiError(400, 'That isn\'t a Discord user ID.', 'err.discord.invalid')

    const leads = captains(tournament).find(player => player.discordId === discordId)
    if (leads) {
      throw apiError(
        409,
        `That account already bids for ${leads.username}'s team as its captain.`,
        'err.proxy.isCaptain',
        { name: leads.username }
      )
    }

    const standsIn = Object.entries(tournament.proxies ?? {})
      .find(([captainOsuId, proxy]) => proxy.discordId === discordId && captainOsuId !== captain.osuId)
    if (standsIn) {
      const name = tournament.players.find(player => player.osuId === standsIn[0])?.username ?? standsIn[0]

      throw apiError(
        409,
        `That account already stands in for ${name}'s team.`,
        'err.proxy.taken',
        { name }
      )
    }
  }

  let proxy: TeamProxy | null = null

  if (discordId != null) {
    const username = await discordMemberName(discordId)

    if (username === false) {
      throw apiError(404, 'Nobody in the tournament server has that Discord ID.', 'err.proxy.unknown')
    }

    proxy = { discordId, username }
  }

  await setProxy(captain.osuId, proxy)

  return discordId == null
    ? {
        ok: true,
        message: `Only ${captain.username} can bid for their team now.`,
        code: 'ok.proxy.cleared',
        args: { name: captain.username }
      }
    : {
        ok: true,
        message: `${proxy?.username ? `@${proxy.username}` : discordId} can now bid for ${captain.username}'s team.`,
        code: 'ok.proxy.set',
        args: { name: captain.username, id: proxy?.username ? `@${proxy.username}` : discordId }
      }
})

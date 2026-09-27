import { defineEventHandler, readBody } from 'h3'
import type { ApiOk, TournamentPlayer } from '#shared/types'
import { startAuction } from '../../utils/auction'
import { config } from '../../utils/config'
import { apiError } from '../../utils/http-error'
import { fetchOsuUser, osuApiReady } from '../../utils/osu-api'
import { requireAdmin } from '../../utils/session'
import { playerDescription, pool, soldPlayerIds, startingBid, unsoldPool } from '../../utils/tournament-model'
import { getTournament, replacePlayers } from '../../utils/tournament-store'

interface Body {
  /** Left out, the auction is for a player drawn at random from whoever in the pool is still unsold. */
  osuId?: string | null
  startingBid?: number | null
  maxBid?: number | null
}

/**
 * Makes sure the auction card has real osu! data.
 *
 * Players imported without an ID column, or without enrichment, have no pp/rank and a placeholder ID
 * that would break the avatar. Look them up once here and write the result back.
 */
async function resolveForAuction(player: TournamentPlayer): Promise<TournamentPlayer> {
  const needsLookup = player.ppRaw == null || player.osuId.startsWith('name:')

  if (!needsLookup || !osuApiReady()) return player

  const query = player.osuId.replace(/^name:/, '') || player.username
  const fetched = await fetchOsuUser(query)
  if (!fetched) return player

  const updated: TournamentPlayer = {
    ...player,
    osuId: fetched.userId,
    username: fetched.username,
    ppRaw: fetched.ppRaw,
    ppRank: fetched.ppRank
  }

  const current = getTournament()
  await replacePlayers(
    current.players.map(entry => entry.osuId === player.osuId ? updated : entry),
    null
  )

  return updated
}

export default defineEventHandler(async (event): Promise<ApiOk> => {
  await requireAdmin(event)

  const channelId = config.auctionChannelId
  if (!channelId) throw apiError(400, 'AUCTION_CHANNEL is not configured.', 'err.auction.noChannel')

  const body = await readBody<Body>(event)
  const tournament = getTournament()

  let osuId = body.osuId

  if (osuId == null) {
    const unsold = unsoldPool(tournament)
    if (unsold.length === 0) throw apiError(409, 'Every player in the pool has been sold.', 'err.auction.poolEmpty')

    osuId = unsold[Math.floor(Math.random() * unsold.length)]!.osuId
  }

  const index = tournament.players.findIndex(player => player.osuId === osuId)

  if (index < 0) throw apiError(404, 'That player isn\'t in the tournament.', 'err.player.unknown')

  // Captains and anyone below the field cut are not up for sale, whatever the request asks for.
  if (!pool(tournament).some(player => player.osuId === osuId)) {
    throw apiError(409, 'That player is not in the auction pool.', 'err.player.notInPool')
  }

  // Selling someone twice would put them on two rosters and charge two purses for them.
  if (soldPlayerIds(tournament).has(osuId)) {
    throw apiError(409, 'That player has already been sold.', 'err.player.sold')
  }

  const player = await resolveForAuction(tournament.players[index]!)

  const result = await startAuction(
    channelId,
    {
      osuId: player.osuId,
      username: player.username,
      ppRaw: player.ppRaw ?? 0,
      ppRank: player.ppRank ?? 0,
      seed: index + 1,
      description: playerDescription(player)
    },
    body.startingBid ?? startingBid(tournament),
    body.maxBid ?? tournament.defaultMaxBid
  )

  if (result.kind === 'rejected') throw apiError(409, result.reason, result.code)

  return {
    ok: true,
    message: `Auction started for ${player.username}.`,
    code: 'ok.auction.started',
    args: { player: player.username }
  }
})

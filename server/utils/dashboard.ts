import type { DashboardState, PlayerDto, QualifierLobbyDto, TeamDto, UserSession } from '#shared/types'
import { auctionSnapshot, lastAuctionSale } from './auction'
import { config, osuOauthConfigured } from './config'
import { botConnected } from '../bot/client'
import { currentImportProgress, lastImportOutcome } from './import-progress'
import { allLobbies, allLobbyScores } from './lobby-store'
import { allManualScores } from './manual-score-store'
import { allOsuLinks } from './osu-link-store'
import { getAllBalances, getAllHolds } from './purse-store'
import {
  captainCount,
  captains,
  field,
  minBidIncrement,
  playerDescription,
  qualifierResults,
  reserveFor,
  spareSheetColumns,
  startingBid,
  warnings
} from './tournament-model'
import { getTournament } from './tournament-store'

/** The lobbies as the dashboard lists them: each with a count of what has been read out of it. */
function lobbyDtos(): QualifierLobbyDto[] {
  const games = new Map<number, Set<number>>()
  const players = new Map<number, Set<string>>()

  for (const score of allLobbyScores()) {
    let gameIds = games.get(score.matchId)
    if (!gameIds) games.set(score.matchId, gameIds = new Set())
    gameIds.add(score.gameId)

    let osuIds = players.get(score.matchId)
    if (!osuIds) players.set(score.matchId, osuIds = new Set())
    osuIds.add(score.osuId)
  }

  return allLobbies().map(lobby => ({
    matchId: lobby.matchId,
    key: lobby.key,
    name: lobby.name,
    startedAt: lobby.startedAt,
    endedAt: lobby.endedAt,
    games: games.get(lobby.matchId)?.size ?? 0,
    players: players.get(lobby.matchId)?.size ?? 0
  }))
}

/** What a player looks like to a viewer who hasn't logged in. */
const redactPlayer = (player: PlayerDto): PlayerDto => ({
  ...player,
  discordId: null,
  discordUsername: null,
  discordVerified: false,
  sheetDescription: null,
  descriptionOverridden: false,
  balance: null,
  held: null,
  extra: {}
})

/** What a team looks like to a viewer who hasn't logged in. */
const redactTeam = (team: TeamDto): TeamDto => ({
  ...team,
  discordId: null,
  proxyDiscordId: null,
  proxyUsername: null,
  balance: null,
  held: null
})

/**
 * Assembles the entire dashboard payload.
 *
 * Everything derived - seeds, captain flags, who bought whom, remaining team slots - is computed here
 * rather than stored, so the persisted state can never disagree with what's on screen.
 *
 * `user` is `null` for an anonymous viewer: the dashboard is readable without a login, so this still
 * returns a full payload, just with the fields a stranger has no business seeing - Discord IDs, purse
 * balances, spare sheet columns, and the raw sheet links (which would otherwise let anyone open the
 * organiser's spreadsheet and read the redacted columns anyway) - stripped out.
 */
export function buildDashboardState(user: UserSession | null): DashboardState {
  const tournament = getTournament()
  const admin = user?.admin === true
  const balances = getAllBalances()
  const holds = getAllHolds()

  // osu! ID -> the Discord account that proved it owns it, so the dashboard can tell a verified link
  // apart from one an organiser typed in.
  const verified = new Map(Object.entries(allOsuLinks()).map(([discordId, link]) => [link.osuId, discordId]))

  const chosenCaptains = captains(tournament)
  const captainIds = new Set(chosenCaptains.map(player => player.osuId))
  const takingPart = new Set(field(tournament).map(player => player.osuId))
  const seeds = new Map(tournament.players.map((player, index) => [player.osuId, index + 1]))
  const results = qualifierResults(tournament, allLobbyScores(), allManualScores())

  const purchases = new Map<string, { captainOsuId: string, price: number }>()
  for (const [captainOsuId, members] of Object.entries(tournament.rosters)) {
    for (const member of members) purchases.set(member.osuId, { captainOsuId, price: member.price })
  }

  const players: PlayerDto[] = tournament.players.map((player, index) => {
    const purchase = purchases.get(player.osuId)

    return {
      osuId: player.osuId,
      username: player.username,
      seed: index + 1,
      discordId: player.discordId ?? null,
      discordUsername: player.discordUsername ?? null,
      discordVerified: player.discordId != null && verified.get(player.osuId) === player.discordId,
      qualScore: player.qualScore ?? null,
      sheetSeed: player.sheetSeed ?? null,
      zSum: results.standings[player.osuId]?.zSum ?? null,
      ppRaw: player.ppRaw ?? null,
      ppRank: player.ppRank ?? null,
      captainMode: player.captainMode,
      description: playerDescription(player),
      // An override is sometimes there to keep the sheet's text off screen, so only organisers - who
      // need it to edit against - get to see what it replaced.
      sheetDescription: admin ? player.description ?? null : null,
      descriptionOverridden: admin && player.descriptionOverride != null,
      inField: takingPart.has(player.osuId),
      isCaptain: captainIds.has(player.osuId),
      soldTo: purchase?.captainOsuId ?? null,
      price: purchase?.price ?? null,
      balance: player.discordId ? balances[player.discordId] ?? 0 : null,
      held: player.discordId ? holds[player.discordId] ?? 0 : null,
      mapScores: results.scores[player.osuId] ?? {},
      extra: player.extra ?? {}
    }
  })

  const byOsuId = new Map(tournament.players.map(player => [player.osuId, player]))

  const teams: TeamDto[] = chosenCaptains.map((captain) => {
    const members = tournament.rosters[captain.osuId] ?? []

    return {
      captainOsuId: captain.osuId,
      captainName: captain.username,
      captainSeed: seeds.get(captain.osuId) ?? 0,
      name: tournament.teamNames[captain.osuId] ?? captain.username,
      discordId: captain.discordId ?? null,
      proxyDiscordId: tournament.proxies?.[captain.osuId]?.discordId ?? null,
      proxyUsername: tournament.proxies?.[captain.osuId]?.username ?? null,
      balance: captain.discordId ? balances[captain.discordId] ?? 0 : 0,
      held: captain.discordId ? holds[captain.discordId] ?? 0 : 0,
      spent: members.reduce((total, member) => total + member.price, 0),
      members: members.map(member => ({
        osuId: member.osuId,
        username: byOsuId.get(member.osuId)?.username ?? member.osuId,
        seed: seeds.get(member.osuId) ?? 0,
        price: member.price
      })),
      // The captain occupies one of the team's slots.
      slotsLeft: Math.max(tournament.teamSize - 1 - members.length, 0),
      slotsToMinimum: Math.max(tournament.minTeamSize - 1 - members.length, 0),
      reserved: reserveFor(tournament, captain.osuId)
    }
  })

  const auction = auctionSnapshot()
  const leaderCaptain = auction?.highestBidderId
    ? chosenCaptains.find(captain => captain.discordId === auction.highestBidderId)
    : undefined
  const auctionLeader = leaderCaptain
    ? tournament.teamNames[leaderCaptain.osuId] ?? leaderCaptain.username
    : null

  const sale = lastAuctionSale()
  const saleCaptain = sale ? byOsuId.get(sale.captainOsuId) : undefined
  const lastSale = sale
    ? { ...sale, teamName: tournament.teamNames[sale.captainOsuId] ?? saleCaptain?.username ?? sale.captainOsuId }
    : null

  const guest = user == null

  return {
    user,
    config: {
      teamSize: tournament.teamSize,
      minTeamSize: tournament.minTeamSize,
      fieldSize: tournament.fieldSize ?? null,
      fieldTotal: tournament.players.length,
      captainCount: captainCount(tournament),
      captainCountOverride: tournament.captainCountOverride ?? null,
      defaultStartingBid: tournament.defaultStartingBid,
      defaultMaxBid: tournament.defaultMaxBid,
      minBidIncrement: tournament.minBidIncrement,
      maxBidIncrement: tournament.maxBidIncrement,
      secondRun: tournament.secondRun,
      modMultipliers: tournament.modMultipliers ?? {},
      startingBid: startingBid(tournament),
      bidIncrement: minBidIncrement(tournament),
      seedingLocked: tournament.seedingLocked,
      auctionChannelConfigured: config.auctionChannelId != null,
      osuConfigured: osuOauthConfigured(),
      botConnected: botConnected()
    },
    players: guest ? players.map(redactPlayer) : players,
    teams: guest ? teams.map(redactTeam) : teams,
    mappool: tournament.mappool,
    sheetColumns: guest ? [] : spareSheetColumns(tournament),
    mappoolSheet: guest ? null : tournament.mappoolSheet ?? null,
    auction: guest && auction ? { ...auction, highestBidderId: null } : auction,
    auctionLeader,
    lastSale,
    warnings: warnings(tournament),
    sheet: guest ? null : tournament.sheet ?? null,
    registrationSheet: guest ? null : tournament.registrationSheet ?? null,
    importProgress: currentImportProgress(),
    importOutcome: guest ? null : lastImportOutcome(),
    lobbies: lobbyDtos(),
    manualScores: allManualScores(),
    removedPlayers: guest
      ? []
      : (tournament.removedPlayers ?? []).map(player => ({ osuId: player.osuId, username: player.username })),
    poolRemaining: players.filter(player => player.inField && !player.isCaptain && player.soldTo == null).length
  }
}

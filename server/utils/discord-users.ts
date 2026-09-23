import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js'
import type { TournamentPlayer } from '#shared/types'
import { getClient } from '../bot/client'
import { config } from './config'

/**
 * What the tournament guild says about one Discord ID: the member's username, `false` when the guild
 * has no member by that ID, or `null` when there was nobody to ask - the bot offline, `GUILD_ID`
 * unset, or Discord failing in some other way. Only `false` is an answer worth refusing on.
 */
export async function discordMemberName(discordId: string): Promise<string | false | null> {
  const client = getClient()
  if (!client?.isReady() || !config.guildId) return null

  const guild = await client.guilds.fetch(config.guildId).catch(() => null)
  if (!guild) return null

  try {
    return (await guild.members.fetch(discordId)).user.username
  } catch (error) {
    const missing = error instanceof DiscordAPIError
      && (error.code === RESTJSONErrorCodes.UnknownMember || error.code === RESTJSONErrorCodes.UnknownUser)
    if (missing) return false

    console.error(`[discord] Could not look up member ${discordId}:`, error)

    return null
  }
}

/**
 * Turns the Discord usernames a registration sheet names into user IDs, by searching the tournament
 * guild.
 *
 * Bids, purses and captains are keyed by ID, and a username cannot stand in for one. Only players
 * without an ID are looked up, and only an exact match counts - on the username, or on a display name
 * or nickname exactly one member has. The nearest name is never taken instead. Anything that can't be matched, including everyone while the bot is offline or
 * `GUILD_ID` is unset, keeps its username and no ID; signing in with osu! still links the account.
 */
export async function resolveDiscordUsernames(
  players: TournamentPlayer[],
  skip: Set<string> = new Set(),
  onProgress: (done: number, total: number) => void = () => {}
): Promise<TournamentPlayer[]> {
  const wanted = [...new Set(players.flatMap(player =>
    player.discordUsername && !player.discordId && !skip.has(player.discordUsername)
      ? [player.discordUsername]
      : []
  ))]

  if (wanted.length === 0) return players

  const client = getClient()

  if (!client?.isReady() || !config.guildId) {
    console.warn('[discord] Cannot match Discord usernames: the bot is not connected or GUILD_ID is not set')

    return players
  }

  const guild = await client.guilds.fetch(config.guildId).catch(() => null)

  if (!guild) {
    console.error(`[discord] GUILD_ID ${config.guildId} is not a guild this bot is in - no usernames matched`)

    return players
  }

  const ids = new Map<string, string>()

  onProgress(0, wanted.length)

  for (const [index, username] of wanted.entries()) {
    try {
      const found = [...(await guild.members.search({ query: username, limit: 10 })).values()]

      // People write their display name where the username belonged often enough to allow for it, but
      // only when exactly one member answers to it - a guess between two would link the wrong person.
      const byUsername = found.find(candidate => candidate.user.username.toLowerCase() === username)
      const byDisplayName = found.filter(candidate =>
        [candidate.nickname, candidate.user.globalName].some(name => name?.toLowerCase() === username))
      const member = byUsername ?? (byDisplayName.length === 1 ? byDisplayName[0] : undefined)

      if (member) ids.set(username, member.id)
      onProgress(index + 1, wanted.length)
    } catch (error) {
      console.error('[discord] Member search failed - leaving the remaining usernames unmatched:', error)

      break
    }
  }

  return players.map((player) => {
    const id = !player.discordId && player.discordUsername ? ids.get(player.discordUsername) : undefined

    return id ? { ...player, discordId: id } : player
  })
}

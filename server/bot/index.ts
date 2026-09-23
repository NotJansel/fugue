import { Client, GatewayIntentBits, MessageFlags, Routes, version as discordVersion } from 'discord.js'
import type { ChatInputCommandInteraction } from 'discord.js'
import { cancelAuction, startAuction } from '../utils/auction'
import { config } from '../utils/config'
import { fetchOsuUser, osuApiReady } from '../utils/osu-api'
import { getBalance, setBalance } from '../utils/purse-store'
import { playerDescription } from '../utils/tournament-model'
import { getTournament } from '../utils/tournament-store'
import { bindClient, getClient } from './client'
import { commands } from './commands'

/**
 * Registers the slash commands.
 *
 * They go to `GUILD_ID` when one is configured, because guild commands appear immediately while
 * global ones take up to an hour - and this bot is only ever used in the one tournament server.
 */
async function registerCommands(client: Client<true>): Promise<void> {
  const route = config.guildId
    ? Routes.applicationGuildCommands(client.application.id, config.guildId)
    : Routes.applicationCommands(client.application.id)

  try {
    await client.rest.put(route, { body: commands })
    console.info(`[bot] Registered ${commands.length} commands${config.guildId ? ` in ${config.guildId}` : ' globally'}`)
  } catch (error) {
    console.error('[bot] Failed to register slash commands:', error)
  }
}

/**
 * Says at boot whether `GUILD_ID` names a guild this bot is in.
 *
 * Every dashboard login is checked against that guild, so an ID carried over from another deployment
 * turns every sign-in into a failure - and this is the first moment there is a client to ask with.
 */
async function checkGuild(client: Client<true>): Promise<void> {
  if (!config.guildId) return

  const guild = await client.guilds.fetch(config.guildId).catch(() => null)

  if (!guild) {
    console.error(`[bot] GUILD_ID ${config.guildId} is not a guild this bot is in - dashboard logins will fail`)
  } else {
    console.info(`[bot] Dashboard access is granted through ${guild.name} (${config.guildId})`)
  }
}

async function handleAuction(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!osuApiReady()) {
    await interaction.reply({
      content: 'OSU_CLIENT_ID/OSU_CLIENT_SECRET are not configured, so players can\'t be looked up.',
      flags: MessageFlags.Ephemeral
    })

    return
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const player = await fetchOsuUser(interaction.options.getString('userid', true))

  if (!player) {
    await interaction.editReply({ content: 'User not found!' })

    return
  }

  const registered = getTournament().players.find(entry => entry.osuId === player.userId)

  const result = await startAuction(
    interaction.channelId,
    {
      osuId: player.userId,
      username: player.username,
      ppRaw: player.ppRaw,
      ppRank: player.ppRank,
      seed: interaction.options.getInteger('seed', true),
      // The command auctions any osu! user, so a description only exists for one who is registered.
      description: registered ? playerDescription(registered) : null
    },
    interaction.options.getInteger('startingprice', true),
    interaction.options.getInteger('maxprice', true)
  )

  await interaction.editReply({
    content: result.kind === 'started' ? `Auction started for ${player.username}.` : result.reason
  })
}

function systemInfo(): string {
  const memory = process.memoryUsage()
  const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`

  return [
    '**System Information:**',
    `- Node: ${process.version}`,
    `- Platform: ${process.platform} ${process.arch}`,
    `- Memory: ${mb(memory.heapUsed)} heap used / ${mb(memory.rss)} resident`,
    `- Uptime: ${Math.floor(process.uptime() / 60)} min`,
    '**Dependency Versions:**',
    `- discord.js: ${discordVersion}`,
    `- V8: ${process.versions.v8}`
  ].join('\n')
}

async function handleInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  switch (interaction.commandName) {
    case 'auction':
      await handleAuction(interaction)
      break

    case 'auctioncancel': {
      const cancelled = await cancelAuction()

      await interaction.reply({
        content: cancelled == null
          ? 'No auction is currently running.'
          : `Auction for ${cancelled} has been cancelled.`
      })
      break
    }

    case 'setpurse': {
      const user = interaction.options.getUser('user', true)
      const amount = interaction.options.getInteger('amount', true)

      await setBalance(user.id, amount)
      await interaction.reply({ content: `Set purse for <@${user.id}> to ${amount}.` })
      break
    }

    case 'mypurse':
      await interaction.reply({
        content: `Your purse balance: ${getBalance(interaction.user.id)}`,
        flags: MessageFlags.Ephemeral
      })
      break

    case 'sysinfo':
      await interaction.reply({ content: systemInfo() })
      break

    default:
      await interaction.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral })
  }
}

/**
 * Connects the bot.
 *
 * The dashboard is already serving by the time this runs - anything that needs Discord reads the
 * client through `bot/client.ts` and copes with it being null until this resolves.
 */
export async function startBot(): Promise<void> {
  if (!config.botEnabled) {
    console.info('[bot] Disabled (BOT_ENABLED=false) - running the dashboard on its own')

    return
  }

  if (!config.token) {
    console.warn('[bot] TOKEN is not set - running the dashboard without the Discord half')

    return
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] })

  client.once('clientReady', async (ready) => {
    console.info(`[bot] Connected as ${ready.user.tag}`)
    bindClient(ready)

    await registerCommands(ready)
    await checkGuild(ready)
  })

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return

    try {
      await handleInteraction(interaction)
    } catch (error) {
      console.error(`[bot] Command /${interaction.commandName} failed:`, error)

      const content = 'Something went wrong running that command.'

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content }).catch(() => {})
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {})
      }
    }
  })

  client.on('error', error => console.error('[bot] Client error:', error))

  try {
    await client.login(config.token)
  } catch (error) {
    console.error('[bot] Failed to log in - the dashboard keeps running without Discord:', error)
    bindClient(null)
  }
}

export async function stopBot(): Promise<void> {
  const client = getClient()

  bindClient(null)
  await client?.destroy()
}

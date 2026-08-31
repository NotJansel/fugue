import { ApplicationCommandOptionType, PermissionFlagsBits } from 'discord.js'

/**
 * The bot's slash commands, as raw application-command JSON.
 *
 * Bidding is deliberately absent: bids are placed on the dashboard, where the bidder is a signed-in
 * session rather than whoever typed a number in a channel. Discord only receives the card updates and
 * the result announcement.
 */
export const commands = [
  {
    name: 'auction',
    description: 'Start an auction for an osu! player',
    default_member_permissions: String(PermissionFlagsBits.Administrator),
    options: [
      {
        name: 'userid',
        description: 'osu! user ID or username of the player to auction',
        type: ApplicationCommandOptionType.String,
        required: true
      },
      {
        name: 'seed',
        description: 'Seed number',
        type: ApplicationCommandOptionType.Integer,
        min_value: 0,
        required: true
      },
      {
        name: 'startingprice',
        description: 'Starting bid amount',
        type: ApplicationCommandOptionType.Integer,
        min_value: 0,
        required: true
      },
      {
        name: 'maxprice',
        description: 'Maximum bid amount',
        type: ApplicationCommandOptionType.Integer,
        min_value: 0,
        required: true
      }
    ]
  },
  {
    name: 'auctioncancel',
    description: 'Cancel the currently running auction',
    default_member_permissions: String(PermissionFlagsBits.Administrator),
    options: []
  },
  {
    name: 'setpurse',
    description: 'Set a user\'s purse balance',
    default_member_permissions: String(PermissionFlagsBits.Administrator),
    options: [
      {
        name: 'user',
        description: 'Whose purse to set',
        type: ApplicationCommandOptionType.User,
        required: true
      },
      {
        name: 'amount',
        description: 'Purse balance',
        type: ApplicationCommandOptionType.Integer,
        min_value: 0,
        required: true
      }
    ]
  },
  {
    name: 'mypurse',
    description: 'Show your purse balance',
    options: []
  },
  {
    name: 'sysinfo',
    description: 'Show system information',
    options: []
  }
]

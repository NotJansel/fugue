import type { Client } from 'discord.js'

/**
 * Holds the live Discord client for code that runs outside the bot itself.
 *
 * The dashboard is up as soon as Nitro is, which is well before Discord finishes connecting, so
 * requests that need Discord (permission checks, posting auction cards) read the client through here
 * and fail gracefully while it's null.
 */
let client: Client | null = null

export const bindClient = (instance: Client | null): void => {
  client = instance
}

export const getClient = (): Client | null => client

export const botConnected = (): boolean => client?.isReady() ?? false

/** Components V2: the flag that tells Discord to read `components` instead of `content`/`embeds`. */
export const IS_COMPONENTS_V2 = 1 << 15

/** Deep gold, the auction card's accent - the dashboard's own highlight colour. */
export const AUCTION_ACCENT = 0xC9A227

interface AuctionCardSubject {
  osuId: string
  username: string
  ppRaw: number
  ppRank: number
  seed: number
}

/**
 * The auction card, as a raw Components V2 payload.
 *
 * Built by hand rather than with the builders so the same object serves the initial post and every
 * bid update, and so the shape stays obvious next to Discord's own documentation.
 */
export function auctionCard(
  subject: AuctionCardSubject,
  startingBid: number,
  maxBid: number,
  bidStatus?: string | null
) {
  const components: unknown[] = [
    {
      type: 9,
      components: [
        { type: 10, content: `## ${subject.username}` },
        { type: 10, content: `Starting Price: ${startingBid}€` },
        { type: 10, content: `Max Price: ${maxBid}€` }
      ],
      accessory: {
        type: 11,
        media: { url: `https://a.ppy.sh/${subject.osuId}` },
        description: 'pfp'
      }
    },
    { type: 14, spacing: 2, divider: true },
    { type: 10, content: `PP: ${subject.ppRaw}` },
    { type: 10, content: `Rank: #${subject.ppRank}` },
    { type: 10, content: `Seed: #${subject.seed}` }
  ]

  if (bidStatus) {
    components.push({ type: 14, spacing: 2, divider: false }, { type: 10, content: bidStatus })
  }

  return {
    flags: IS_COMPONENTS_V2,
    components: [{ type: 17, accent_color: AUCTION_ACCENT, components }]
  }
}

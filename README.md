# osu!-Auction Tournament Bot

Run auctions for your tournament.

A Discord bot plus a web dashboard, in one Node process: import qualifier results from a Google
Sheet, work out how many captains the bracket needs, adjust the seeding by hand, and run the auction
itself — announced in Discord, bid on and followed live in the dashboard.

This is a Nuxt 4 / Nitro port of the original Kotlin (KordEx + Ktor) bot. The stored JSON files are
unchanged, so an existing `data/` directory carries straight over.

## Running it

Copy `.env.example` to `.env` and fill it in, then:

```bash
pnpm install
```

```bash
pnpm dev
```

The dashboard is served on `WEB_PORT` (8080 in the template, 3000 if unset). Set `BOT_ENABLED=false`
to run the dashboard on its own.

For production:

```bash
pnpm build && pnpm start
```

`pnpm start` runs the built server with `--env-file-if-exists=.env`. Exporting the variables and
running `node .output/server/index.mjs` works just as well; behind a reverse proxy, set `HOST` and
`PORT` the way any Nitro app expects and point `PUBLIC_URL` at the externally reachable address.

### Docker

Every push to `main` publishes `git.jansel.dev/jansel/fugue:latest`, plus a tag for the commit it was
built from. Publish the port and mount the data volume:

```bash
docker run -p 8080:8080 -v ./data:/bot/data --env-file .env git.jansel.dev/jansel/fugue:latest
```

The image listens on 8080 and keeps its three JSON stores in `/bot/data` — mount something over that
or an auction night dies with the container. `PUBLIC_URL` still has to name the address the outside
world reaches, or both OAuth2 redirects will point at the container.

### Dockge

[`compose.yaml`](compose.yaml) is a ready stack. Create one in Dockge, paste the file in, and fill
the values in its **Environment Variables** tab — Dockge writes them to a `.env` beside the compose
file, which is where every `${...}` in it reads from. `HOST_PORT` moves the published port without
touching anything else; the app always listens on 8080 inside the container.

Anything left blank degrades rather than crashes: no `TOKEN` runs the dashboard on its own, no osu!
credentials means no lookups, and the boot log names whichever is missing.

The stack's state lands in `./data` next to the compose file — back that up, and never point two
stacks at the same directory.

## Dashboard setup

1. In the [Discord Developer Portal](https://discord.com/developers), open the same application the
   bot token belongs to, go to **OAuth2**, and add `<PUBLIC_URL>/callback` as a redirect URI.
2. Put the client ID and secret into `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET`, and the tournament
   server's ID into `GUILD_ID`.
3. Set `SESSION_SECRET` to a long random string so logins survive restarts.
4. Register an OAuth application at
   [osu!'s account settings](https://osu.ppy.sh/home/account/edit#oauth) with
   `<PUBLIC_URL>/osu/callback` as its callback, and set `OSU_CLIENT_ID` / `OSU_CLIENT_SECRET`. The
   same credentials cover both halves of the osu! API v2 usage: signing users in, and looking players
   and beatmaps up. There is no legacy v1 API key.

Anyone can *read* the dashboard, with Discord IDs, purse balances and the sheet links stripped out.
Anyone in the guild sees the full picture; anyone with **Administrator** there can change things.

Signing in is two steps: Discord, then osu!. The second one is what makes a captain's Discord link
trustworthy — purses and bids are keyed by Discord ID, while everything else is keyed by osu! ID. Set
`OSU_LINK_REQUIRED=false` to let people in without it.

## Qualifier import

Share the qualifier sheet as *anyone with the link can view* and paste its URL into the Setup tab.
The dashboard reads the sheet's CSV export — no Google credentials involved — shows you the columns
it found, and lets you map them onto player name, osu! ID, Discord ID, qualifier score and seed.

Players are ordered by the seed column if there is one, otherwise by qualifier score, and each is
looked up on the osu! API v2 to fill in ID, pp and rank. Re-importing after fixing the sheet keeps
manual Discord links, captain overrides and anything already bought at auction.

## Captains and seeding

The number of captains follows the field size: `qualified ÷ players per team`, rounded down, so 34
qualifiers in teams of 4 gives 8 captains and 26 players in the pool. The dashboard flags the
leftovers. You can pin the count instead if you want an exact bracket.

The top seeds become captains automatically. Drag rows to reorder the seeding, or mark a specific
player **Captain** or **Never** to override the cut-off regardless of where they sit.

## Mappool

The pool is usually published as its own sheet, often with every round stacked in one document, so
the import takes a round name and a row range and replaces only that round. It supplies slot names
and beatmap IDs; the *scores* still come from the qualifier sheet, bound per slot to a column named
after it.

Star ratings and difficulty settings are shown with the slot's mods applied — a DT slot is rated at
its DT rating. Mods are taken from the slot name (`HD2` → HD) unless you say otherwise.

## Auction

Auctions are started from the dashboard's player pool or with `/auction` in Discord, and the card is
posted to `AUCTION_CHANNEL` either way. **Bids are dashboard-only**: the bidder is the signed-in
session, which has to own a captain, so a bid can never be placed as someone else. There is a
15-second countdown that resets on every accepted bid; whoever wins gets the player added to their
team and their purse debited.

## Commands

| Command | Who | What |
| --- | --- | --- |
| `/auction <userid> <seed> <startingprice> <maxprice>` | Admin | Start an auction in the current channel |
| `/auctioncancel` | Admin | Cancel the running auction and release held funds |
| `/setpurse <user> <amount>` | Admin | Set a purse balance |
| `/mypurse` | Anyone | Check your own balance |
| `/sysinfo` | Anyone | Runtime and dependency versions |

## Layout

```
app/          the dashboard - pages, components, the EN/DE dictionary, the theme
server/
  api/        the JSON API, one file per route
  bot/        the Discord client, its commands and the auction card
  routes/     the OAuth2 round-trips (Discord, then osu!)
  utils/      stores, osu! API, sheet import, auction state machine
shared/       the types both halves agree on
data/         purses.json, tournament.json, osu_links.json
```

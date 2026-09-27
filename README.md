# fugue — osu! tournament auction bot

A Discord bot and a live web dashboard for running an **auction-format osu! team tournament**, built
for [**Trinitas Proelium**](#built-for-trinitas-proelium) and used to run its auction.

Everything lives in one Node process: qualifier results are read straight from the osu! lobbies and
seeded by Z-sum, the organisers settle captains and the player pool, and the auction itself is
announced in Discord while captains bid and everyone follows along live in the dashboard.

- **Qualifiers** — lobbies are found and read automatically, results normalised and seeded by Z-sum,
  missing runs typed in by hand, CSV exports in the shape bracket tools expect.
- **Players** — registration and qualifier sheets imported from Google Sheets, osu! and Discord
  accounts looked up and linked, descriptions overridable, late entries added by hand.
- **Auction** — captains and stand-ins bid from the dashboard against a shared countdown, with every
  rule enforced on the server: raise steps, purses, reserves, team sizes, a second run at half price.
- **Organiser tools** — a random draw from the pool, a message broadcast to every open dashboard,
  and a live view of which captains are online.
- **English and German**, in a dark theme.

This is a Nuxt 4 / Nitro port of an earlier Kotlin (KordEx + Ktor) bot.

## Built for Trinitas Proelium

fugue was written for **Trinitas Proelium**, an osu! tournament whose teams are drafted at auction,
and ran its auction night. Its name and acronym are the defaults, and qualifier lobbies are found by
the naming scheme its referees used — both are configurable, so it works for any tournament that
drafts its teams the same way. See [Using it for another tournament](#using-it-for-another-tournament).

## Running it

It needs a Postgres database — seeding, rosters, the mappool, purses and osu! links all live there.
An empty one is enough; the schema is created at boot. Point `DATABASE_URL` at it, or set the usual
`PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` variables and leave it blank.

```bash
docker run -d --name fugue-postgres -p 5432:5432 \
  -e POSTGRES_USER=fugue -e POSTGRES_PASSWORD=fugue -e POSTGRES_DB=fugue postgres:17-alpine
```

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

A deploy is picked up by every open dashboard on its own: tabs reload onto the new build as soon as
they reconnect, and wait while someone has unsaved work open.

### Docker

Every push to `main` publishes `git.jansel.dev/jansel/fugue:latest`, plus a tag for the commit it was
built from. Publish the port and point it at a database:

```bash
docker run -p 8080:8080 --env-file .env git.jansel.dev/jansel/fugue:latest
```

The image listens on 8080 and keeps nothing of its own — `DATABASE_URL` has to reach a Postgres the
container can see, and without one it exits on boot rather than pretending to work. `PUBLIC_URL`
still has to name the address the outside world reaches, or both OAuth2 redirects will point at the
container.

### Dockge

[`compose.yaml`](compose.yaml) is a ready stack. Create one in Dockge, paste the file in, and fill
the values in its **Environment Variables** tab — Dockge writes them to a `.env` beside the compose
file, which is where every `${...}` in it reads from. `HOST_PORT` moves the published port without
touching anything else; the app always listens on 8080 inside the container.

Anything left blank degrades rather than crashes: no `TOKEN` runs the dashboard on its own, no osu!
credentials means no lookups, and the boot log names whichever is missing.

The stack brings its own Postgres and keeps it in `./pgdata` next to the compose file — back that up,
and never point two stacks at the same volume.

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
5. Set `AUCTION_CHANNEL` to the channel the auction card should be posted in.

Anyone can *read* the dashboard, with Discord IDs, purse balances and the sheet links stripped out.
Anyone in the guild sees the full picture; anyone with **Administrator** there is an organiser and can
change things.

Signing in is two steps: Discord, then osu!. The second one is what makes a captain's Discord link
trustworthy — purses and bids are keyed by Discord ID, while everything else is keyed by osu! ID. Set
`OSU_LINK_REQUIRED=false` to let people in without it.

## Using it for another tournament

| What | How |
| --- | --- |
| Name | `NUXT_PUBLIC_TOURNAMENT_NAME` — header, tab title, footer. Read at runtime, so a published image needs no rebuild. |
| Acronym | `NUXT_PUBLIC_TOURNAMENT_ACRONYM` — qualifier lobbies are found by the name `<ACRONYM>: (Qualifiers) vs (Lobby <ID>)`. |
| Logo | Replace `public/logo.png` (the mark, white on transparent) and `public/favicon.png`, then build — static files are served with their build-time size and ETag, so swapping one into a finished image does not work. |
| Rules | Team size, field cut, captain count, prices, raise steps and EZ multipliers are all set on the dashboard's **Setup** page. |

In `compose.yaml` the two variables are `TOURNAMENT_NAME` and `TOURNAMENT_ACRONYM`.

## Players

### Registration import

The registration list is its own sheet, with its own card on the Setup page, mapped onto player name,
osu! ID, Discord ID and player description. It merges instead of replacing: new sign-ups join at the
bottom of the seeding, players already on file get their name, Discord username and description
updated, and nobody is removed or reseeded.

The name column may carry the Discord username too — as `osuname @discordname` in the same cell, or
on a row of its own right under the name — and the `@` is what tells the two apart. Registration
sheets often have no header row, so the preview picks that column, and the one with the longest text
as the description, by what is in them. Each username is looked up among the members of `GUILD_ID`
for the user ID bids are keyed by; one that matches nobody is listed under **osu! links** as not on
the server, and signing in with osu! still links it. A Discord ID already on file is never replaced.

Imports run in the background — a long list takes minutes of osu! and Discord lookups — and report
their progress live.

### Qualifier import

Share the qualifier sheet as *anyone with the link can view* and paste its URL into the Setup page.
The dashboard reads the sheet's CSV export — no Google credentials involved — shows the columns it
found, and lets you map them onto player name, osu! ID, Discord ID, qualifier score and seed. This
import *replaces* the list, ordered by the seed column if there is one and by score otherwise.
Re-importing keeps manual Discord links, captain overrides, descriptions and anything already bought.

### By hand

Players can be added one at a time by osu! username or ID — a late entry — and removed; a removed
player stays removed through every later import until restored. An organiser can override a player's
description, or blank it, without touching the sheet's text underneath.

## Qualifier results and Z-sum seeding

Results come from the lobbies themselves. The osu! match history is scanned every minute for lobbies
named `<ACRONYM>: (Qualifiers) vs (Lobby <ID>)`; each one found is read again every minute while it
is open and once more when it closes, and every score set in it is kept. A lobby named differently,
or opened while the dashboard was down for longer than it looks back, can be added by its osu! match
link at the bottom of the **Mappool** page.

Only maps in the qualifier pool count: a game is matched to a slot by beatmap ID, so warm-ups are
ignored, and each player's best score on a map is the one that counts. A slot no lobby has played yet
reads from the qualifier-sheet column it is bound to, and an organiser can type a score into any cell
for a run osu! has no usable record of.

Every score is shown as it would have been worth at **1×**: osu!'s own mod multipliers (HD, HR, DT…)
are divided back out, so numbers compare across slots. EZ is the exception, since what it is worth is
the tournament's call — the **EZ** and **EZHD** rates in the Setup page's multiplier table apply.

Seeding follows the [Z-sum](https://osu.ppy.sh/wiki/en/Tournaments/Common_seeding_methods#z-sum):
on every map, a player's score is expressed as the number of sample standard deviations above or
below the mean across everyone with a qualifier result (a map not played counts as zero), and those
are added up. Ties go to the higher raw total. While the seeding is unlocked it is reordered on every
change to the results; lock it to freeze it, and **Reseed by Z-sum** puts a hand-edited order back.

**Scores** and **Maps** CSV exports write the qualifier results in the shape bracket tools read.

## Captains, pool and teams

A field cut can limit the auction to the top N qualifiers. The number of captains follows the field:
`players ÷ team size`, rounded down, so 34 players in teams of 4 gives 8 captains and 26 in the pool.
You can pin the count instead. The top seeds become captains automatically; drag rows to reorder the
seeding, or mark a player **Captain** or **Never** to override the cut-off wherever they sit.

Each team can have a **stand-in**: a Discord account that bids for the captain from the captain's
purse, for a captain who can't be there on the night.

## Mappool

The pool is usually published as its own sheet, often with every round stacked in one document, so
the import takes a round name and a row range and replaces only that round. It supplies slot names
and beatmap IDs; star ratings and difficulty settings are shown with the slot's mods applied — a DT
slot at its DT rating — and mods are taken from the slot name (`HD2` → HD) unless you say otherwise.

## Auction

An organiser puts a player up from the **Pool** page — a chosen one, or a **random** player from
those still open — or with `/auction` in Discord. The card is posted to `AUCTION_CHANNEL` either way.

- **Bids are dashboard-only.** The bidder is the signed-in session, which has to be a captain or a
  team's stand-in, so a bid can never be placed as someone else. Enter in the amount box bids.
- The player is shown for **3 seconds** before bids open, so the whole room sees who is up first.
- Bidding then runs for **20 seconds**. A bid does not restart the clock; one placed with less than
  10 seconds left puts it back up to 10. A bid at the maximum price ends the auction at once.
- Every rule is checked on the server: the opening bid meets the starting price, each raise sits
  inside the tournament's minimum and maximum step, the purse covers it, and enough is left to fill
  the team to its smallest legal size. Countdowns run on the server's clock, whatever the viewer's
  own clock says.
- The winning team gets the player and the purse is debited; a banner on every dashboard says who
  went where, or that nobody bid.
- A player **nobody bid on** can't be put up again in the same run. The **second run** (a switch on
  the Pool page) offers the leftovers again at half the starting price, with the minimum raise capped
  at 50. **Release** puts a player passed over by mistake back into the current run.

### Organiser tools

- **Broadcast** — the megaphone in the header sends a message to every open dashboard: until each
  viewer closes it, or for a set number of seconds. It survives refreshes and restarts, and can be
  taken down for everyone.
- **Who is online** — the Teams and Pool pages show how many teams have their captain or stand-in on
  the dashboard right now, and which don't.

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
  utils/      stores, the schema, osu! API, sheet import, auction state machine
shared/       the types both halves agree on
```

`pnpm lint`, `pnpm typecheck` and `pnpm build` are the checks CI runs; there is no test suite.

## Upgrading from the JSON stores

Earlier versions kept `purses.json`, `tournament.json` and `osu_links.json` in `DATA_DIR`. Set
`DATABASE_URL` to an empty database, leave `DATA_DIR` pointing at the old directory, and start: the
files are read once, written to Postgres, and the log says what came across. Nothing is written back
to them, so the directory stays as a fallback and can be dropped once the dashboard looks right.

## License

[MIT](LICENSE) © Jannik Reimers. Source Serif 4 is bundled under the
[SIL Open Font License](public/fonts/OFL.txt). The Trinitas Proelium logo in `public/` belongs to the
tournament.

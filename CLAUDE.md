# CLAUDE.md

## Build & verify

There is no test suite. `pnpm lint`, `pnpm typecheck` and `pnpm build` are the verification steps, and
CI runs all three. Follow `.editorconfig` (2 spaces) and the ESLint stylistic config in
`nuxt.config.ts` (no trailing commas, 1tbs) — `pnpm lint --fix` settles most of it.

Local run needs a `.env` (copy `.env.example`). Nuxt loads it in development; the built server does
not, which is why `pnpm start` passes `--env-file-if-exists=.env`.

This is a port of a Kotlin (KordEx + Ktor) bot. The three JSON files in `data/` have exactly the
shapes the Kotlin version wrote, so any change to `shared/types.ts` that renames or drops a persisted
field breaks existing deployments.

## Gotchas

- `server/utils/json-store.ts` is the only thing that touches disk. Writes go through a promise
  chain, not a mutex: what has to be prevented is two overlapping *writes* to one file, and the chain
  does that by never starting one before the last finished. Each write lands on a temp file and is
  renamed into place.
- `server/utils/purse-store.ts` is the single source of truth for balances. Never track them
  elsewhere. Balances are persisted; **holds are not** — a hold only means anything while an auction
  is running, and an auction does not survive a restart either.
- `server/utils/tournament-store.ts` is the equivalent for players, seeding, captains and rosters.
  Seeding order *is* the list order in `players`; captains, the pool and team slots are all derived
  (`tournament-model.ts`), never stored, so they can't drift.
- The mappool stores **no scores**. Each slot names the sheet column its scores live in
  (`mappool.score_column`), and the values stay in `players.extra` where the import left them;
  per-map score and map rank are derived on every dashboard build. So re-pointing a slot at another
  column, or re-importing the sheet, needs no migration. `POST /api/mappool` replaces the pool wholesale and fills in beatmap
  metadata, skipping slots whose beatmap ID *and* mods have not changed. `POST /api/mappool/refresh`
  re-asks about every slot regardless.
- `QualifierMap.stars` is the rating **with the slot's mods applied**. Mods default to whatever the
  slot name implies (`mods.ts`, `modsFromSlotLabel`: `DT1` → DT, `NM`/`FM`/`TB` → none, an
  unparseable name → none). `GET /beatmaps/{id}` only ever answers the *plain* rating, so anything
  modded is re-rated through `POST /beatmaps/{id}/attributes` — a second request, taken for every
  slot whose mask is non-empty, because HD and TD move the number too in the current calculator.
  `difficultyMask()` still cuts the mask down to `EZ/TD/HD/HR/DT/HT/FL` first: asked about a
  contradictory pair (EZ+HR, DT+HT) the endpoint answers a `star_rating` of **zero**, not an error,
  and that zero is read back as "unknown".
- The star rating is the **only** thing the API adjusts — CS/AR/OD/HP/BPM/length come back raw
  whatever `mods` is asked for, so `difficulty.ts` (`withMods`) adjusts them on the way in. HR/EZ
  scale the *settings* and cap at 10, the way the game does; DT/HT change the *clock*, which is why
  AR and OD still legitimately read above 10 after a cap and why CS and HP don't move at all. The two
  apply in that order, so HRDT caps AR at 10 first and the rate then carries it to 11.
- The mappool has **its own sheet**, separate from the qualifier results, previewed through the
  shared `/api/sheet/preview`. It supplies slot names and beatmap IDs only — scores still come from
  the qualifier sheet, so on import each slot is bound to the qualifier column named after it (`NM1`
  → `NM1`/`NM1 Score`) unless the pool sheet names one. Bindings made by hand survive a re-import,
  matched by slot name. All rounds commonly share one sheet, so an import takes a round name and a
  row range and replaces **only that round**.
- The auction's rules are configuration, not constants: `fieldSize` (only the top N take part),
  `teamSize`/`minTeamSize` (largest and smallest legal team, captain included),
  `minBidIncrement`/`maxBidIncrement` and `secondRun`. The neutral defaults - no field cut, no
  reserve, no ceiling on a raise - leave a tournament that predates them behaving as it did.
  `field()` in `tournament-model.ts` is what every derivation starts from, so a qualifier below the
  cut keeps their seed and results but is out of the captain count, the pool and the auction.
- Every rule a bid has to pass lives in `submitBid`, not in the route: team not yet full, inside the
  min/max step (measured from the starting price for an opening bid, from the standing bid after
  that), affordable, and still leaving `reserveFor()` - what the captain needs to fill their roster
  to `minTeamSize` at the starting price. Affordability is checked before the reserve so a captain
  who is simply out of gold is not sent looking for the wrong rule.
- One auction exists system-wide, owned by `server/utils/auction.ts`. Both the slash command and the
  dashboard call into it, and it posts and edits the auction card itself. Everything that touches the
  auction goes through `withLock` — settling a purse and recording a sale both `await`, and a bid
  arriving in that window would otherwise see a half-ended auction.
- **Bids are dashboard-only** (`POST /api/auction/bid`). Discord no longer accepts them. That
  endpoint is the one non-admin write in the API: it takes the bidder from the session and requires
  that Discord account to own a captain, so a bid can never be placed as someone else.
- The Discord auction card is a hand-built Components V2 payload (`server/bot/client.ts`), sent
  through `client.rest` rather than the builders, so the same object serves the initial post and every
  bid update.
- Everything osu! goes through **API v2** on one credential, `OSU_CLIENT_ID`/`OSU_CLIENT_SECRET`.
  `utils/osu-oauth.ts` uses it as an authorization-code flow to sign users in; `utils/osu-api.ts`
  uses it as a client-credentials grant (`public` scope) for player and beatmap lookups, caching the
  app token until it lapses and sharing one in-flight request between concurrent callers. There is no
  legacy v1 key. `osuApiReady()` is the guard every lookup site checks; a failed lookup returns `null`
  and callers keep whatever was already on file.
- Dashboard login is two steps: Discord (`routes/callback.get.ts`) then osu!
  (`routes/osu/callback.get.ts`). `osu-link-store.ts` owns the Discord ID → osu! account mapping and
  is what makes a player's `discordId` "verified"; linking also writes that Discord ID onto the
  matching player. `requireSession` refuses an unlinked session while `OSU_LINK_REQUIRED` is on and
  the OAuth app is configured.
- `server/bot/client.ts` hands the Discord client to code outside the bot — it is null until the bot
  connects, and the dashboard is up long before that. Everything that needs Discord copes with null.
- The dashboard holds **no state of its own**: the server pushes a full `DashboardState` over SSE
  (`/api/events`) on every change and the client re-renders from it. The one exception is the mappool
  editor, which keeps an unsaved draft that renders instead of the pushed pool until it is saved or
  discarded.
- The dashboard is **English and German**, translated in the browser by `app/composables/useLang.ts`.
  The server does not translate what the page shows: API responses, tournament warnings and auction
  rejections carry a dictionary `code` plus args *alongside* English prose, and the client shows the
  translation or falls back to the prose for a code it doesn't know. **Adding a user-facing string
  means adding it to both `en` and `de`.** The exceptions are the login and osu!-link notices, which
  the server renders (`server/utils/notice.ts`, `lang.ts`), driven by the `ba_lang` cookie the
  dashboard writes and falling back to `Accept-Language`. Discord-facing text is not translated.
- The interface is **dark only** (`colorMode.preference: 'dark'`). The palette — oxblood `ember`, old
  gold `gold`, umber neutrals — is defined in `app/assets/css/main.css` and wired up in
  `app/app.config.ts`. A light variant would be a different design, not a toggle.
- Two typefaces, both declared in `app/assets/css/main.css`. `--font-sans` is a system stack and
  stays one. `--font-display` — every heading, price, seed and countdown — is **Source Serif 4,
  self-hosted**: the latin-subset `woff2` files are checked into `public/fonts` (licence beside
  them) rather than fetched by `@nuxt/fonts` at build time, so an image build needs no network
  beyond the registry and the URL is stable enough for `server/utils/notice.ts` to name it. That
  module gets no build assets, so its palette *and* its two font stacks are hand-copied and have to
  be changed in step with `main.css`. The subset keeps its `tnum` feature, which is what makes the
  `.tnum` class line money up in a column.
- `app/error.vue` is the 404 and the crash screen. Without it Nuxt serves its own built-in pages,
  which are Nuxt-branded and carry font stacks belonging to nothing else here. It reads no dashboard
  state on purpose — failing to load that state is one of the ways people arrive there.
- `USelect` refuses an empty string as an option value, so options meaning "no column" or "all
  rounds" use the sentinels in `app/utils/select.ts` and convert back to `null` on the way out.

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
- There are two player imports, off **two different sheets**, each with its own card and its own
  `sheet_config` row. `POST /api/sheet/import` reads the qualifier sheet and *replaces* the list
  (seeded by the sheet); `POST /api/sheet/register` reads the registration sheet and *merges*
  (`mergeRegistrations`): it appends new sign-ups, updates name/Discord/pp/description on players
  already on file and removes nobody. Only the registration sheet has a description column. Its
  name column may hold `osuname @discordname` (`splitDiscordHandle`); the username is stored as
  `discordUsername` and resolved to an ID by exact match in the guild (`discord-users.ts`). The
  merge only *fills* a missing `discordId`, never replaces one - it may be a verified link. Both
  match existing players by osu! ID and then by name, since an unenriched import only has a `name:`
  placeholder. A `description` of `undefined` from `toPlayers` means "no column mapped - keep the
  one on file"; `null` means the cell was blank.
- A player **removed by hand** (`POST /api/players/remove`) is kept whole in
  `TournamentState.removedPlayers` (table `removed_players`), and both imports skip anyone who
  matches one by osu! ID or name - otherwise the next sheet import would bring staff straight back.
  Restoring puts them back at the bottom of the seeding. Their lobby scores stay on file and simply
  match no player while they are removed. `POST /api/players/add` is the way in for one person - a
  late entry, or a field to try something on without a sheet: the osu! lookup gives them their ID,
  name and country, they go to the bottom, and being added takes them off `removedPlayers`. Like
  every other list change it is refused while `seedingLocked`.
- Player imports **run in the background** (`startImport` in `import-progress.ts`). A full
  registration list takes minutes of osu! and Discord lookups, far past a reverse proxy's timeout (a
  504), so the route reads and checks the sheet, answers `ok.importStarted`, and the rest reports
  through `importProgress` and `importOutcome` over SSE. One import at a time; a second gets a 409.
- The mappool stores **no scores**. Results are derived on every dashboard build
  (`qualifierResults` in `tournament-model.ts`), per slot from the first of two sources - and over
  the top of both, per *cell*, whatever an organiser typed in (`manual-score-store.ts`, table
  `manual_scores`, `POST /api/scores/set`): a disconnect early enough submits nothing, or something
  worse than nothing, and no amount of re-reading the lobby will fix either. A typed-in score is
  kept as osu! would have reported it, mods and all, so it normalises like a read one. The two
  sources are: the raw
  lobby scores in `lobby_scores` (`lobby-store.ts`), matched to the slot by **beatmap ID** among the
  qualifier slots (`qualifierMaps`: the round named `/qualif/i`, or the whole pool when none is),
  taking each player's **best** game on it; and failing any, the sheet column the slot names
  (`mappool.score_column`), whose values stay in `players.extra`. A player on a `name:` placeholder
  is matched to lobby scores by username. So re-pointing a slot, re-importing the sheet or importing
  players after their lobby needs nothing re-read. A lobby score keeps the player's **own** mods
  (`own_mods`: score mods minus the game's minus NF), which is all the results *show* - a slot's own
  mods go without saying. What a score is *worth* goes through `modMultiplier` first, on **every**
  slot and off the whole combination it was played with (`mods`), so everything on the dashboard and
  in the exports is the score the play would have been worth at **1x**. That is two rules either side
  of EZ. An EZ run - `EZ` or `EZHD` once `normalizeMods` has kept the EZ and HD bits and dropped the
  rest - takes the tournament's own rate out of `tournament_settings.mod_multipliers`, since what EZ
  is worth is a rule only organisers can settle, and those two are the only keys that do anything.
  Every other combination is **normalised**: osu! itself already paid HD 1.06, HR 1.1, HDHR 1.17 and
  DT 1.2 (`OSU_MULTIPLIERS` in `mods.ts` - fixed, not configurable, and the tournament's own figures
  rather than a product of the single mods), so the factor is the *reciprocal* of that. `scoringMods`
  drops NF, SD and the rest first, which would otherwise spell a key no table knows. A combination
  with no figure on file, FL among them, divides by 1. Normalising a forced-mod slot changes no Z
  score - the same factor over the whole field cancels - but it is what makes the numbers themselves
  comparable between slots. Rows written before `own_mods` existed are NULL, and `loadLobbies` clears
  the watermark of their lobbies so they are read again once.
- **Seeding follows the Z-sum** (`seedingByZSum`): per qualifier slot, `(score − mean) / sample sd`
  over the field of everyone with at least one result, an unplayed map counting as 0; ties go to the
  raw total, then to the current order. `qualifier-lobbies.ts` calls `reseedByZSum` after every
  change to lobby scores **unless `seedingLocked`** - the lock is the only thing that stops the
  seeding moving under an organiser's hands. `POST /api/seeding/reseed` does the same on demand.
- `qualifier-lobbies.ts` scans the match history every minute for lobbies named
  `TP: (Qualifiers) vs (Lobby <ID>)`, back to the newest match already seen - one page a minute once
  running, and at most `MAX_PAGES` (a few hours of history) on a cold start, which is why a lobby from
  further back has to be added by link. It reads each open lobby every minute and once more when it
  closes, paging
  `GET /matches/{id}` backwards (`before=`) until an event at or below the lobby's `latest_event_id`
  turns up. That watermark is the newest *settled* event, held back to just before a game still in
  progress, so a game that finishes later is still picked up. Lobbies and scores are persisted;
  a lobby with `latest_event_id` null is read once whatever its age, which is how one added by
  link (`POST /api/lobbies/add`) or found already closed gets its scores. `POST /api/lobbies/refresh`
  (`rereadLobbies`) reads every lobby again from its first event - for scores that were read before
  the way they are read changed, which is the one thing a later poll can never go back far enough to
  fix. It is *not* how a scoring rule is applied: multipliers are worked out on every dashboard build
  from the mods on file. The poll and a re-read share one queue (`reads`), so they never page through
  the same lobby at once. The store never emits a change: the watcher reseeds first and emits once,
  so results and seeding never disagree on screen.
- The two **CSV exports** (`server/utils/seeding-export.ts`, `GET /api/export/scores.csv` and
  `/api/export/maps.csv`, both admin-only) write the qualifier pool in the shape a bracket tool
  reads, not the shape the dashboard shows. Solo qualifiers, so every row is a team of one and the
  size column is always 1. `scores.csv` is everyone who played the qualifiers - the field cut decides
  who is bought, not who set a score - minus anyone with no result at all; the
  overall seed is the *list order* renumbered 1..N, while the mod-bracket seeds (slots grouped by the
  letters their label starts with) and the per-map seeds are ranks worked out there and then, an
  unplayed map counting as 0. Flags are the one thing nothing else needs, so `players.country_code`
  is filled by enrichment and, for whoever is still missing one, by the export itself
  (`fetchCountryCodes`, fifty IDs a request); a lookup that fails just writes a blank flag.
- `POST /api/mappool` replaces the pool wholesale and fills in beatmap
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
  cut keeps their seed and results but is out of the captain count, the pool and the auction. The one
  exception is a **`FORCE` captain**, picked off the whole list rather than off the field: someone
  with no qualifier result has no Z-sum and is reseeded to the bottom, and a cut would otherwise take
  their captaincy away again. `AUTO` captains still come out of the field.
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

# Wincon

**Find your win condition.** A personal ranked review tool for League of
Legends: it pulls your recent ranked games from the Riot API and tells you
**why** you lost, not just that you did.

Most stat sites answer "what happened" with a wall of numbers. Wincon is built
around the question a coach would ask: *what pattern in these twenty games is
keeping you stuck?* It reads the Match-V5 timeline (per-minute frames and
events, not just end-of-game totals) and turns it into a small set of pointed,
opinionated coaching notes:

- **Laning**: CS / gold / XP differences vs your actual lane opponent at 10:00
  and 14:00, not raw totals.
- **Deaths**: every death mapped by game phase and map position, including the
  overextension tell (early deaths on the enemy's side of the river).
- **Objectives**: how often you're actually credited when your team takes
  dragons, heralds, and barons.
- **Wins vs losses**: which measurable habit differs most between your wins and
  your losses.
- **Replay**: any game replays on an animated map, all ten champions moving
  along their timeline positions with kill and objective pings, and the replay
  auto-pauses at coaching moments (your deaths with context, objectives taken
  without you, the 10:00 laning checkpoint) to tell you what just happened.

## How it works

```
sync (Riot API -> disk)  ->  analyze (pure functions -> report.json)  ->  dev (React viewer)
```

Local-first, no database, no backend service. `sync` caches raw match +
timeline JSON to `data/` (matches are immutable, so nothing is ever fetched
twice). `analyze` runs the analysis layer over the cache and writes a single
`report.json`. The Vite dev server serves that file to a React dashboard.

The analysis layer is pure TypeScript functions over typed Riot API subsets,
shared by the CLI and the UI, and unit tested against handcrafted timeline
fixtures (see `test/`). A seeded synthetic-data generator powers both the demo
mode and an integration test, so the whole pipeline runs and renders without an
API key.

## Running it

```
npm install
npm run demo     # synthetic sample data, no API key needed
npm run dev      # open the dashboard
```

With real games (yours or anyone's; players are not hardcoded, and each synced
player gets a directory under `data/players/` plus an entry in the dashboard's
player switcher):

```
cp .env.example .env             # add your key from developer.riotgames.com
npm run sync -- "YourName#NA1"   # pull recent ranked games (cached per player)
npm run analyze                  # build the report and print the coaching notes
npm run dev
```

`npm test` runs the analysis test suite; `npm run typecheck` runs strict tsc.

### Portfolio build

The hosted demo bundles an anonymized showcase match, seeded history, and all
replay timelines as static files. Riot IDs, PUUIDs, summoner IDs, original
match IDs, and API keys are not included.

```sh
WINCON_STATIC_DEMO=true WINCON_BASE=/wincon/ npm run build
```

The generated `dist/` directory can be served from `/wincon/` on any static
host.

## Design notes

- **Rate limiting is client-side and proactive.** Development keys allow
  20 req/s and 100 req/2min; the client throttles under both windows and still
  honors `Retry-After` on any 429 that slips through.
- **Benchmarks are honest heuristics.** Per-role targets (CS at 10, vision per
  minute) are opinionated coaching thresholds defined in one file, not scraped
  percentiles. Replacing them with cohort data sampled from the ranked ladder
  is on the roadmap.
- **Objective credit is a floor, not a truth.** Timeline credit misses "nearby
  but untagged" participation; the report says so rather than pretending
  precision it doesn't have.
- **Charts follow a validated palette.** Colorblind-safe categorical colors
  (checked with a CVD simulation validator in both light and dark mode),
  win/loss identity never carried by color alone, and the match table doubles
  as the accessible data view.

## Roadmap

- Cohort benchmarks sampled from the ranked ladder (league-v4 + match sampling)
- Champion-pool and matchup-specific notes once the sample is large enough
- League Client (LCU) integration: pull the live champ select and show your own
  history on the hovered pick
- Riot production API key so a hosted version can serve other players

## Legal

Wincon is a personal project. It isn't endorsed by Riot Games and doesn't
reflect the views or opinions of Riot Games or anyone officially involved in
producing or managing League of Legends. League of Legends and Riot Games are
trademarks or registered trademarks of Riot Games, Inc.

## Hosting

In development, `/api/sync` and the data routes are Vite plugins in
`vite.config.ts`, so **a built site has neither**. `src/server/serve.ts` is the
same behaviour as a standalone Node process:

```bash
npm run build     # build the client into dist/
npm run serve     # serve dist/ + data/ + POST /api/sync on :8080
```

### Deploying

`dist/` and `server.js` are committed on purpose. The host container is small,
and running `tsc` plus `vite build` inside it risks an out-of-memory kill on
every restart, so the build happens on your machine and the container only runs
a single self-contained file. Deploying is therefore:

```bash
npm run build:all      # client into dist/, server bundled into server.js
git commit -am "..."   # ship the artifacts with the source
git push
```

Then pull and restart on the host. `server.js` needs no dependencies at all,
not even tsx, so the container can run `node server.js` with an empty
node_modules.


The one hard requirement is a **persistent disk**. The sync writes match and
timeline JSON to disk, and those responses are immutable, so a platform with an
ephemeral filesystem re-fetches everything on every cold start and burns the
Riot rate limit for nothing. That rules out Vercel and Netlify functions. Fly.io,
Railway and Render all work.

1. Create the app on your host and attach a volume mounted at `/data`.
2. Set `RIOT_API_KEY` as a platform **secret**. It is never baked into the image.
3. Deploy. The Dockerfile is host-agnostic.

Order matters: Riot's product registration needs a publicly reachable URL, so
the app has to be hosted **before** you can apply for a personal key. Until the
key is approved the site still serves whatever is already cached, which is the
state it ships in.

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `RIOT_API_KEY` | none | Riot key. Without it, lookups fail and cached data still serves. |
| `PORT` | `8080` | Listen port. |
| `WINCON_DATA_DIR` | `./data` | Cache location. Point at the mounted volume. |
| `WINCON_DIST` | `./dist` | Built client. |
| `WINCON_MAX_PLAYERS` | `12` | Cached players kept on disk. Oldest are evicted beyond this. |
| `WINCON_KEEP_SLUGS` | `koda-10101` | Never evicted, so the showcase player always resolves. |
| `WINCON_SYNCS_PER_HOUR` | `4` | Per-IP limit. Only real lookups count; a malformed Riot ID is free. |

The endpoint is public, so it is rate limited per IP, runs one sync at a time,
and caps how many players are kept on disk. Cached matches are immutable, so
eviction only ever costs a re-sync.


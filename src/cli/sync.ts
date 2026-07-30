// Pull recent ranked games and build the report for one player. Cached
// matches are never re-fetched, so re-running only costs API calls for games
// it hasn't seen yet.
//
//   npm run sync                      (RIOT_ID from .env)
//   npm run sync -- "SomeName#NA1"    (any player)

import { syncAndAnalyze } from '../server/syncPlayer'
import { loadEnv, requireEnv, riotIdArg } from './env'

loadEnv()
const riotId = riotIdArg() ?? requireEnv('RIOT_ID', 'Set RIOT_ID in .env, or pass one: npm run sync -- "Name#TAG"')

try {
  const result = await syncAndAnalyze(riotId, message => console.log(message))
  console.log(`Done: ${result.fetched} new, ${result.cached} cached, report covers ${result.games} games.`)
  console.log('Next: npm run dev')
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}

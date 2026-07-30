// Pull recent ranked games to disk. Cached matches are never re-fetched, so
// re-running sync only costs API calls for games it hasn't seen yet.
//
//   npm run sync                      (RIOT_ID from .env)
//   npm run sync -- "SomeName#NA1"    (any player)

import fs from 'node:fs'
import path from 'node:path'
import { RiotClient } from '../riot/client'
import { accountByRiotId, getMatch, getTimeline, rankedMatchIds } from '../riot/api'
import { loadEnv, matchDir, migrateLegacyLayout, playerDir, requireEnv, riotIdArg, slugify, writePlayersIndex } from './env'

loadEnv()
migrateLegacyLayout()

const apiKey = requireEnv('RIOT_API_KEY', 'Copy .env.example to .env and add your key from developer.riotgames.com')
const riotId = riotIdArg() ?? requireEnv('RIOT_ID', 'Set RIOT_ID in .env, or pass one: npm run sync -- "Name#TAG"')
const region = process.env.REGION ?? 'americas'
const count = Number(process.env.COUNT ?? 40)
const queue = Number(process.env.QUEUE ?? 420)

const [gameName, tagLine] = riotId.split('#')
if (!gameName || !tagLine) {
  console.error(`Riot ID must look like YourName#NA1, got "${riotId}"`)
  process.exit(1)
}

const client = new RiotClient(apiKey)

console.log(`Looking up ${gameName}#${tagLine} (${region})...`)
const account = await accountByRiotId(client, region, gameName, tagLine)
const slug = slugify(account.gameName, account.tagLine)

fs.mkdirSync(matchDir(slug), { recursive: true })
fs.writeFileSync(
  path.join(playerDir(slug), 'player.json'),
  JSON.stringify({ puuid: account.puuid, gameName: account.gameName, tagLine: account.tagLine, region }, null, 2),
)

const ids = await rankedMatchIds(client, region, account.puuid, count, queue)
console.log(`Found ${ids.length} ranked games (queue ${queue}).`)

let fetched = 0
let cached = 0
for (const id of ids) {
  const file = path.join(matchDir(slug), `${id}.json`)
  if (fs.existsSync(file)) {
    cached++
    continue
  }
  const [match, timeline] = [await getMatch(client, region, id), await getTimeline(client, region, id)]
  fs.writeFileSync(file, JSON.stringify({ match, timeline }))
  fetched++
  process.stdout.write(`\r${fetched} fetched, ${cached} already cached`)
}

writePlayersIndex()
console.log(`\nDone: ${fetched} new, ${cached} cached. Next: npm run analyze -- "${account.gameName}#${account.tagLine}"`)

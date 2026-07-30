// Sync + analyze for one player, shared by the CLI (npm run sync) and the
// dev server's /api/sync endpoint (the in-app player lookup). Node-only.

import fs from 'node:fs'
import path from 'node:path'
import { RiotClient } from '../riot/client'
import { accountByRiotId, getMatch, getTimeline, rankedMatchIds } from '../riot/api'
import { buildClimbReport } from '../analysis/report'
import {
  loadEnv,
  matchDir,
  migrateLegacyLayout,
  playerDir,
  slugify,
  writePlayersIndex,
} from '../cli/env'

export interface SyncResult {
  slug: string
  gameName: string
  tagLine: string
  games: number
  fetched: number
  cached: number
}

export async function syncAndAnalyze(
  riotId: string,
  onProgress?: (message: string) => void,
): Promise<SyncResult> {
  loadEnv()
  migrateLegacyLayout()

  const apiKey = process.env.RIOT_API_KEY
  if (!apiKey) throw new Error('RIOT_API_KEY is missing. Add a key from developer.riotgames.com to .env')
  const region = process.env.REGION ?? 'americas'
  const count = Number(process.env.COUNT ?? 40)
  const queue = Number(process.env.QUEUE ?? 420)

  const [gameName, tagLine] = riotId.split('#')
  if (!gameName || !tagLine) throw new Error('Riot ID must look like Name#TAG')

  const client = new RiotClient(apiKey)
  onProgress?.(`Looking up ${gameName}#${tagLine} (${region})...`)
  let account
  try {
    account = await accountByRiotId(client, region, gameName, tagLine)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes(' 404 ')) throw new Error(`No player named ${gameName}#${tagLine} in ${region}`)
    if (message.includes(' 401 ') || message.includes(' 403 ')) {
      throw new Error('Riot API key rejected. Dev keys expire daily; paste a fresh one into .env')
    }
    throw err
  }

  const slug = slugify(account.gameName, account.tagLine)
  fs.mkdirSync(matchDir(slug), { recursive: true })
  fs.writeFileSync(
    path.join(playerDir(slug), 'player.json'),
    JSON.stringify({ puuid: account.puuid, gameName: account.gameName, tagLine: account.tagLine, region }, null, 2),
  )

  const ids = await rankedMatchIds(client, region, account.puuid, count, queue)
  onProgress?.(`Found ${ids.length} ranked games (queue ${queue}).`)

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
    onProgress?.(`${fetched} fetched, ${cached} cached`)
  }

  const entries = fs
    .readdirSync(matchDir(slug))
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(matchDir(slug), f), 'utf8')))
  const report = buildClimbReport(
    entries,
    { puuid: account.puuid, gameName: account.gameName, tagLine: account.tagLine, region },
    { isDemo: false, generatedAt: new Date().toISOString() },
  )
  fs.writeFileSync(path.join(playerDir(slug), 'report.json'), JSON.stringify(report, null, 2))
  writePlayersIndex()

  return {
    slug,
    gameName: account.gameName,
    tagLine: account.tagLine,
    games: report.matches.length,
    fetched,
    cached,
  }
}

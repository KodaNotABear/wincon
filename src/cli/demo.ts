// Generate a synthetic-but-believable player so the UI (including replay)
// runs with no API key.
//
//   npm run demo

import fs from 'node:fs'
import path from 'node:path'
import { buildClimbReport } from '../analysis/report'
import { DEMO_PLAYER, generateDataset } from '../fixtures/synthetic'
import { matchDir, playerDir, slugify, writePlayersIndex } from './env'

const slug = slugify(DEMO_PLAYER.gameName, DEMO_PLAYER.tagLine)
const entries = generateDataset(7, 24)
const report = buildClimbReport(entries, DEMO_PLAYER, {
  isDemo: true,
  generatedAt: new Date().toISOString(),
})

fs.mkdirSync(matchDir(slug), { recursive: true })
fs.writeFileSync(path.join(playerDir(slug), 'player.json'), JSON.stringify(DEMO_PLAYER, null, 2))
// Raw match files too, so replay works on demo data.
for (const entry of entries) {
  fs.writeFileSync(path.join(matchDir(slug), `${entry.match.metadata.matchId}.json`), JSON.stringify(entry))
}
fs.writeFileSync(path.join(playerDir(slug), 'report.json'), JSON.stringify(report, null, 2))
writePlayersIndex()

console.log(`Demo player written: ${report.aggregate.games} games, ${report.insights.length} insights.`)
console.log('Next: npm run dev')

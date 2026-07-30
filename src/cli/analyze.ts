// Build data/report.json from the synced matches.
//
//   npm run analyze

import fs from 'node:fs'
import path from 'node:path'
import { buildClimbReport, type PlayerInfo } from '../analysis/report'
import { DATA_DIR, MATCH_DIR } from './env'

const playerFile = path.join(DATA_DIR, 'player.json')
if (!fs.existsSync(playerFile)) {
  console.error('No synced data found. Run `npm run sync` first (or `npm run demo` for sample data).')
  process.exit(1)
}
const player = JSON.parse(fs.readFileSync(playerFile, 'utf8')) as PlayerInfo

const entries = fs
  .readdirSync(MATCH_DIR)
  .filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(MATCH_DIR, f), 'utf8')))

const report = buildClimbReport(entries, player, {
  isDemo: false,
  generatedAt: new Date().toISOString(),
})

fs.writeFileSync(path.join(DATA_DIR, 'report.json'), JSON.stringify(report, null, 2))

const { aggregate: agg } = report
console.log(`\n${player.gameName}#${player.tagLine} — ${agg.games} games, ${(agg.winrate * 100).toFixed(0)}% winrate`)
for (const insight of report.insights) {
  console.log(`\n[${insight.severity.toUpperCase()}] ${insight.title}\n  ${insight.detail}`)
}
console.log('\nReport written to data/report.json. Next: npm run dev')

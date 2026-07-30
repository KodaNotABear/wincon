// Build report.json for a synced player.
//
//   npm run analyze                     (sole or most recent player)
//   npm run analyze -- "SomeName#NA1"

import fs from 'node:fs'
import path from 'node:path'
import { buildClimbReport, type PlayerInfo } from '../analysis/report'
import { defaultSlug, matchDir, migrateLegacyLayout, playerDir, riotIdArg, slugify, writePlayersIndex } from './env'

migrateLegacyLayout()

const arg = riotIdArg()
const slug = arg ? slugify(...(arg.split('#') as [string, string])) : defaultSlug()
if (!slug || !fs.existsSync(path.join(playerDir(slug), 'player.json'))) {
  console.error('No synced data found. Run `npm run sync` first (or `npm run demo` for sample data).')
  process.exit(1)
}
const player = JSON.parse(fs.readFileSync(path.join(playerDir(slug), 'player.json'), 'utf8')) as PlayerInfo

const entries = fs
  .readdirSync(matchDir(slug))
  .filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(matchDir(slug), f), 'utf8')))

const report = buildClimbReport(entries, player, {
  isDemo: false,
  generatedAt: new Date().toISOString(),
})

fs.writeFileSync(path.join(playerDir(slug), 'report.json'), JSON.stringify(report, null, 2))
writePlayersIndex()

const { aggregate: agg } = report
console.log(`\n${player.gameName}#${player.tagLine} — ${agg.games} games, ${(agg.winrate * 100).toFixed(0)}% winrate`)
for (const insight of report.insights) {
  console.log(`\n[${insight.severity.toUpperCase()}] ${insight.title}\n  ${insight.detail}`)
}
console.log('\nReport written. Next: npm run dev')

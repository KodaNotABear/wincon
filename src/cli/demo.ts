// Generate a synthetic-but-believable report so the UI runs with no API key.
//
//   npm run demo

import fs from 'node:fs'
import path from 'node:path'
import { buildClimbReport } from '../analysis/report'
import { DEMO_PLAYER, generateDataset } from '../fixtures/synthetic'
import { DATA_DIR } from './env'

const entries = generateDataset(7, 24)
const report = buildClimbReport(entries, DEMO_PLAYER, {
  isDemo: true,
  generatedAt: new Date().toISOString(),
})

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.writeFileSync(path.join(DATA_DIR, 'report.json'), JSON.stringify(report, null, 2))
console.log(`Demo report written: ${report.aggregate.games} games, ${report.insights.length} insights.`)
console.log('Next: npm run dev')

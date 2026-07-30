// Rule-based coaching notes. Each rule looks at the aggregate (or one match)
// and either stays silent or emits a note with a severity and a concrete
// "so what". The bar for emitting is deliberately high: a report with three
// pointed notes beats one with fifteen vague ones.

import { benchmarkFor } from './benchmarks'
import type { Aggregate, MatchReport } from './report'

export type Severity = 'good' | 'info' | 'warn' | 'bad'

export interface Insight {
  id: string
  severity: Severity
  title: string
  detail: string
}

const fmt = (x: number, digits = 1) => (x >= 0 ? '+' : '') + x.toFixed(digits)

export function buildInsights(agg: Aggregate): Insight[] {
  const out: Insight[] = []
  const bench = benchmarkFor(agg.primaryRole)

  if (agg.avgCsDiff10 !== null) {
    if (agg.avgCsDiff10 <= -8) {
      out.push({
        id: 'losing-lane-cs',
        severity: 'bad',
        title: 'You lose the farm battle in lane',
        detail: `Average CS diff at 10:00 is ${fmt(agg.avgCsDiff10)} vs your lane opponent. That compounds into an item deficit by the first fight. Prioritize catching every wave under tower before looking for trades.`,
      })
    } else if (agg.avgCsDiff10 >= 8) {
      out.push({
        id: 'winning-lane-cs',
        severity: 'good',
        title: 'Laning is a strength',
        detail: `Average CS diff at 10:00 is ${fmt(agg.avgCsDiff10)}. You reliably come out of lane ahead; the climb blocker is elsewhere.`,
      })
    }
  }

  if (bench?.cs10 && agg.avgCs10 !== null && agg.avgCs10 < bench.cs10.solid) {
    out.push({
      id: 'low-cs10',
      severity: 'warn',
      title: `CS at 10:00 is below target for ${agg.primaryRole.toLowerCase()}`,
      detail: `You average ${agg.avgCs10.toFixed(0)} CS at 10:00; ${bench.cs10.solid} keeps you even and ${bench.cs10.strong} puts you ahead. Farming is the most controllable stat in the game.`,
    })
  }

  if (agg.deathsByPhasePerGame.early >= 1.6) {
    const share = agg.earlyEnemySideShare
    const overextending = share !== null && share >= 0.4
    out.push({
      id: 'early-deaths',
      severity: 'bad',
      title: 'Too many deaths before 14:00',
      detail:
        `You average ${agg.deathsByPhasePerGame.early.toFixed(1)} deaths in the laning phase` +
        (overextending
          ? `, and ${Math.round(share! * 100)}% of them happen on the enemy's side of the map. That pattern is overextension without vision: you are pushing past the river before you know where their jungler is.`
          : `. Early deaths hand over lane priority and plates; play the first 14 minutes to not lose rather than to win.`),
    })
  }

  if (agg.objectiveParticipation !== null && agg.objectiveParticipation < 0.45) {
    out.push({
      id: 'low-obj-participation',
      severity: 'warn',
      title: 'You are absent when objectives are taken',
      detail: `You are credited on ${Math.round(agg.objectiveParticipation * 100)}% of your team's epic monsters. Emerald games are decided at dragon and baron; start rotating 30 seconds before spawns instead of taking one more wave.`,
    })
  }

  if (bench && agg.avgVisionPerMin < bench.visionPerMin.solid) {
    out.push({
      id: 'low-vision',
      severity: 'warn',
      title: 'Vision score is below target',
      detail: `You average ${agg.avgVisionPerMin.toFixed(2)} vision score per minute; the target for ${agg.primaryRole.toLowerCase()} is ${bench.visionPerMin.solid.toFixed(1)}+. Buy control wards on every base once laning ends.`,
    })
  }

  const pool = Object.entries(agg.championCounts).sort((a, b) => b[1] - a[1])
  if (pool.length > 6 && agg.games >= 15) {
    const top = pool.slice(0, 2).map(([name]) => name).join(' and ')
    out.push({
      id: 'wide-champ-pool',
      severity: 'warn',
      title: 'Your champion pool is too wide to climb with',
      detail: `${pool.length} different champions in ${agg.games} games. Mastery beats variety for climbing; consider narrowing to ${top} plus one backup.`,
    })
  }

  // Which measurable habit differs most between your wins and your losses?
  const biggest = [...agg.winLossGaps].sort((a, b) => {
    const rel = (g: typeof a) =>
      Math.abs(g.winsAvg - g.lossesAvg) / (Math.abs(g.winsAvg) + Math.abs(g.lossesAvg) || 1)
    return rel(b) - rel(a)
  })[0]
  if (biggest && agg.games >= 10) {
    out.push({
      id: 'win-loss-gap',
      severity: 'info',
      title: 'What your wins have in common',
      detail: `The metric that separates your wins from your losses most is ${biggest.metric}: ${fmt(biggest.winsAvg)} in wins vs ${fmt(biggest.lossesAvg)} in losses. That is the habit to protect when a game starts going sideways.`,
    })
  }

  const order: Severity[] = ['bad', 'warn', 'info', 'good']
  return out.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
}

/** Per-match callouts shown on the match card. At most two, worst first. */
export function matchFlags(m: MatchReport): Insight[] {
  const out: Insight[] = []
  if (m.laning.csDiff10 !== null && m.laning.csDiff10 <= -15) {
    out.push({
      id: 'match-lost-lane',
      severity: 'bad',
      title: `Lost lane on farm (${fmt(m.laning.csDiff10, 0)} CS at 10)`,
      detail: '',
    })
  }
  if (m.deathsByPhase.early >= 3) {
    out.push({
      id: 'match-early-deaths',
      severity: 'bad',
      title: `${m.deathsByPhase.early} deaths before 14:00`,
      detail: '',
    })
  }
  if (m.objectives.teamTaken >= 3 && m.objectives.credited === 0) {
    out.push({
      id: 'match-no-objectives',
      severity: 'warn',
      title: `0 of ${m.objectives.teamTaken} team objectives`,
      detail: '',
    })
  }
  if (m.laning.csDiff10 !== null && m.laning.csDiff10 >= 20 && m.win) {
    out.push({
      id: 'match-stomped-lane',
      severity: 'good',
      title: `Won lane hard (${fmt(m.laning.csDiff10, 0)} CS at 10)`,
      detail: '',
    })
  }
  const order: Severity[] = ['bad', 'warn', 'info', 'good']
  return out.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity)).slice(0, 2)
}

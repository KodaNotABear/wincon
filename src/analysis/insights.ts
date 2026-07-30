// Rule-based coaching notes. Each rule looks at the aggregate (or the match
// list) and either stays silent or emits a note with a severity and a concrete
// "so what". The bar for emitting is deliberately high: a report with three
// pointed notes beats one with fifteen vague ones.
//
// Rules that judge habits use recency weighting so the report tracks who you
// are becoming, not who you were 40 games ago. Re-running after a playstyle
// change should visibly change the notes.

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
const pct = (x: number) => `${Math.round(x * 100)}%`

// A game's influence halves every HALF_LIFE games of age, so the newest
// stretch dominates champion guidance within days of a habit change.
const HALF_LIFE = 12

interface ChampScore {
  name: string
  games: number
  wins: number
  weight: number
  weightedWins: number
  recentTen: number
}

/** matches must be newest first (report order). */
function scoreChampions(matches: MatchReport[]): ChampScore[] {
  const byChamp = new Map<string, ChampScore>()
  matches.forEach((m, age) => {
    const entry = byChamp.get(m.championName) ?? {
      name: m.championName,
      games: 0,
      wins: 0,
      weight: 0,
      weightedWins: 0,
      recentTen: 0,
    }
    const w = 0.5 ** (age / HALF_LIFE)
    entry.games += 1
    entry.wins += m.win ? 1 : 0
    entry.weight += w
    entry.weightedWins += m.win ? w : 0
    if (age < 10) entry.recentTen += 1
    byChamp.set(m.championName, entry)
  })
  return [...byChamp.values()]
}

function championGuidance(agg: Aggregate, matches: MatchReport[]): Insight | null {
  const poolSize = Object.keys(agg.championCounts).length
  if (agg.games < 15) return null

  if (matches.length === 0) {
    // No per-match data (shouldn't happen in practice); fall back to counts.
    if (poolSize <= 6) return null
    const top = Object.entries(agg.championCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([name]) => name)
      .join(' and ')
    return {
      id: 'wide-champ-pool',
      severity: 'warn',
      title: 'Your champion pool is too wide to climb with',
      detail: `${poolSize} different champions in ${agg.games} games. Mastery beats variety for climbing; consider narrowing to ${top} plus one backup.`,
    }
  }

  const scored = scoreChampions(matches)

  // An emerging main: someone you keep picking right now. Recognize the
  // commitment while it's happening instead of prescribing last month's picks.
  const emerging = scored
    .filter(c => c.recentTen >= 4)
    .sort((a, b) => b.recentTen - a.recentTen)[0]
  if (emerging) {
    const wr = emerging.wins / emerging.games
    if (wr >= 0.5) {
      return {
        id: 'emerging-main',
        severity: 'good',
        title: `${emerging.name} is becoming your main, and it's working`,
        detail: `${emerging.recentTen} of your last 10 games on ${emerging.name} at ${pct(wr)} overall (${emerging.wins}W ${emerging.games - emerging.wins}L). Commitment is how climbs happen; keep queueing them.`,
      }
    }
    return {
      id: 'emerging-main-struggling',
      severity: 'info',
      title: `You're committing to ${emerging.name}; the results aren't there yet`,
      detail: `${emerging.recentTen} of your last 10 games on ${emerging.name}, but ${pct(wr)} winrate over ${emerging.games} games. Champion mastery usually takes 20+ games to pay off; give it that long before judging, and review the losses on them specifically.`,
    }
  }

  if (poolSize > 6) {
    // No current commitment: recommend by recency-weighted winrate, so the
    // suggestion follows what is working for you NOW, with a small floor so
    // one lucky game doesn't top the list.
    const score = (c: ChampScore) => c.weightedWins / Math.max(c.weight, 0.01) + c.weight * 0.02
    const best = scored
      .filter(c => c.games >= 3)
      .sort((a, b) => score(b) - score(a))
      .slice(0, 2)
    const naming = best.length
      ? best.map(c => `${c.name} (${pct(c.wins / c.games)} in ${c.games})`).join(' and ')
      : Object.entries(agg.championCounts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n).join(' and ')
    return {
      id: 'wide-champ-pool',
      severity: 'warn',
      title: 'Your champion pool is too wide to climb with',
      detail: `${poolSize} different champions in ${agg.games} games and no champion in more than a few of your recent picks. Mastery beats variety; based on recent results your best bets are ${naming}. Pick one, or pick someone new, but commit.`,
    }
  }
  return null
}

/** Recent half vs older half: is the sample trending anywhere? */
function momentum(matches: MatchReport[]): Insight | null {
  if (matches.length < 16) return null
  const half = Math.floor(matches.length / 2)
  const recent = matches.slice(0, half)
  const older = matches.slice(half)

  const winrate = (xs: MatchReport[]) => xs.filter(m => m.win).length / xs.length
  const earlyDeaths = (xs: MatchReport[]) =>
    xs.reduce((a, m) => a + m.deathsByPhase.early, 0) / xs.length
  const csDiff = (xs: MatchReport[]) => {
    const vals = xs.map(m => m.laning.csDiff10).filter((v): v is number => v !== null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }

  const wrDelta = winrate(recent) - winrate(older)
  if (Math.abs(wrDelta) >= 0.12) {
    const up = wrDelta > 0
    return {
      id: 'momentum',
      severity: up ? 'good' : 'warn',
      title: up ? 'Your recent games are trending up' : 'Your recent games are trending down',
      detail: `Last ${half} games: ${pct(winrate(recent))} winrate vs ${pct(winrate(older))} in the ${matches.length - half} before them. ${up ? 'Whatever changed, protect it.' : 'Worth asking what changed: champions, role, schedule, or tilt-queueing.'}`,
    }
  }

  const edDelta = earlyDeaths(recent) - earlyDeaths(older)
  if (Math.abs(edDelta) >= 0.6) {
    const down = edDelta < 0
    return {
      id: 'momentum',
      severity: down ? 'good' : 'warn',
      title: down ? 'Early deaths are trending down' : 'Early deaths are creeping up',
      detail: `${earlyDeaths(older).toFixed(1)} per game in your older half vs ${earlyDeaths(recent).toFixed(1)} in your last ${half}. ${down ? 'That is the single best predictor in this report; keep it going.' : 'The laning phase is getting bloodier; slow it down.'}`,
    }
  }

  const csRecent = csDiff(recent)
  const csOlder = csDiff(older)
  if (csRecent !== null && csOlder !== null && Math.abs(csRecent - csOlder) >= 6) {
    const up = csRecent > csOlder
    return {
      id: 'momentum',
      severity: up ? 'good' : 'warn',
      title: up ? 'Laning is improving' : 'Laning is slipping',
      detail: `CS diff at 10:00 moved from ${fmt(csOlder)} to ${fmt(csRecent)} across your last ${half} games.`,
    }
  }
  return null
}

export function buildInsights(agg: Aggregate, matches: MatchReport[]): Insight[] {
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
      detail: `You are credited on ${pct(agg.objectiveParticipation)} of your team's epic monsters. Emerald games are decided at dragon and baron; start rotating 30 seconds before spawns instead of taking one more wave.`,
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

  const champInsight = championGuidance(agg, matches)
  if (champInsight) out.push(champInsight)

  const momentumInsight = momentum(matches)
  if (momentumInsight) out.push(momentumInsight)

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

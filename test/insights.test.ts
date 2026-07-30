import { describe, expect, it } from 'vitest'
import { buildInsights } from '../src/analysis/insights'
import type { Aggregate, MatchReport } from '../src/analysis/report'

function makeAggregate(overrides: Partial<Aggregate> = {}): Aggregate {
  // A deliberately unremarkable baseline: no rule should fire on this.
  return {
    games: 20,
    wins: 10,
    winrate: 0.5,
    primaryRole: 'MIDDLE',
    roleCounts: { MIDDLE: 20 },
    championCounts: { Ahri: 12, Orianna: 8 },
    avgCs10: 70,
    avgCsDiff10: 0,
    avgGoldDiff14: 0,
    avgDeaths: 4,
    deathsByPhasePerGame: { early: 1, mid: 2, late: 1 },
    earlyEnemySideShare: 0.2,
    objectiveParticipation: 0.6,
    avgVisionPerMin: 1.1,
    winLossGaps: [],
    ...overrides,
  }
}

/** Minimal MatchReport for rules that read per-match data. Index 0 = newest. */
function makeMatch(champ: string, win: boolean, index: number, overrides: Partial<MatchReport> = {}): MatchReport {
  return {
    matchId: `M${index}`,
    gameCreation: 1_753_000_000_000 - index * 10_000_000,
    durationMin: 30,
    championName: champ,
    role: 'MIDDLE',
    win,
    kills: 3,
    deaths: 4,
    assists: 5,
    opponentChampion: 'Fizz',
    laning: { csDiff10: 0, csDiff14: 0, goldDiff10: 0, goldDiff14: 0, xpDiff10: 0, xpDiff14: 0, cs10: 70 },
    deathList: [],
    deathsByPhase: { early: 1, mid: 2, late: 1 },
    objectives: { teamTaken: 3, credited: 2 },
    visionPerMin: 1.1,
    flags: [],
    ...overrides,
  }
}

describe('buildInsights', () => {
  it('stays quiet on a clean profile', () => {
    const ids = buildInsights(makeAggregate(), []).map(i => i.id)
    expect(ids).not.toContain('losing-lane-cs')
    expect(ids).not.toContain('early-deaths')
    expect(ids).not.toContain('low-obj-participation')
    expect(ids).not.toContain('low-vision')
  })

  it('flags losing lane on farm', () => {
    const insights = buildInsights(makeAggregate({ avgCsDiff10: -12 }), [])
    expect(insights.some(i => i.id === 'losing-lane-cs' && i.severity === 'bad')).toBe(true)
  })

  it('calls out overextension when early deaths skew to the enemy side', () => {
    const insights = buildInsights(
      makeAggregate({ deathsByPhasePerGame: { early: 2.2, mid: 2, late: 1 }, earlyEnemySideShare: 0.6 }),
      [],
    )
    const earlyDeaths = insights.find(i => i.id === 'early-deaths')
    expect(earlyDeaths).toBeDefined()
    expect(earlyDeaths!.detail).toContain('enemy')
  })

  it('flags low objective participation', () => {
    const insights = buildInsights(makeAggregate({ objectiveParticipation: 0.3 }), [])
    expect(insights.some(i => i.id === 'low-obj-participation')).toBe(true)
  })

  it('uses role benchmarks for vision (support target is higher)', () => {
    const asMid = buildInsights(makeAggregate({ avgVisionPerMin: 1.0 }), [])
    expect(asMid.some(i => i.id === 'low-vision')).toBe(false)
    const asSupport = buildInsights(
      makeAggregate({ primaryRole: 'UTILITY', avgVisionPerMin: 1.0 }),
      [],
    )
    expect(asSupport.some(i => i.id === 'low-vision')).toBe(true)
  })

  it('sorts worst severity first', () => {
    const insights = buildInsights(
      makeAggregate({ avgCsDiff10: -12, objectiveParticipation: 0.3, avgCs10: 55 }),
      [],
    )
    expect(insights[0]!.severity).toBe('bad')
  })
})

describe('champion guidance', () => {
  const WIDE_POOL = Object.fromEntries(
    ['Ahri', 'Zed', 'Akali', 'Sylas', 'Viktor', 'Annie', 'Syndra', 'Orianna'].map(c => [c, 3]),
  )

  it('warns on a wide pool with no current commitment (count fallback, no matches)', () => {
    const insights = buildInsights(makeAggregate({ championCounts: WIDE_POOL, games: 24 }), [])
    expect(insights.some(i => i.id === 'wide-champ-pool')).toBe(true)
  })

  it('recommends by recency-weighted winrate, not raw play count', () => {
    // Ahri: most played historically but losing. Viktor: fewer games,
    // recent and winning. The recommendation should surface Viktor.
    const matches: MatchReport[] = []
    let i = 0
    for (let k = 0; k < 3; k++) matches.push(makeMatch('Viktor', true, i++))
    for (const champ of ['Zed', 'Akali', 'Sylas', 'Annie', 'Syndra', 'Orianna', 'Zed']) {
      matches.push(makeMatch(champ, false, i++))
    }
    for (let k = 0; k < 10; k++) matches.push(makeMatch('Ahri', k < 3, i++))
    const counts: Record<string, number> = {}
    for (const m of matches) counts[m.championName] = (counts[m.championName] ?? 0) + 1

    const insights = buildInsights(
      makeAggregate({ championCounts: counts, games: matches.length }),
      matches,
    )
    const pool = insights.find(i => i.id === 'wide-champ-pool')
    expect(pool).toBeDefined()
    expect(pool!.detail).toContain('Viktor')
  })

  it('recognizes an emerging main that is winning', () => {
    const matches: MatchReport[] = []
    let i = 0
    for (let k = 0; k < 5; k++) matches.push(makeMatch('Locke', k !== 2, i++))
    for (let k = 0; k < 5; k++) matches.push(makeMatch(['Ahri', 'Zed', 'Viktor', 'Annie', 'Syndra'][k]!, false, i++))
    for (let k = 0; k < 10; k++) matches.push(makeMatch(['Ahri', 'Zed'][k % 2]!, k % 2 === 0, i++))
    const counts: Record<string, number> = {}
    for (const m of matches) counts[m.championName] = (counts[m.championName] ?? 0) + 1

    const insights = buildInsights(
      makeAggregate({ championCounts: counts, games: matches.length }),
      matches,
    )
    const emerging = insights.find(i => i.id === 'emerging-main')
    expect(emerging).toBeDefined()
    expect(emerging!.severity).toBe('good')
    expect(emerging!.title).toContain('Locke')
    expect(insights.some(i => i.id === 'wide-champ-pool')).toBe(false)
  })

  it('acknowledges a struggling commitment without prescribing old mains', () => {
    const matches: MatchReport[] = []
    let i = 0
    for (let k = 0; k < 5; k++) matches.push(makeMatch('Locke', k === 0, i++))
    for (let k = 0; k < 15; k++) matches.push(makeMatch(['Ahri', 'Zed', 'Viktor'][k % 3]!, k % 2 === 0, i++))
    const counts: Record<string, number> = {}
    for (const m of matches) counts[m.championName] = (counts[m.championName] ?? 0) + 1

    const insights = buildInsights(
      makeAggregate({ championCounts: counts, games: matches.length }),
      matches,
    )
    const struggling = insights.find(i => i.id === 'emerging-main-struggling')
    expect(struggling).toBeDefined()
    expect(struggling!.title).toContain('Locke')
    expect(struggling!.detail).not.toContain('Ahri')
  })
})

describe('momentum', () => {
  it('stays quiet on a flat sample', () => {
    const matches = Array.from({ length: 20 }, (_, i) => makeMatch('Ahri', i % 2 === 0, i))
    const insights = buildInsights(makeAggregate(), matches)
    expect(insights.some(i => i.id === 'momentum')).toBe(false)
  })

  it('notices a winrate upswing in the recent half', () => {
    const matches = [
      ...Array.from({ length: 10 }, (_, i) => makeMatch('Ahri', i < 7, i)), // recent: 70%
      ...Array.from({ length: 10 }, (_, i) => makeMatch('Ahri', i < 3, i + 10)), // older: 30%
    ]
    const insights = buildInsights(makeAggregate(), matches)
    const momentum = insights.find(i => i.id === 'momentum')
    expect(momentum).toBeDefined()
    expect(momentum!.severity).toBe('good')
    expect(momentum!.title).toContain('trending up')
  })

  it('notices early deaths creeping up', () => {
    const matches = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeMatch('Ahri', i % 2 === 0, i, { deathsByPhase: { early: 3, mid: 2, late: 1 } })),
      ...Array.from({ length: 10 }, (_, i) =>
        makeMatch('Ahri', i % 2 === 0, i + 10, { deathsByPhase: { early: 1, mid: 2, late: 1 } })),
    ]
    const insights = buildInsights(makeAggregate(), matches)
    const momentum = insights.find(i => i.id === 'momentum')
    expect(momentum).toBeDefined()
    expect(momentum!.severity).toBe('warn')
    expect(momentum!.title).toContain('creeping up')
  })
})

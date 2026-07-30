import { describe, expect, it } from 'vitest'
import { buildInsights } from '../src/analysis/insights'
import type { Aggregate } from '../src/analysis/report'

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

describe('buildInsights', () => {
  it('stays quiet on a clean profile', () => {
    const ids = buildInsights(makeAggregate()).map(i => i.id)
    expect(ids).not.toContain('losing-lane-cs')
    expect(ids).not.toContain('early-deaths')
    expect(ids).not.toContain('low-obj-participation')
    expect(ids).not.toContain('low-vision')
  })

  it('flags losing lane on farm', () => {
    const insights = buildInsights(makeAggregate({ avgCsDiff10: -12 }))
    expect(insights.some(i => i.id === 'losing-lane-cs' && i.severity === 'bad')).toBe(true)
  })

  it('calls out overextension when early deaths skew to the enemy side', () => {
    const insights = buildInsights(
      makeAggregate({ deathsByPhasePerGame: { early: 2.2, mid: 2, late: 1 }, earlyEnemySideShare: 0.6 }),
    )
    const earlyDeaths = insights.find(i => i.id === 'early-deaths')
    expect(earlyDeaths).toBeDefined()
    expect(earlyDeaths!.detail).toContain('enemy')
  })

  it('flags low objective participation', () => {
    const insights = buildInsights(makeAggregate({ objectiveParticipation: 0.3 }))
    expect(insights.some(i => i.id === 'low-obj-participation')).toBe(true)
  })

  it('flags a champion pool that is too wide', () => {
    const championCounts = Object.fromEntries(
      ['Ahri', 'Zed', 'Akali', 'Sylas', 'Viktor', 'Annie', 'Syndra', 'Orianna'].map(c => [c, 3]),
    )
    const insights = buildInsights(makeAggregate({ championCounts }))
    expect(insights.some(i => i.id === 'wide-champ-pool')).toBe(true)
  })

  it('uses role benchmarks for vision (support target is higher)', () => {
    const asMid = buildInsights(makeAggregate({ avgVisionPerMin: 1.0 }))
    expect(asMid.some(i => i.id === 'low-vision')).toBe(false)
    const asSupport = buildInsights(
      makeAggregate({ primaryRole: 'UTILITY', avgVisionPerMin: 1.0 }),
    )
    expect(asSupport.some(i => i.id === 'low-vision')).toBe(true)
  })

  it('sorts worst severity first', () => {
    const insights = buildInsights(
      makeAggregate({ avgCsDiff10: -12, objectiveParticipation: 0.3, avgCs10: 55 }),
    )
    expect(insights[0]!.severity).toBe('bad')
  })
})

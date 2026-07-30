import { describe, expect, it } from 'vitest'
import { buildClimbReport } from '../src/analysis/report'
import { DEMO_PLAYER, generateDataset } from '../src/fixtures/synthetic'

// Integration smoke test: the full pipeline over generated data should
// produce a coherent report without NaNs or dropped games.
describe('buildClimbReport over synthetic data', () => {
  const entries = generateDataset(7, 24)
  const report = buildClimbReport(entries, DEMO_PLAYER, {
    isDemo: true,
    generatedAt: '2026-07-29T00:00:00.000Z',
  })

  it('keeps every generated match', () => {
    expect(report.matches).toHaveLength(24)
  })

  it('is deterministic for a fixed seed', () => {
    const again = buildClimbReport(generateDataset(7, 24), DEMO_PLAYER, {
      isDemo: true,
      generatedAt: '2026-07-29T00:00:00.000Z',
    })
    expect(again).toEqual(report)
  })

  it('produces finite aggregate numbers', () => {
    const agg = report.aggregate
    expect(agg.winrate).toBeGreaterThanOrEqual(0)
    expect(agg.winrate).toBeLessThanOrEqual(1)
    expect(Number.isFinite(agg.avgCsDiff10!)).toBe(true)
    expect(Number.isFinite(agg.avgVisionPerMin)).toBe(true)
    expect(agg.primaryRole).toBe('MIDDLE')
    expect(agg.objectiveParticipation).toBeGreaterThan(0)
    expect(agg.objectiveParticipation).toBeLessThanOrEqual(1)
  })

  it('sorts matches newest first', () => {
    const times = report.matches.map(m => m.gameCreation)
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })

  it('emits at least one insight on a 24-game sample', () => {
    expect(report.insights.length).toBeGreaterThan(0)
    for (const insight of report.insights) {
      expect(insight.title).toBeTruthy()
      expect(insight.detail).not.toContain('NaN')
    }
  })
})

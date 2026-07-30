import { describe, expect, it } from 'vitest'
import type { Aggregate } from '../src/analysis/report'
import {
  focusOptions,
  focusProgress,
  focusValue,
  type FocusGoal,
} from '../src/ui/FocusLoop'

const aggregate: Aggregate = {
  games: 20,
  wins: 10,
  winrate: 0.5,
  primaryRole: 'MIDDLE',
  roleCounts: { MIDDLE: 20 },
  championCounts: { Ahri: 20 },
  avgCs10: 62,
  avgCsDiff10: -4,
  avgGoldDiff14: -250,
  avgDeaths: 6,
  deathsByPhasePerGame: { early: 2.5, mid: 2, late: 1.5 },
  earlyEnemySideShare: 0.4,
  objectiveParticipation: 0.4,
  avgVisionPerMin: 1.1,
  winLossGaps: [],
}

describe('focus loop', () => {
  it('creates concrete targets from the current baseline', () => {
    const options = focusOptions(aggregate)

    expect(options.find(option => option.metric === 'earlyDeaths')).toMatchObject({
      baseline: 2.5,
      target: 2,
      direction: 'down',
    })
    expect(options.find(option => option.metric === 'csDiff10')).toMatchObject({
      baseline: -4,
      target: 1,
      direction: 'up',
    })
    expect(options.find(option => option.metric === 'objectives')).toMatchObject({
      baseline: 0.4,
      target: 0.5,
    })
  })

  it('reads each metric from an aggregate', () => {
    expect(focusValue('earlyDeaths', aggregate)).toBe(2.5)
    expect(focusValue('csDiff10', aggregate)).toBe(-4)
    expect(focusValue('objectives', aggregate)).toBe(0.4)
    expect(focusValue('vision', aggregate)).toBe(1.1)
  })

  it('measures progress in either direction and clamps the result', () => {
    const lowerGoal: FocusGoal = {
      metric: 'earlyDeaths',
      label: 'Survive the lane',
      startedAt: 1,
      baseline: 2.5,
      target: 2,
      direction: 'down',
    }
    const higherGoal: FocusGoal = {
      metric: 'csDiff10',
      label: 'Stabilize lane farm',
      startedAt: 1,
      baseline: -4,
      target: 1,
      direction: 'up',
    }

    expect(focusProgress(lowerGoal, 2.25)).toBe(0.5)
    expect(focusProgress(lowerGoal, 3)).toBe(0)
    expect(focusProgress(lowerGoal, 1.5)).toBe(1)
    expect(focusProgress(higherGoal, -1.5)).toBe(0.5)
  })
})

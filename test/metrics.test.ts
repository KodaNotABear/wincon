import { describe, expect, it } from 'vitest'
import {
  deathsOf,
  frameAtMinute,
  laneOpponentOf,
  laningDiffs,
  objectivesOf,
  onEnemySide,
  phaseOf,
} from '../src/analysis/metrics'
import { frame, makeMatch, makeParticipant, makeTimeline, pf } from './helpers'

describe('phaseOf', () => {
  it('splits at 14 and 25 minutes', () => {
    expect(phaseOf(0)).toBe('early')
    expect(phaseOf(13.9)).toBe('early')
    expect(phaseOf(14)).toBe('mid')
    expect(phaseOf(24.9)).toBe('mid')
    expect(phaseOf(25)).toBe('late')
  })
})

describe('laneOpponentOf', () => {
  it('finds the enemy in the same position', () => {
    const me = makeParticipant({ participantId: 3, teamPosition: 'MIDDLE' })
    const opp = makeParticipant({ participantId: 8, teamPosition: 'MIDDLE' })
    const other = makeParticipant({ participantId: 7, teamPosition: 'TOP' })
    const match = makeMatch([me, opp, other])
    expect(laneOpponentOf(match, me)?.participantId).toBe(8)
  })

  it('returns undefined when role data is missing', () => {
    const me = makeParticipant({ participantId: 3, teamPosition: '' })
    const match = makeMatch([me])
    expect(laneOpponentOf(match, me)).toBeUndefined()
  })
})

describe('laningDiffs', () => {
  const timeline = makeTimeline(
    [
      frame(0),
      ...Array.from({ length: 14 }, (_, i) =>
        frame(i + 1, {
          '3': pf(3, (i + 1) * 8, (i + 1) * 400, (i + 1) * 480),
          '8': pf(8, (i + 1) * 6, (i + 1) * 350, (i + 1) * 500),
        }),
      ),
    ],
    [
      { participantId: 3, puuid: 'puuid-3' },
      { participantId: 8, puuid: 'puuid-8' },
    ],
  )

  it('computes diffs at 10 and 14', () => {
    const diffs = laningDiffs(timeline, 3, 8)
    expect(diffs.csDiff10).toBe(20) // 80 - 60
    expect(diffs.csDiff14).toBe(28) // 112 - 84
    expect(diffs.goldDiff10).toBe(500)
    expect(diffs.xpDiff10).toBe(-200)
    expect(diffs.cs10).toBe(80)
  })

  it('returns nulls for games that end before the mark', () => {
    const short = makeTimeline(
      [frame(0), frame(1, { '3': pf(3, 8, 400, 480), '8': pf(8, 6, 350, 500) })],
      [
        { participantId: 3, puuid: 'puuid-3' },
        { participantId: 8, puuid: 'puuid-8' },
      ],
    )
    const diffs = laningDiffs(short, 3, 8)
    expect(diffs.csDiff10).toBeNull()
    expect(diffs.csDiff14).toBeNull()
  })

  it('returns null diffs but real cs10 with no lane opponent', () => {
    const diffs = laningDiffs(timeline, 3, undefined)
    expect(diffs.csDiff10).toBeNull()
    expect(diffs.cs10).toBe(80)
  })
})

describe('frameAtMinute', () => {
  it('picks the last frame at or before the mark', () => {
    const timeline = makeTimeline([frame(0), frame(1), frame(2)], [])
    expect(frameAtMinute(timeline, 1)?.timestamp).toBe(60_000)
    expect(frameAtMinute(timeline, 10)?.timestamp).toBe(120_000)
  })
})

describe('onEnemySide', () => {
  it('classifies by the anti-diagonal with a river buffer', () => {
    // Deep in red jungle: enemy side for blue, home for red.
    expect(onEnemySide({ x: 11_000, y: 11_000 }, 100)).toBe(true)
    expect(onEnemySide({ x: 11_000, y: 11_000 }, 200)).toBe(false)
    // Blue-side jungle.
    expect(onEnemySide({ x: 4_000, y: 4_000 }, 100)).toBe(false)
    expect(onEnemySide({ x: 4_000, y: 4_000 }, 200)).toBe(true)
    // Mid lane at the river: inside the buffer, enemy side for neither.
    expect(onEnemySide({ x: 7_435, y: 7_435 }, 100)).toBe(false)
    expect(onEnemySide({ x: 7_435, y: 7_435 }, 200)).toBe(false)
  })
})

describe('deathsOf', () => {
  it('collects my deaths with phase and side', () => {
    const timeline = makeTimeline(
      [
        frame(5, {}, [
          { type: 'CHAMPION_KILL', timestamp: 5 * 60_000, killerId: 8, victimId: 3, position: { x: 11_000, y: 11_000 } },
          { type: 'CHAMPION_KILL', timestamp: 5.5 * 60_000, killerId: 3, victimId: 8, position: { x: 7_000, y: 7_000 } },
        ]),
        frame(20, {}, [
          { type: 'CHAMPION_KILL', timestamp: 20 * 60_000, killerId: 6, victimId: 3, position: { x: 3_000, y: 3_000 } },
        ]),
      ],
      [],
    )
    const deaths = deathsOf(timeline, 3, 100)
    expect(deaths).toHaveLength(2)
    expect(deaths[0]).toMatchObject({ phase: 'early', enemySide: true })
    expect(deaths[1]).toMatchObject({ phase: 'mid', enemySide: false })
  })
})

describe('objectivesOf', () => {
  it('counts team objectives and my credited share', () => {
    const timeline = makeTimeline(
      [
        frame(10, {}, [
          { type: 'ELITE_MONSTER_KILL', timestamp: 600_000, killerId: 2, killerTeamId: 100, monsterType: 'DRAGON', assistingParticipantIds: [3, 4], position: { x: 9866, y: 4414 } },
          { type: 'ELITE_MONSTER_KILL', timestamp: 610_000, killerId: 7, killerTeamId: 200, monsterType: 'RIFTHERALD', position: { x: 5007, y: 10471 } },
        ]),
        frame(22, {}, [
          { type: 'ELITE_MONSTER_KILL', timestamp: 22 * 60_000, killerId: 2, killerTeamId: 100, monsterType: 'BARON_NASHOR', assistingParticipantIds: [1, 4], position: { x: 5007, y: 10471 } },
        ]),
      ],
      [],
    )
    const objectives = objectivesOf(timeline, 3, 100)
    expect(objectives.teamTaken).toBe(2)
    expect(objectives.credited).toBe(1)
  })
})

import { describe, expect, it } from 'vitest'
import { buildMoments, clusterMoments, type Moment } from '../src/analysis/moments'
import { frame, makeMatch, makeParticipant, makeTimeline, pf } from './helpers'

const participants = [
  makeParticipant({ participantId: 3, puuid: 'me', teamPosition: 'MIDDLE', championName: 'Ahri', kills: 1, deaths: 2, assists: 0, win: false }),
  makeParticipant({ participantId: 8, puuid: 'them', teamPosition: 'MIDDLE', championName: 'Zed' }),
]

// Frames stay in chronological order (as real timelines are); events ride
// along inside the frame covering their minute.
const timeline = makeTimeline(
  [
    frame(0),
    ...Array.from({ length: 12 }, (_, i) => {
      const minute = i + 1
      const events =
        minute === 6
          ? [
              // Early death on the enemy side of the river.
              { type: 'CHAMPION_KILL' as const, timestamp: 5.5 * 60_000, killerId: 8, victimId: 3, position: { x: 11_500, y: 11_500 } },
            ]
          : minute === 12
            ? [
                { type: 'ELITE_MONSTER_KILL' as const, timestamp: 12 * 60_000, killerId: 2, killerTeamId: 100 as const, monsterType: 'DRAGON', monsterSubType: 'FIRE_DRAGON', assistingParticipantIds: [1, 4], position: { x: 9866, y: 4414 } },
              ]
            : []
      return frame(
        minute,
        {
          '3': pf(3, minute * 6, minute * 350, minute * 480),
          '8': pf(8, minute * 8, minute * 420, minute * 500),
        },
        events,
      )
    }),
  ],
  [
    { participantId: 3, puuid: 'me' },
    { participantId: 8, puuid: 'them' },
  ],
)

const match = makeMatch(participants, 1500)

describe('buildMoments', () => {
  const moments = buildMoments(match, timeline, 'me')

  it('is sorted by timestamp and ends with the result', () => {
    const times = moments.map(m => m.timestamp)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(moments[moments.length - 1]!.kind).toBe('end')
    expect(moments[moments.length - 1]!.title).toContain('Defeat')
  })

  it('pauses on my death with the overextension note', () => {
    const death = moments.find(m => m.kind === 'death')
    expect(death).toBeDefined()
    expect(death!.autoPause).toBe(true)
    expect(death!.note).toContain('Zed')
    expect(death!.note).toContain('enemy side')
  })

  it('pauses on objectives my team took without me', () => {
    const objective = moments.find(m => m.kind === 'objective')
    expect(objective).toBeDefined()
    expect(objective!.autoPause).toBe(true)
    expect(objective!.title).toContain('Infernal drake')
    expect(objective!.title).toContain('without you')
  })

  it('adds a 10:00 checkpoint with the cs diff', () => {
    const checkpoint = moments.find(m => m.kind === 'checkpoint')
    expect(checkpoint).toBeDefined()
    expect(checkpoint!.note).toContain('-20 CS')
    expect(checkpoint!.note).toContain('Zed')
  })

  it('returns empty for an unknown player', () => {
    expect(buildMoments(match, timeline, 'nobody')).toEqual([])
  })
})

describe('clusterMoments', () => {
  const pause = (timestamp: number): Moment => ({
    timestamp,
    kind: 'death',
    title: `t${timestamp}`,
    note: '',
    autoPause: true,
  })

  it('groups pause moments within the gap and splits beyond it', () => {
    const moments = [
      pause(60_000),
      pause(65_000), // 5s later: same fight
      pause(66_000),
      pause(200_000), // far later: new cluster
      { ...pause(205_000), autoPause: false }, // non-pausing moments are ignored
      pause(206_000),
    ]
    const clusters = clusterMoments(moments)
    expect(clusters.map(c => c.length)).toEqual([3, 2])
    expect(clusters[0]![0]!.timestamp).toBe(60_000)
    expect(clusters[1]![1]!.timestamp).toBe(206_000)
  })

  it('handles an empty list', () => {
    expect(clusterMoments([])).toEqual([])
  })
})

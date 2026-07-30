import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildClimbReport } from '../src/analysis/report'
import { DEMO_PLAYER, generateDataset } from '../src/fixtures/synthetic'
import type { MatchDto, TimelineDto } from '../src/riot/types'

const fixture = JSON.parse(
  fs.readFileSync(path.resolve('src/fixtures/locke-vs-fizz.json'), 'utf8'),
) as { match: MatchDto; timeline: TimelineDto }

describe('portfolio showcase fixture', () => {
  it('keeps the Locke versus Fizz match while removing player identifiers', () => {
    const participants = fixture.match.info.participants
    const me = participants.find(participant => participant.puuid === DEMO_PLAYER.puuid)
    const opponent = participants.find(
      participant => participant.teamPosition === me?.teamPosition && participant.teamId !== me?.teamId,
    )

    expect(fixture.match.metadata.matchId).toBe('SHOWCASE_LOCKE_FIZZ')
    expect(me?.championName).toBe('Locke')
    expect(me?.riotIdGameName).toBe(DEMO_PLAYER.gameName)
    expect(opponent?.championName).toBe('Fizz')
    expect(participants.every(participant => /^demo-puuid-(?:me|\d+)$/.test(participant.puuid))).toBe(true)
    expect(
      participants.every(
        participant => participant.riotIdGameName === DEMO_PLAYER.gameName || /^Player\d+$/.test(participant.riotIdGameName),
      ),
    ).toBe(true)
  })

  it('leads a 24-game report and remains replayable', () => {
    const report = buildClimbReport([fixture, ...generateDataset(7, 23)], DEMO_PLAYER, {
      isDemo: true,
      generatedAt: '2026-07-30T12:00:00.000Z',
    })

    expect(report.matches).toHaveLength(24)
    expect(report.matches[0]).toMatchObject({
      matchId: 'SHOWCASE_LOCKE_FIZZ',
      championName: 'Locke',
      opponentChampion: 'Fizz',
      kills: 25,
      deaths: 3,
      assists: 4,
    })
    expect(fixture.timeline.info.frames.length).toBeGreaterThan(20)
  })
})

// Hand-built minimal fixtures for deterministic unit tests. The synthetic
// generator is for demo data and smoke tests; these are for exact assertions.

import type { FrameDto, MatchDto, ParticipantDto, TimelineDto, Role } from '../src/riot/types'

export function makeParticipant(overrides: Partial<ParticipantDto> & { participantId: number }): ParticipantDto {
  return {
    puuid: `puuid-${overrides.participantId}`,
    riotIdGameName: `P${overrides.participantId}`,
    riotIdTagline: 'NA1',
    championName: 'Ahri',
    teamId: overrides.participantId <= 5 ? 100 : 200,
    teamPosition: 'MIDDLE' as Role,
    win: true,
    kills: 0,
    deaths: 0,
    assists: 0,
    totalMinionsKilled: 0,
    neutralMinionsKilled: 0,
    goldEarned: 0,
    visionScore: 20,
    wardsPlaced: 5,
    champLevel: 15,
    ...overrides,
  }
}

export function makeMatch(participants: ParticipantDto[], durationSec = 1800): MatchDto {
  return {
    metadata: { matchId: 'TEST_1' },
    info: {
      gameCreation: 1_753_000_000_000,
      gameDuration: durationSec,
      gameVersion: '16.14.1',
      queueId: 420,
      participants,
    },
  }
}

export function makeTimeline(frames: FrameDto[], participants: { participantId: number; puuid: string }[]): TimelineDto {
  return {
    metadata: { matchId: 'TEST_1' },
    info: { frameInterval: 60_000, participants, frames },
  }
}

export function frame(
  minute: number,
  participantFrames: FrameDto['participantFrames'] = {},
  events: FrameDto['events'] = [],
): FrameDto {
  return { timestamp: minute * 60_000, participantFrames, events }
}

export function pf(participantId: number, cs: number, gold: number, xp: number) {
  return {
    participantId,
    minionsKilled: cs,
    jungleMinionsKilled: 0,
    totalGold: gold,
    xp,
    level: 10,
    position: { x: 7000, y: 7000 },
  }
}

// Typed subsets of the Riot API responses. Only the fields the analysis
// layer reads are declared; the raw JSON on disk keeps everything.

export interface AccountDto {
  puuid: string
  gameName: string
  tagLine: string
}

export interface MatchDto {
  metadata: { matchId: string }
  info: {
    gameCreation: number
    // Seconds on modern patches, milliseconds before 11.20. normalizeDuration() handles both.
    gameDuration: number
    gameVersion: string
    queueId: number
    participants: ParticipantDto[]
  }
}

export type Role = 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY' | ''

export interface ParticipantDto {
  puuid: string
  participantId: number
  riotIdGameName: string
  riotIdTagline: string
  championName: string
  teamId: 100 | 200
  teamPosition: Role
  win: boolean
  kills: number
  deaths: number
  assists: number
  totalMinionsKilled: number
  neutralMinionsKilled: number
  goldEarned: number
  visionScore: number
  wardsPlaced: number
  champLevel: number
}

export interface TimelineDto {
  metadata: { matchId: string }
  info: {
    frameInterval: number
    participants: { participantId: number; puuid: string }[]
    frames: FrameDto[]
  }
}

export interface FrameDto {
  timestamp: number
  // Keyed by participantId as a string, "1" through "10".
  participantFrames: Record<string, ParticipantFrameDto>
  events: TimelineEventDto[]
}

export interface ParticipantFrameDto {
  participantId: number
  minionsKilled: number
  jungleMinionsKilled: number
  totalGold: number
  xp: number
  level: number
  position: Position
}

export interface Position {
  x: number
  y: number
}

export type TimelineEventDto =
  | ChampionKillEvent
  | EliteMonsterKillEvent
  | BuildingKillEvent
  | ItemPurchasedEvent
  | WardPlacedEvent
  | OtherEvent

export interface ChampionKillEvent {
  type: 'CHAMPION_KILL'
  timestamp: number
  killerId: number
  victimId: number
  assistingParticipantIds?: number[]
  position: Position
  /** Base kill gold paid to the killer. */
  bounty?: number
  /** Extra shutdown gold on top of the base bounty. */
  shutdownBounty?: number
}

export interface EliteMonsterKillEvent {
  type: 'ELITE_MONSTER_KILL'
  timestamp: number
  killerId: number
  killerTeamId: 100 | 200
  monsterType: string // DRAGON, RIFTHERALD, BARON_NASHOR, HORDE, ...
  monsterSubType?: string
  assistingParticipantIds?: number[]
  position: Position
  bounty?: number
}

export interface BuildingKillEvent {
  type: 'BUILDING_KILL'
  timestamp: number
  /** Team that OWNED the destroyed building, not the team that killed it. */
  teamId: 100 | 200
  buildingType: string
  position: Position
  /** 0 when minions finished the building. */
  killerId?: number
  assistingParticipantIds?: number[]
}

/** No position in the payload, but the placer's position at that timestamp is known. */
export interface WardPlacedEvent {
  type: 'WARD_PLACED'
  timestamp: number
  creatorId: number
  wardType: string // YELLOW_TRINKET, CONTROL_WARD, SIGHT_WARD, BLUE_TRINKET, ...
}

/** Purchases only happen at the shop, so these mark base visits precisely. */
export interface ItemPurchasedEvent {
  type: 'ITEM_PURCHASED'
  timestamp: number
  participantId: number
  itemId: number
}

export interface OtherEvent {
  type: string
  timestamp: number
}

/** gameDuration switched from ms to seconds in patch 11.20; normalize to seconds. */
export function normalizeDuration(gameDuration: number): number {
  return gameDuration > 30_000 ? Math.round(gameDuration / 1000) : gameDuration
}

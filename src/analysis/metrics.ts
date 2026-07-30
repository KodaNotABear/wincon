// Pure functions over Match-V5 + timeline data. Everything here is
// deterministic and side-effect free so it can be unit tested directly.

import type {
  ChampionKillEvent,
  EliteMonsterKillEvent,
  FrameDto,
  MatchDto,
  ParticipantDto,
  Position,
  TimelineDto,
} from '../riot/types'

// Summoner's Rift coordinates run 0..~14870. Blue base sits at the origin,
// red base at the top-right, and the river follows the anti-diagonal
// (x + y = MAP_MAX) between them.
export const MAP_MAX = 14_870

export type Phase = 'early' | 'mid' | 'late'

// Laning effectively ends around 14:00; 25:00 is a reasonable mid/late split
// at Emerald game lengths.
export const EARLY_END_MIN = 14
export const MID_END_MIN = 25

export function phaseOf(minute: number): Phase {
  if (minute < EARLY_END_MIN) return 'early'
  if (minute < MID_END_MIN) return 'mid'
  return 'late'
}

export function participantOf(match: MatchDto, puuid: string): ParticipantDto | undefined {
  return match.info.participants.find(p => p.puuid === puuid)
}

/** The enemy player assigned the same lane. Undefined for remakes/odd role data. */
export function laneOpponentOf(match: MatchDto, me: ParticipantDto): ParticipantDto | undefined {
  if (!me.teamPosition) return undefined
  return match.info.participants.find(
    p => p.teamId !== me.teamId && p.teamPosition === me.teamPosition,
  )
}

/** Last frame at or before the given minute mark. Frames arrive once per minute. */
export function frameAtMinute(timeline: TimelineDto, minute: number): FrameDto | undefined {
  const cutoff = minute * 60_000 + 500
  const eligible = timeline.info.frames.filter(f => f.timestamp <= cutoff)
  return eligible[eligible.length - 1]
}

export function csAt(frame: FrameDto, participantId: number): number {
  const pf = frame.participantFrames[String(participantId)]
  return pf ? pf.minionsKilled + pf.jungleMinionsKilled : 0
}

export interface LaningDiffs {
  csDiff10: number | null
  csDiff14: number | null
  goldDiff10: number | null
  goldDiff14: number | null
  xpDiff10: number | null
  xpDiff14: number | null
  cs10: number | null
}

/** Diffs vs the lane opponent at 10:00 and 14:00. Null when the game (or the opponent) doesn't reach the mark. */
export function laningDiffs(
  timeline: TimelineDto,
  myId: number,
  oppId: number | undefined,
): LaningDiffs {
  const at = (minute: number) => {
    const frame = frameAtMinute(timeline, minute)
    if (!frame || frame.timestamp < minute * 60_000 - 500) return null
    const mine = frame.participantFrames[String(myId)]
    if (!mine) return null
    const theirs = oppId ? frame.participantFrames[String(oppId)] : undefined
    return { frame, mine, theirs }
  }

  const f10 = at(10)
  const f14 = at(14)
  const diff = (
    snap: ReturnType<typeof at>,
    field: 'totalGold' | 'xp',
  ): number | null => (snap && snap.theirs ? snap.mine[field] - snap.theirs[field] : null)
  const csDiff = (snap: ReturnType<typeof at>): number | null =>
    snap && snap.theirs
      ? snap.mine.minionsKilled + snap.mine.jungleMinionsKilled
        - (snap.theirs.minionsKilled + snap.theirs.jungleMinionsKilled)
      : null

  return {
    csDiff10: csDiff(f10),
    csDiff14: csDiff(f14),
    goldDiff10: diff(f10, 'totalGold'),
    goldDiff14: diff(f14, 'totalGold'),
    xpDiff10: diff(f10, 'xp'),
    xpDiff14: diff(f14, 'xp'),
    cs10: f10 ? f10.mine.minionsKilled + f10.mine.jungleMinionsKilled : null,
  }
}

export interface DeathPoint {
  minute: number
  phase: Phase
  x: number
  y: number
  enemySide: boolean
}

/**
 * Whether a position is on the enemy's half of the map, with a small buffer
 * around the river so mid-lane trades don't count as overextending.
 */
export function onEnemySide(pos: Position, teamId: 100 | 200): boolean {
  const d = pos.x + pos.y
  return teamId === 100 ? d > MAP_MAX * 1.06 : d < MAP_MAX * 0.94
}

export function deathsOf(timeline: TimelineDto, myId: number, teamId: 100 | 200): DeathPoint[] {
  const out: DeathPoint[] = []
  for (const frame of timeline.info.frames) {
    for (const event of frame.events) {
      if (event.type !== 'CHAMPION_KILL') continue
      const kill = event as ChampionKillEvent
      if (kill.victimId !== myId) continue
      const minute = kill.timestamp / 60_000
      out.push({
        minute,
        phase: phaseOf(minute),
        x: kill.position.x,
        y: kill.position.y,
        enemySide: onEnemySide(kill.position, teamId),
      })
    }
  }
  return out
}

export interface ObjectiveSummary {
  /** Epic monsters (dragons, heralds, barons, void grubs) taken by my team. */
  teamTaken: number
  /** How many of those I was credited on (killer or assist). Timeline credit is
   * coarse — being nearby without a tag doesn't count — so treat this as a floor. */
  credited: number
}

export function objectivesOf(timeline: TimelineDto, myId: number, teamId: 100 | 200): ObjectiveSummary {
  let teamTaken = 0
  let credited = 0
  for (const frame of timeline.info.frames) {
    for (const event of frame.events) {
      if (event.type !== 'ELITE_MONSTER_KILL') continue
      const kill = event as EliteMonsterKillEvent
      if (kill.killerTeamId !== teamId) continue
      teamTaken++
      if (kill.killerId === myId || kill.assistingParticipantIds?.includes(myId)) credited++
    }
  }
  return { teamTaken, credited }
}

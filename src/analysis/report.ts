import type { MatchDto, Role, TimelineDto } from '../riot/types'
import { normalizeDuration } from '../riot/types'
import {
  DeathPoint,
  LaningDiffs,
  ObjectiveSummary,
  deathsOf,
  laneOpponentOf,
  laningDiffs,
  objectivesOf,
  participantOf,
} from './metrics'
import { buildInsights, matchFlags, type Insight } from './insights'

export interface PlayerInfo {
  puuid: string
  gameName: string
  tagLine: string
  region: string
}

export interface MatchReport {
  matchId: string
  gameCreation: number
  durationMin: number
  championName: string
  role: Role
  win: boolean
  kills: number
  deaths: number
  assists: number
  opponentChampion: string | null
  laning: LaningDiffs
  deathList: DeathPoint[]
  deathsByPhase: { early: number; mid: number; late: number }
  objectives: ObjectiveSummary
  visionPerMin: number
  flags: Insight[]
}

export interface Aggregate {
  games: number
  wins: number
  winrate: number
  primaryRole: Role
  roleCounts: Record<string, number>
  championCounts: Record<string, number>
  avgCs10: number | null
  avgCsDiff10: number | null
  avgGoldDiff14: number | null
  avgDeaths: number
  deathsByPhasePerGame: { early: number; mid: number; late: number }
  /** Of early-game deaths, the fraction that happened on the enemy's side of the map. */
  earlyEnemySideShare: number | null
  objectiveParticipation: number | null
  avgVisionPerMin: number
  /** Metrics where wins and losses diverge the most, for the "what your wins have in common" insight. */
  winLossGaps: { metric: string; winsAvg: number; lossesAvg: number }[]
}

export interface ClimbReport {
  schema: 1
  isDemo: boolean
  generatedAt: string
  player: PlayerInfo
  matches: MatchReport[]
  aggregate: Aggregate
  insights: Insight[]
}

export function buildMatchReport(match: MatchDto, timeline: TimelineDto, puuid: string): MatchReport | null {
  const me = participantOf(match, puuid)
  if (!me) return null
  const durationMin = normalizeDuration(match.info.gameDuration) / 60
  // Remakes carry no signal; skip anything under 5 minutes.
  if (durationMin < 5) return null

  const opp = laneOpponentOf(match, me)
  const deathList = deathsOf(timeline, me.participantId, me.teamId)
  const deathsByPhase = {
    early: deathList.filter(d => d.phase === 'early').length,
    mid: deathList.filter(d => d.phase === 'mid').length,
    late: deathList.filter(d => d.phase === 'late').length,
  }

  const report: MatchReport = {
    matchId: match.metadata.matchId,
    gameCreation: match.info.gameCreation,
    durationMin,
    championName: me.championName,
    role: me.teamPosition,
    win: me.win,
    kills: me.kills,
    deaths: me.deaths,
    assists: me.assists,
    opponentChampion: opp?.championName ?? null,
    laning: laningDiffs(timeline, me.participantId, opp?.participantId),
    deathList,
    deathsByPhase,
    objectives: objectivesOf(timeline, me.participantId, me.teamId),
    visionPerMin: me.visionScore / durationMin,
    flags: [],
  }
  report.flags = matchFlags(report)
  return report
}

const avg = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null

function counted<T extends string>(values: T[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const v of values) out[v] = (out[v] ?? 0) + 1
  return out
}

export function buildAggregate(matches: MatchReport[]): Aggregate {
  const wins = matches.filter(m => m.win)
  const losses = matches.filter(m => !m.win)
  const roleCounts = counted(matches.map(m => m.role || 'UNKNOWN'))
  const primaryRole = (Object.entries(roleCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '') as Role

  const earlyDeaths = matches.flatMap(m => m.deathList.filter(d => d.phase === 'early'))
  const objTaken = matches.reduce((a, m) => a + m.objectives.teamTaken, 0)
  const objCredited = matches.reduce((a, m) => a + m.objectives.credited, 0)

  const gapMetrics: { metric: string; pick: (m: MatchReport) => number | null }[] = [
    { metric: 'CS diff at 10:00', pick: m => m.laning.csDiff10 },
    { metric: 'gold diff at 14:00', pick: m => m.laning.goldDiff14 },
    { metric: 'deaths before 14:00', pick: m => m.deathsByPhase.early },
    { metric: 'vision score per minute', pick: m => m.visionPerMin },
  ]
  const winLossGaps = gapMetrics
    .map(({ metric, pick }) => {
      const w = avg(wins.map(pick).filter((x): x is number => x !== null))
      const l = avg(losses.map(pick).filter((x): x is number => x !== null))
      return w !== null && l !== null ? { metric, winsAvg: w, lossesAvg: l } : null
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  const n = matches.length || 1
  return {
    games: matches.length,
    wins: wins.length,
    winrate: matches.length ? wins.length / matches.length : 0,
    primaryRole,
    roleCounts,
    championCounts: counted(matches.map(m => m.championName)),
    avgCs10: avg(matches.map(m => m.laning.cs10).filter((x): x is number => x !== null)),
    avgCsDiff10: avg(matches.map(m => m.laning.csDiff10).filter((x): x is number => x !== null)),
    avgGoldDiff14: avg(matches.map(m => m.laning.goldDiff14).filter((x): x is number => x !== null)),
    avgDeaths: matches.reduce((a, m) => a + m.deaths, 0) / n,
    deathsByPhasePerGame: {
      early: matches.reduce((a, m) => a + m.deathsByPhase.early, 0) / n,
      mid: matches.reduce((a, m) => a + m.deathsByPhase.mid, 0) / n,
      late: matches.reduce((a, m) => a + m.deathsByPhase.late, 0) / n,
    },
    earlyEnemySideShare: earlyDeaths.length
      ? earlyDeaths.filter(d => d.enemySide).length / earlyDeaths.length
      : null,
    objectiveParticipation: objTaken ? objCredited / objTaken : null,
    avgVisionPerMin: matches.reduce((a, m) => a + m.visionPerMin, 0) / n,
    winLossGaps,
  }
}

export function buildClimbReport(
  entries: { match: MatchDto; timeline: TimelineDto }[],
  player: PlayerInfo,
  opts: { isDemo: boolean; generatedAt: string },
): ClimbReport {
  const matches = entries
    .map(e => buildMatchReport(e.match, e.timeline, player.puuid))
    .filter((m): m is MatchReport => m !== null)
    .sort((a, b) => b.gameCreation - a.gameCreation)
  const aggregate = buildAggregate(matches)
  return {
    schema: 1,
    isDemo: opts.isDemo,
    generatedAt: opts.generatedAt,
    player,
    matches,
    aggregate,
    insights: buildInsights(aggregate, matches),
  }
}

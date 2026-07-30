// Replay "moments": the timestamps where a replay should pause and say
// something useful. Pure functions over raw match + timeline data, so the
// replay UI stays dumb and this logic stays testable.

import type {
  ChampionKillEvent,
  EliteMonsterKillEvent,
  MatchDto,
  Position,
  TimelineDto,
} from '../riot/types'
import { normalizeDuration } from '../riot/types'
import { EARLY_END_MIN, laneOpponentOf, laningDiffs, onEnemySide, participantOf, phaseOf } from './metrics'

export type MomentKind = 'death' | 'kill' | 'objective' | 'checkpoint' | 'end'

export interface Moment {
  timestamp: number // in-game ms
  kind: MomentKind
  title: string
  note: string
  position?: Position
  /** Replay halts here when auto-pause is on. Kills and routine objectives just ping. */
  autoPause: boolean
}

const MONSTER_NAMES: Record<string, string> = {
  FIRE_DRAGON: 'Infernal drake',
  WATER_DRAGON: 'Ocean drake',
  EARTH_DRAGON: 'Mountain drake',
  AIR_DRAGON: 'Cloud drake',
  HEXTECH_DRAGON: 'Hextech drake',
  CHEMTECH_DRAGON: 'Chemtech drake',
  ELDER_DRAGON: 'Elder dragon',
  RIFTHERALD: 'Rift Herald',
  BARON_NASHOR: 'Baron Nashor',
  HORDE: 'Void grubs',
  ATAKHAN: 'Atakhan',
}

function monsterName(event: EliteMonsterKillEvent): string {
  return (
    MONSTER_NAMES[event.monsterSubType ?? ''] ??
    MONSTER_NAMES[event.monsterType] ??
    event.monsterType.toLowerCase().replace(/_/g, ' ')
  )
}

const mmss = (ms: number) => {
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function buildMoments(match: MatchDto, timeline: TimelineDto, puuid: string): Moment[] {
  const me = participantOf(match, puuid)
  if (!me) return []
  const champByPid = new Map(match.info.participants.map(p => [p.participantId, p.championName]))
  const opp = laneOpponentOf(match, me)
  const out: Moment[] = []
  let deathCount = 0
  let earlyDeathCount = 0

  for (const frame of timeline.info.frames) {
    for (const event of frame.events) {
      if (event.type === 'CHAMPION_KILL') {
        const kill = event as ChampionKillEvent
        const minute = kill.timestamp / 60_000
        if (kill.victimId === me.participantId) {
          deathCount++
          const enemySide = onEnemySide(kill.position, me.teamId)
          const phase = phaseOf(minute)
          if (phase === 'early') earlyDeathCount++
          const killer = champByPid.get(kill.killerId) ?? 'the enemy team'
          let note: string
          if (phase === 'early' && enemySide) {
            note = `Killed by ${killer} on the enemy side of the map with laning still on. This is the overextension pattern: past the river without knowing where their jungler is.`
          } else if (phase === 'early') {
            note =
              earlyDeathCount >= 2
                ? `Killed by ${killer}. Early death number ${earlyDeathCount}; every one hands over plates and priority.`
                : `Killed by ${killer} during laning. One early death is recoverable; the pattern to avoid is the second.`
          } else {
            note = `Killed by ${killer}. ${deathCount} deaths so far; in the ${phase} game each one is 30+ seconds of your team playing 4v5.`
          }
          out.push({
            timestamp: kill.timestamp,
            kind: 'death',
            title: `${mmss(kill.timestamp)} — Death ${deathCount}`,
            note,
            position: kill.position,
            autoPause: true,
          })
        } else if (kill.killerId === me.participantId) {
          const victim = champByPid.get(kill.victimId) ?? 'an enemy'
          out.push({
            timestamp: kill.timestamp,
            kind: 'kill',
            title: `${mmss(kill.timestamp)} — Killed ${victim}`,
            note: '',
            position: kill.position,
            autoPause: false,
          })
        }
      } else if (event.type === 'ELITE_MONSTER_KILL') {
        const monster = event as EliteMonsterKillEvent
        const name = monsterName(monster)
        const ours = monster.killerTeamId === me.teamId
        const credited =
          monster.killerId === me.participantId || monster.assistingParticipantIds?.includes(me.participantId)
        if (ours && !credited) {
          out.push({
            timestamp: monster.timestamp,
            kind: 'objective',
            title: `${mmss(monster.timestamp)} — ${name} taken without you`,
            note: `Your team secured ${name} and you weren't credited on it. If you were farming a side lane, that can be right; if you were just late, it's a habit to fix.`,
            position: monster.position,
            autoPause: true,
          })
        } else {
          out.push({
            timestamp: monster.timestamp,
            kind: 'objective',
            title: `${mmss(monster.timestamp)} — ${ours ? `${name} secured` : `${name} lost`}`,
            note: '',
            position: monster.position,
            autoPause: false,
          })
        }
      }
    }
  }

  // 10:00 laning checkpoint.
  const diffs = laningDiffs(timeline, me.participantId, opp?.participantId)
  if (diffs.csDiff10 !== null) {
    const ahead = diffs.csDiff10 >= 0
    out.push({
      timestamp: 10 * 60_000,
      kind: 'checkpoint',
      title: `10:00 — Laning checkpoint`,
      note: `${ahead ? '+' : ''}${diffs.csDiff10} CS${diffs.goldDiff10 !== null ? ` and ${diffs.goldDiff10 >= 0 ? '+' : ''}${diffs.goldDiff10} gold` : ''} against ${opp?.championName ?? 'your lane opponent'}. ${
        ahead
          ? 'Lane is won on the scoreboard; convert it into plates or river control.'
          : `You're behind on farm with ${EARLY_END_MIN - 10} minutes of laning left. Stabilize under tower; don't force it.`
      }`,
      autoPause: true,
    })
  }

  // Game end.
  const durationMs = normalizeDuration(match.info.gameDuration) * 1000
  out.push({
    timestamp: durationMs,
    kind: 'end',
    title: `${mmss(durationMs)} — ${me.win ? 'Victory' : 'Defeat'}`,
    note: `${me.kills}/${me.deaths}/${me.assists} on ${me.championName}. ${
      me.win
        ? 'Find one thing from this game worth repeating and queue again.'
        : 'One correctable pattern from this replay beats ten excuses; pick it and queue again.'
    }`,
    autoPause: true,
  })

  return out.sort((a, b) => a.timestamp - b.timestamp)
}

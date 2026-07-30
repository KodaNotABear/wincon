// Seeded generator producing shape-valid Match-V5 + timeline data.
// Powers `npm run demo` (so the UI works with zero API setup) and the
// integration test. Numbers are tuned to look like a believable Emerald
// mid-lane sample: real farm curves, streaky results, a few disaster games.

import type {
  ChampionKillEvent,
  EliteMonsterKillEvent,
  FrameDto,
  MatchDto,
  Role,
  TimelineDto,
} from '../riot/types'
import type { PlayerInfo } from '../analysis/report'

/** Small deterministic PRNG (mulberry32) so demo output is reproducible. */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clampToMap = (v: number) => Math.min(MAP_MAX - 500, Math.max(500, v))

/**
 * Believable death spots for a blue-side mid laner: mostly mid lane, some
 * objective pits, some jungle. `deep` pushes the position toward the enemy
 * half; the report derives its own enemy-side flag from the final position.
 */
function deathPosition(rand: () => number, deep: boolean): { x: number; y: number } {
  const roll = rand()
  let x: number
  let y: number
  if (roll < 0.55) {
    // Mid lane runs along the main diagonal (x roughly equals y).
    const t = deep ? 0.55 + rand() * 0.3 : 0.2 + rand() * 0.33
    const along = t * MAP_MAX
    const perp = (rand() - 0.5) * 2400
    x = along + perp
    y = along - perp
  } else if (roll < 0.78) {
    // Dragon and baron pits.
    const pit = rand() < 0.55 ? { x: 9866, y: 4414 } : { x: 5007, y: 10471 }
    x = pit.x + (rand() - 0.5) * 2600
    y = pit.y + (rand() - 0.5) * 2600
  } else {
    // Jungle skirmishes, biased toward whichever half the death belongs on.
    const base = deep ? 0.52 : 0.18
    x = (base + rand() * 0.3) * MAP_MAX
    y = (base + rand() * 0.3) * MAP_MAX
  }
  return { x: clampToMap(x), y: clampToMap(y) }
}

const CHAMPS = ['Ahri', 'Orianna', 'Syndra', 'Viktor', 'Akali', 'Sylas', 'Annie', 'Zed']
const ENEMY_CHAMPS = ['Yasuo', 'Katarina', 'Vex', 'Malzahar', 'Fizz', 'Leblanc']
const ROLES: Role[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
const MAP_MAX = 14_870

export const DEMO_PLAYER: PlayerInfo = {
  puuid: 'demo-puuid-me',
  gameName: 'DemoClimber',
  tagLine: 'NA1',
  region: 'americas',
}

export interface GeneratedEntry {
  match: MatchDto
  timeline: TimelineDto
}

export function generateDataset(seed: number, games: number): GeneratedEntry[] {
  const rand = rng(seed)
  const out: GeneratedEntry[] = []
  // Fixed anchor so demo data is fully deterministic.
  const anchor = Date.UTC(2026, 6, 28, 3, 0, 0)
  for (let i = 0; i < games; i++) {
    out.push(generateMatch(rand, i, anchor - i * 5.5 * 3_600_000))
  }
  return out
}

function generateMatch(rand: () => number, index: number, gameCreation: number): GeneratedEntry {
  const durationMin = 24 + Math.floor(rand() * 12) // 24-35 min
  const durationSec = durationMin * 60

  // Hidden per-game quality drives everything: farm, deaths, and the result.
  // This is what makes the generated sample produce believable insights.
  const quality = rand() * 2 - 1 // -1 bad day .. +1 smurf day
  const win = rand() < 0.42 + quality * 0.35

  const myChamp = CHAMPS[Math.floor(rand() * (rand() < 0.55 ? 2 : CHAMPS.length))]!
  const oppChamp = ENEMY_CHAMPS[Math.floor(rand() * ENEMY_CHAMPS.length)]!

  // participantId 1-5 = blue (100), 6-10 = red (200). I'm blue mid (id 3).
  const myId = 3
  const oppId = 8
  const myTeam = 100 as const

  // Farm curves: ~7.2 cs/min baseline shifted by game quality, opponent steady.
  const myCsRate = 6.1 + quality * 1.3 + rand() * 0.5
  const oppCsRate = 6.9 + rand() * 0.8
  const myGoldRate = 330 + quality * 60 + rand() * 30
  const oppGoldRate = 360 + rand() * 30

  // Death schedule: bad games front-load deaths, and early deaths on a bad
  // day skew to the enemy side of the map (the overextension pattern).
  const earlyDeaths = quality < -0.2 ? Math.floor(rand() * 3) + 1 : Math.floor(rand() * 2)
  const midDeaths = Math.floor(rand() * 3) + (win ? 0 : 1)
  const lateDeaths = durationMin > 25 ? Math.floor(rand() * 2) + (win ? 0 : 1) : 0
  const deathMinutes: { minute: number; enemySide: boolean }[] = []
  for (let d = 0; d < earlyDeaths; d++) {
    deathMinutes.push({ minute: 3 + rand() * 10.5, enemySide: rand() < (quality < 0 ? 0.55 : 0.25) })
  }
  for (let d = 0; d < midDeaths; d++) deathMinutes.push({ minute: 14 + rand() * 10.5, enemySide: rand() < 0.4 })
  for (let d = 0; d < lateDeaths; d++) deathMinutes.push({ minute: 25 + rand() * (durationMin - 25.5), enemySide: rand() < 0.45 })

  const kills = Math.max(0, Math.floor(rand() * 6 + quality * 3))
  const assists = Math.floor(rand() * 8) + 2
  const deaths = deathMinutes.length

  const frames: FrameDto[] = []
  for (let minute = 0; minute <= durationMin; minute++) {
    const events: FrameDto['events'] = []
    for (const dm of deathMinutes) {
      if (Math.floor(dm.minute) === minute) {
        const kill: ChampionKillEvent = {
          type: 'CHAMPION_KILL',
          timestamp: dm.minute * 60_000,
          killerId: oppId,
          victimId: myId,
          position: deathPosition(rand, dm.enemySide),
        }
        events.push(kill)
      }
    }
    // Dragons every ~6 minutes from 8:00; my team's share tracks game quality,
    // my personal credit tracks it harder (absent on bad days).
    if (minute >= 8 && minute % 6 === 2) {
      const myTeamTook = rand() < 0.5 + quality * 0.3
      const monster: EliteMonsterKillEvent = {
        type: 'ELITE_MONSTER_KILL',
        timestamp: minute * 60_000,
        killerId: myTeamTook ? 2 : 7,
        killerTeamId: myTeamTook ? 100 : 200,
        monsterType: 'DRAGON',
        monsterSubType: 'FIRE_DRAGON',
        assistingParticipantIds: myTeamTook && rand() < 0.5 + quality * 0.4 ? [myId, 1] : [1, 4],
        position: { x: 9866, y: 4414 },
      }
      events.push(monster)
    }
    frames.push({
      timestamp: minute * 60_000,
      participantFrames: {
        [String(myId)]: {
          participantId: myId,
          minionsKilled: Math.round(myCsRate * Math.max(0, minute - 1.5)),
          jungleMinionsKilled: 0,
          totalGold: Math.round(500 + myGoldRate * minute),
          xp: Math.round(480 * minute),
          level: Math.min(18, 1 + Math.floor(minute / 1.7)),
          position: { x: 6000, y: 6000 },
        },
        [String(oppId)]: {
          participantId: oppId,
          minionsKilled: Math.round(oppCsRate * Math.max(0, minute - 1.5)),
          jungleMinionsKilled: 0,
          totalGold: Math.round(500 + oppGoldRate * minute),
          xp: Math.round(500 * minute),
          level: Math.min(18, 1 + Math.floor(minute / 1.65)),
          position: { x: 8800, y: 8800 },
        },
      },
      events,
    })
  }

  const matchId = `DEMO_${String(1000 + index)}`
  const mkParticipant = (pid: number, teamId: 100 | 200, role: Role, champ: string, isMe: boolean, isOpp: boolean) => ({
    puuid: isMe ? DEMO_PLAYER.puuid : `demo-puuid-${pid}`,
    participantId: pid,
    riotIdGameName: isMe ? DEMO_PLAYER.gameName : `Player${pid}`,
    riotIdTagline: 'NA1',
    championName: isMe ? myChamp : isOpp ? oppChamp : `Champ${pid}`,
    teamId,
    teamPosition: role,
    win: teamId === myTeam ? win : !win,
    kills: isMe ? kills : Math.floor(rand() * 8),
    deaths: isMe ? deaths : Math.floor(rand() * 7),
    assists: isMe ? assists : Math.floor(rand() * 9),
    totalMinionsKilled: Math.round((isMe ? myCsRate : 6.5) * durationMin),
    neutralMinionsKilled: 0,
    goldEarned: Math.round((isMe ? myGoldRate : 350) * durationMin),
    visionScore: isMe
      ? Math.round(durationMin * (0.55 + Math.max(0, quality) * 0.5 + rand() * 0.3))
      : Math.round(durationMin * (0.8 + rand())),
    wardsPlaced: Math.floor(durationMin / 2),
    champLevel: Math.min(18, Math.round(durationMin / 1.8)),
  })

  const participants = [100, 200].flatMap(teamId =>
    ROLES.map((role, i) => {
      const pid = (teamId === 100 ? 1 : 6) + i
      return mkParticipant(pid, teamId as 100 | 200, role, 'x', pid === myId, pid === oppId)
    }),
  )

  const match: MatchDto = {
    metadata: { matchId },
    info: {
      gameCreation,
      gameDuration: durationSec,
      gameVersion: '16.14.1',
      queueId: 420,
      participants,
    },
  }
  const timeline: TimelineDto = {
    metadata: { matchId },
    info: {
      frameInterval: 60_000,
      participants: participants.map(p => ({ participantId: p.participantId, puuid: p.puuid })),
      frames,
    },
  }
  return { match, timeline }
}

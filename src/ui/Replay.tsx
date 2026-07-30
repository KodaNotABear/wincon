// Full-screen match replay driven by timeline frames.
//
// Movement: per-player anchor lists built from every positional signal in
// the API (minute frames, deaths, kill/objective/tower participation, shop
// visits). Deaths and base visits teleport instead of interpolating.
//
// Presentation: the map gets a director's-cut treatment. While playing you
// see champions, wards, pings, a killfeed, and a broadcast clock; when a
// coaching cluster pauses playback, the camera zooms to the event, a
// spotlight dims everything else, and the coach card docks in the sidebar
// so the map is never covered. The gold timeline doubles as the scrubber,
// with your deaths, kills, and objectives plotted on the curve itself.

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  BuildingKillEvent,
  ChampionKillEvent,
  EliteMonsterKillEvent,
  ItemPurchasedEvent,
  MatchDto,
  Position,
  TimelineDto,
  WardPlacedEvent,
} from '../riot/types'
import { normalizeDuration } from '../riot/types'
import { buildMoments, clusterMoments, type Moment, type MomentKind } from '../analysis/moments'
import { ChampIcon, champIconUrl, useDdragonVersion } from './ddragon'
import { BARON_PIT, DRAGON_PIT, LANE_TOWERS, RiftBackdrop, sx, sy } from './RiftMap'
import { useTooltip } from './shared'

interface RawEntry {
  match: MatchDto
  timeline: TimelineDto
}

// 30 in-game seconds per real second at 1x: a 30 minute game replays in a minute.
const BASE_RATE = 30

// Approximate objective spawn rules for the pit timers. Close enough for a
// replay; the kill events themselves are always exact.
const DRAGON_FIRST_SPAWN = 5 * 60_000
const DRAGON_RESPAWN = 5 * 60_000
const HERALD_SPAWN = 16 * 60_000
const BARON_SPAWN = 25 * 60_000
const BARON_RESPAWN = 6 * 60_000
const SPEEDS = [0.5, 1, 2, 4]
const PING_LIFE_MS = 30_000 // in-game lifetime of a kill ping
const TRAIL_FRAMES = 6 // minutes of movement history behind your champion

// Display lifetimes per ward type. Honest approximations: trinket wards are
// level-scaled and farsight is permanent, but 95s reads right on a replay.
const WARD_LIFE: Record<string, number> = {
  CONTROL_WARD: 180_000,
  YELLOW_TRINKET: 95_000,
  SIGHT_WARD: 95_000,
  BLUE_TRINKET: 95_000,
}

const KIND_STYLE: Record<MomentKind, { label: string; bg: string; text: string }> = {
  death: { label: 'DEATH', bg: 'var(--status-critical)', text: '#ffffff' },
  kill: { label: 'KILL', bg: 'var(--status-good)', text: '#ffffff' },
  objective: { label: 'OBJECTIVE', bg: 'var(--status-warn)', text: '#0b0b0b' },
  checkpoint: { label: 'CHECKPOINT', bg: 'var(--baseline)', text: 'var(--ink)' },
  end: { label: 'FULL TIME', bg: 'var(--brand)', text: 'var(--brand-ink)' },
}

const mmss = (ms: number) => {
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

interface Anchor {
  ts: number
  pos?: Position
  kind: 'frame' | 'pin' | 'death' | 'base'
}

export function Replay({
  slug,
  matchId,
  puuid,
  onClose,
}: {
  slug: string
  matchId: string
  puuid: string
  onClose: () => void
}) {
  const [data, setData] = useState<RawEntry | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/match/${slug}/${matchId}.json`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(setData)
      .catch(() => setError('Could not load this match from the local cache.'))
  }, [slug, matchId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="replay-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="replay-shell">
        {error && <div className="replay-error">{error}</div>}
        {!data && !error && <div className="replay-error">Loading replay…</div>}
        {data && <ReplayInner data={data} puuid={puuid} onClose={onClose} />}
      </div>
    </div>
  )
}

function ReplayInner({ data, puuid, onClose }: { data: RawEntry; puuid: string; onClose: () => void }) {
  const { match, timeline } = data
  const version = useDdragonVersion()
  const duration = normalizeDuration(match.info.gameDuration) * 1000
  const me = match.info.participants.find(p => p.puuid === puuid)
  const opp = me
    ? match.info.participants.find(p => p.teamId !== me.teamId && p.teamPosition === me.teamPosition)
    : undefined
  const champByPid = useMemo(
    () => new Map(match.info.participants.map(p => [p.participantId, p.championName])),
    [match],
  )

  const moments = useMemo(() => buildMoments(match, timeline, puuid), [match, timeline, puuid])
  const clusters = useMemo(() => clusterMoments(moments), [moments])

  const kills = useMemo(
    () =>
      timeline.info.frames.flatMap(f =>
        f.events
          .filter((e): e is ChampionKillEvent => e.type === 'CHAMPION_KILL')
          .map(e => ({
            timestamp: e.timestamp,
            position: e.position,
            killerId: e.killerId,
            victimId: e.victimId,
            victimTeam: (e.victimId <= 5 ? 100 : 200) as 100 | 200,
          })),
      ),
    [timeline],
  )
  const monsters = useMemo(
    () =>
      timeline.info.frames.flatMap(f =>
        f.events
          .filter((e): e is EliteMonsterKillEvent => e.type === 'ELITE_MONSTER_KILL')
          .map(e => ({
            timestamp: e.timestamp,
            position: e.position,
            team: e.killerTeamId,
            monsterType: e.monsterType,
          })),
      ),
    [timeline],
  )
  const towers = useMemo(
    () =>
      timeline.info.frames.flatMap(f =>
        f.events
          .filter((e): e is BuildingKillEvent => e.type === 'BUILDING_KILL')
          // teamId is the building's owner; the destroyer is the other team.
          .map(e => ({ timestamp: e.timestamp, position: e.position, team: e.teamId === 100 ? 200 : 100 })),
      ),
    [timeline],
  )

  // Position anchors per participant, using every positional signal the API
  // has. Deaths and base visits are teleports.
  const anchorsByPid = useMemo(() => {
    const map = new Map<number, Anchor[]>()
    const add = (pid: number, anchor: Anchor) => {
      const list = map.get(pid)
      if (list) list.push(anchor)
      else map.set(pid, [anchor])
    }
    for (const frame of timeline.info.frames) {
      for (const pf of Object.values(frame.participantFrames)) {
        add(pf.participantId, { ts: frame.timestamp, pos: pf.position, kind: 'frame' })
      }
      for (const event of frame.events) {
        if (event.type === 'CHAMPION_KILL') {
          const kill = event as ChampionKillEvent
          add(kill.victimId, { ts: kill.timestamp, pos: kill.position, kind: 'death' })
          if (kill.killerId >= 1 && kill.killerId <= 10) {
            add(kill.killerId, { ts: kill.timestamp, pos: kill.position, kind: 'pin' })
          }
          for (const assistId of kill.assistingParticipantIds ?? []) {
            add(assistId, { ts: kill.timestamp, pos: kill.position, kind: 'pin' })
          }
        } else if (event.type === 'ITEM_PURCHASED') {
          const buy = event as ItemPurchasedEvent
          add(buy.participantId, { ts: buy.timestamp, kind: 'base' })
        } else if (event.type === 'ELITE_MONSTER_KILL') {
          const monster = event as EliteMonsterKillEvent
          if (monster.killerId >= 1 && monster.killerId <= 10) {
            add(monster.killerId, { ts: monster.timestamp, pos: monster.position, kind: 'pin' })
          }
          for (const assistId of monster.assistingParticipantIds ?? []) {
            add(assistId, { ts: monster.timestamp, pos: monster.position, kind: 'pin' })
          }
        } else if (event.type === 'BUILDING_KILL') {
          const building = event as BuildingKillEvent
          if (building.killerId && building.killerId >= 1 && building.killerId <= 10) {
            add(building.killerId, { ts: building.timestamp, pos: building.position, kind: 'pin' })
          }
          for (const assistId of building.assistingParticipantIds ?? []) {
            add(assistId, { ts: building.timestamp, pos: building.position, kind: 'pin' })
          }
        }
      }
    }
    for (const [pid, list] of map) {
      list.sort((a, b) => a.ts - b.ts)
      const cleaned: Anchor[] = []
      for (const anchor of list) {
        const prev = cleaned[cleaned.length - 1]
        if (anchor.kind === 'base' && prev?.kind === 'base' && anchor.ts - prev.ts <= 3_000) continue
        // Thin out fight pins: a burst of kill participations seconds apart
        // made dots ping-pong. Deaths and shop trips always survive.
        if (anchor.kind === 'pin' && prev && anchor.ts - prev.ts <= 4_000) continue
        cleaned.push(anchor)
      }
      map.set(pid, cleaned)
    }
    return map
  }, [timeline])

  const nextPosAfter = (list: Anchor[], from: number): Position | null => {
    for (let i = from; i < list.length; i++) {
      const pos = list[i]?.pos
      if (pos) return pos
    }
    return null
  }

  const posAt = (pid: number, t: number): Position | null => {
    const list = anchorsByPid.get(pid)
    if (!list || list.length === 0) return null
    let i = -1
    for (let j = 0; j < list.length && list[j]!.ts <= t; j++) i = j
    if (i < 0) return list[0]!.pos ?? nextPosAfter(list, 0)
    const a = list[i]!
    const b = list[i + 1]
    if (a.kind === 'death' || a.kind === 'base') {
      return nextPosAfter(list, i + 1) ?? a.pos ?? null
    }
    if (!b) return a.pos ?? null
    if (b.kind === 'base' || !b.pos) return a.pos ?? null
    if (!a.pos) return b.pos
    const alpha = b.ts === a.ts ? 0 : (t - a.ts) / (b.ts - a.ts)
    // Smoothstep: dots accelerate out of one anchor and settle into the next
    // instead of bouncing between straight lines at constant speed.
    const eased = alpha * alpha * (3 - 2 * alpha)
    return { x: a.pos.x + (b.pos.x - a.pos.x) * eased, y: a.pos.y + (b.pos.y - a.pos.y) * eased }
  }

  const isRespawning = (pid: number, t: number): boolean =>
    anchorsByPid.get(pid)?.some(a => a.kind === 'death' && a.ts <= t && t - a.ts < 11_000) ?? false

  // Wards, planted at the placer's position at placement time.
  const wards = useMemo(
    () =>
      timeline.info.frames.flatMap(f =>
        f.events
          .filter((e): e is WardPlacedEvent => e.type === 'WARD_PLACED')
          .filter(e => e.creatorId >= 1 && e.creatorId <= 10 && e.wardType !== 'UNDEFINED')
          .flatMap(e => {
            const pos = posAt(e.creatorId, e.timestamp)
            if (!pos) return []
            return [
              {
                ts: e.timestamp,
                pos,
                creatorId: e.creatorId,
                team: (e.creatorId <= 5 ? 100 : 200) as 100 | 200,
                control: e.wardType === 'CONTROL_WARD',
                life: WARD_LIFE[e.wardType] ?? 95_000,
              },
            ]
          }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timeline, anchorsByPid],
  )

  // Gold lead per frame, from YOUR team's perspective, indexed by timestamp.
  const goldPts = useMemo(() => {
    const sign = me?.teamId === 200 ? -1 : 1
    return timeline.info.frames.map(f => {
      let blue = 0
      let red = 0
      for (const pf of Object.values(f.participantFrames)) {
        if (pf.participantId <= 5) blue += pf.totalGold
        else red += pf.totalGold
      }
      return { t: f.timestamp, lead: sign * (blue - red) }
    })
  }, [timeline, me?.teamId])

  const leadAt = (t: number): number => {
    if (goldPts.length === 0) return 0
    let prev = goldPts[0]!
    for (const pt of goldPts) {
      if (pt.t > t) {
        const alpha = pt.t === prev.t ? 0 : (t - prev.t) / (pt.t - prev.t)
        return prev.lead + (pt.lead - prev.lead) * alpha
      }
      prev = pt
    }
    return prev.lead
  }

  const mapTip = useTooltip()
  const timelineTip = useTooltip()
  const [clock, setClock] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [autoPause, setAutoPause] = useState(true)
  const [showWards, setShowWards] = useState(true)
  const [activeCluster, setActiveCluster] = useState<Moment[] | null>(null)
  const clockRef = useRef(0)
  const scrubbing = useRef(false)

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const startedAt = performance.now()
    let last = startedAt
    let lastStep = last
    let stopped = false
    // Advance the clock by wall time, clamped so an occlusion gap never
    // teleports the playhead.
    const step = (now: number) => {
      if (stopped) return
      const dt = Math.min(250, now - last)
      last = now
      lastStep = now
      // Broadcast pacing: ease in after every resume, and slow down as the
      // next coaching moment approaches, so there's time to digest.
      let pace = 0.35 + 0.65 * Math.min(1, (now - startedAt) / 1500)
      if (autoPause) {
        const upcoming = clusters.find(c => c[0]!.timestamp > clockRef.current)
        if (upcoming) {
          const gap = upcoming[0]!.timestamp - clockRef.current
          if (gap < 12_000) pace *= 0.35 + 0.65 * (gap / 12_000)
        }
      }
      const next = clockRef.current + dt * BASE_RATE * speed * pace
      const crossed = autoPause
        ? clusters.find(c => c[0]!.timestamp > clockRef.current && c[0]!.timestamp <= next)
        : undefined
      if (crossed) {
        stopped = true
        clockRef.current = crossed[0]!.timestamp
        setClock(crossed[0]!.timestamp)
        setActiveCluster(crossed)
        setPlaying(false)
        return
      }
      if (next >= duration) {
        stopped = true
        clockRef.current = duration
        setClock(duration)
        setActiveCluster(clusters[clusters.length - 1] ?? null)
        setPlaying(false)
        return
      }
      clockRef.current = next
      setClock(next)
    }
    const tick = (now: number) => {
      step(now)
      if (!stopped) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    // Browsers freeze rAF entirely when the window is hidden or occluded,
    // which made Continue look dead. This slow timer keeps time flowing
    // whenever rAF stalls; rendering catches up on the next real frame.
    const fallback = setInterval(() => {
      const now = performance.now()
      if (now - lastStep > 300) step(now)
    }, 250)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(fallback)
    }
  }, [playing, speed, autoPause, clusters, duration])

  const seek = (t: number, cluster: Moment[] | null = null) => {
    clockRef.current = clamp(t, 0, duration)
    setClock(clockRef.current)
    setActiveCluster(cluster)
    if (cluster) setPlaying(false)
  }

  const restart = () => {
    seek(0)
    setPlaying(true)
  }

  const resume = () => {
    const clusterEnd = activeCluster?.[activeCluster.length - 1]?.timestamp ?? clockRef.current
    clockRef.current = Math.min(duration, Math.max(clockRef.current, clusterEnd) + 250)
    setClock(clockRef.current)
    setActiveCluster(null)
    setPlaying(true)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      e.preventDefault()
      if (clockRef.current >= duration) {
        restart()
      } else {
        setActiveCluster(null)
        setPlaying(p => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration])

  const dots = match.info.participants.flatMap(p => {
    const pos = posAt(p.participantId, clock)
    if (!pos) return []
    return [
      {
        participant: p,
        x: pos.x,
        y: pos.y,
        isMe: p.puuid === puuid,
        respawning: isRespawning(p.participantId, clock),
      },
    ]
  })

  const meDot = dots.find(d => d.isMe)
  const trailSegments: string[][] = [[]]
  if (me && meDot) {
    const point = (p: Position) => `${sx(p.x)},${sy(p.y)}`
    const from = clock - TRAIL_FRAMES * 60_000
    for (const anchor of anchorsByPid.get(me.participantId) ?? []) {
      if (anchor.ts > clock) break
      if (anchor.ts < from) continue
      if (anchor.pos) trailSegments[trailSegments.length - 1]!.push(point(anchor.pos))
      if (anchor.kind === 'death' || anchor.kind === 'base') trailSegments.push([])
    }
    trailSegments[trailSegments.length - 1]!.push(point({ x: meDot.x, y: meDot.y }))
  }

  // Paused-moment annotations: where the enemy jungler was when you died,
  // and where you were when objectives fell.
  interface MapNote {
    x: number
    y: number
    from?: Position
    title: string
    tip: string
  }
  const mapNotes: MapNote[] = []
  if (activeCluster && me) {
    const enemyJungler = match.info.participants.find(
      p => p.teamId !== me.teamId && p.teamPosition === 'JUNGLE',
    )
    for (const moment of activeCluster) {
      if (moment.kind === 'death' && moment.position && enemyJungler) {
        const pos = posAt(enemyJungler.participantId, moment.timestamp)
        if (pos) {
          const dist = Math.round(Math.hypot(pos.x - moment.position.x, pos.y - moment.position.y))
          const far = dist > 6000
          mapNotes.push({
            x: pos.x,
            y: pos.y,
            from: moment.position,
            title: `${enemyJungler.championName} (enemy jungler) was here`,
            tip: far
              ? `Roughly ${dist.toLocaleString()} units away, the far side of the map. This death wasn't a gank; the lane itself went wrong.`
              : `Only ~${dist.toLocaleString()} units away when you died. The gank was on before you committed; track their jungler's last-seen side before trading.`,
          })
        }
      } else if (moment.kind === 'objective' && moment.position && moment.autoPause) {
        const myPos = posAt(me.participantId, moment.timestamp)
        if (myPos) {
          const dist = Math.round(Math.hypot(myPos.x - moment.position.x, myPos.y - moment.position.y))
          mapNotes.push({
            x: myPos.x,
            y: myPos.y,
            from: moment.position,
            title: 'You were here',
            tip: `About ${dist.toLocaleString()} units from the objective when your team took it. A planned cross-map trade is fine; being late isn't. Start rotating 30 seconds before the spawn.`,
          })
        }
      }
    }
  }

  // Director's cut: zoom the camera to the paused event and spotlight it.
  const focusPos = activeCluster
    ? activeCluster.find(m => m.position)?.position ??
      (me ? posAt(me.participantId, activeCluster[0]!.timestamp) : null)
    : null
  const cam = (() => {
    if (!focusPos) return { s: 1, tx: 0, ty: 0 }
    const s = 1.8
    const cx = clamp(sx(focusPos.x), 50 / s, 100 - 50 / s)
    const cy = clamp(sy(focusPos.y), 50 / s, 100 - 50 / s)
    return { s, tx: 50 - s * cx, ty: 50 - s * cy }
  })()
  const spot = focusPos
    ? { x: cam.tx + cam.s * sx(focusPos.x), y: cam.ty + cam.s * sy(focusPos.y) }
    : null

  // Live tower states: match each BUILDING_KILL to the nearest known turret.
  const towerStates = useMemo(
    () =>
      LANE_TOWERS.map(tower => {
        const kill = towers.find(
          b => Math.hypot(sx(b.position.x) - tower.x, sy(b.position.y) - tower.y) < 4,
        )
        return { ...tower, destroyedAt: kill?.timestamp ?? Number.POSITIVE_INFINITY }
      }),
    [towers],
  )

  // Pit timers from the approximate spawn rules plus the exact kill events.
  const pitTimers: { x: number; y: number; label: string; remaining: number | null }[] = []
  {
    const dragonKills = monsters.filter(m => m.monsterType.includes('DRAGON') && m.timestamp <= clock)
    const lastDragon = dragonKills[dragonKills.length - 1]
    const dragonNext = lastDragon ? lastDragon.timestamp + DRAGON_RESPAWN : DRAGON_FIRST_SPAWN
    pitTimers.push({
      ...DRAGON_PIT,
      label: 'DRAKE',
      remaining: clock >= dragonNext ? null : dragonNext - clock,
    })
    if (clock < BARON_SPAWN) {
      const heraldDead = monsters.some(m => m.monsterType === 'RIFTHERALD' && m.timestamp <= clock)
      if (heraldDead) {
        pitTimers.push({ ...BARON_PIT, label: 'BARON', remaining: BARON_SPAWN - clock })
      } else {
        pitTimers.push({
          ...BARON_PIT,
          label: 'HERALD',
          remaining: clock >= HERALD_SPAWN ? null : HERALD_SPAWN - clock,
        })
      }
    } else {
      const baronKills = monsters.filter(m => m.monsterType === 'BARON_NASHOR' && m.timestamp <= clock)
      const lastBaron = baronKills[baronKills.length - 1]
      const baronNext = lastBaron ? lastBaron.timestamp + BARON_RESPAWN : BARON_SPAWN
      pitTimers.push({
        ...BARON_PIT,
        label: 'BARON',
        remaining: clock >= baronNext ? null : baronNext - clock,
      })
    }
  }

  const activePings = kills.filter(k => clock >= k.timestamp && clock - k.timestamp < PING_LIFE_MS)
  const activeMonsters = monsters.filter(m => clock >= m.timestamp && clock - m.timestamp < PING_LIFE_MS * 1.5)
  const activeTowers = towers.filter(t => clock >= t.timestamp && clock - t.timestamp < PING_LIFE_MS * 1.5)
  const activeWards = showWards
    ? wards.filter(w => clock >= w.ts && clock - w.ts < w.life)
    : []
  // Killfeed entries linger ~2.6 real seconds regardless of playback speed.
  const feedWindow = BASE_RATE * speed * 2_600
  const killfeed = kills.filter(k => clock >= k.timestamp && clock - k.timestamp < feedWindow).slice(-4)

  const clusterIndex = activeCluster ? clusters.indexOf(activeCluster) : -1

  // Timeline geometry.
  const TL_W = 560
  const TL_H = 92
  const plotTop = 8
  const plotBot = TL_H - 20
  const y0 = (plotTop + plotBot) / 2
  const maxLead = Math.max(1000, ...goldPts.map(p => Math.abs(p.lead)))
  const goldScale = (plotBot - plotTop) / 2 / maxLead
  const tx = (t: number) => (t / duration) * TL_W
  const ty = (lead: number) => y0 - lead * goldScale
  const leadLine = goldPts.map(p => `${tx(p.t)},${ty(p.lead)}`).join(' ')
  const leadArea = `M 0 ${y0} L ${leadLine.replace(/ /g, ' L ')} L ${TL_W} ${y0} Z`

  const seekFromPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    seek(((e.clientX - rect.left) / rect.width) * duration)
  }

  const myDeathMarks = me ? kills.filter(k => k.victimId === me.participantId) : []
  const myKillMarks = me ? kills.filter(k => k.killerId === me.participantId) : []

  return (
    <>
      <header className="replay-head">
        <div className="replay-title">
          <ChampIcon name={me?.championName ?? null} size={30} />
          <span className="replay-matchup">
            {me?.championName ?? '?'} <span className="vs">vs {opp?.championName ?? '?'}</span>
          </span>
          <ChampIcon name={opp?.championName ?? null} size={22} />
          <span className={`result-badge ${me?.win ? 'win' : 'loss'}`}>{me?.win ? 'WIN' : 'LOSS'}</span>
          <span className="replay-date">
            {new Date(match.info.gameCreation).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ·{' '}
            {mmss(duration)}
          </span>
        </div>
        <button className="ghost-btn replay-close" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="replay-body">
        <div className="replay-stage">
          <div className="replay-map">
            <svg viewBox="0 0 100 100" role="img" aria-label="Match replay map">
              <g
                className="map-camera"
                style={{ transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.s})` }}
              >
                <RiftBackdrop />
                {trailSegments
                  .filter(segment => segment.length > 1)
                  .map((segment, i) => (
                    <polyline
                      key={`trail-${i}`}
                      points={segment.join(' ')}
                      fill="none"
                      stroke="var(--brand)"
                      strokeWidth="0.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray="1.7 1.1"
                      opacity="0.5"
                    />
                  ))}
                {towerStates.map((t, i) =>
                  clock < t.destroyedAt ? (
                    <rect
                      key={`tw-${i}`}
                      x={t.x - 1}
                      y={t.y - 1}
                      width="2"
                      height="2"
                      transform={`rotate(45 ${t.x} ${t.y})`}
                      fill={t.team === 100 ? 'var(--series-1)' : 'var(--series-2)'}
                      stroke="var(--map-bg)"
                      strokeWidth="0.35"
                      opacity="0.85"
                    />
                  ) : (
                    <circle key={`tw-${i}`} cx={t.x} cy={t.y} r="0.7" fill="var(--map-camp)" opacity="0.6" />
                  ),
                )}
                {pitTimers.map((pit, i) => (
                  <g key={`pit-${i}`} className="pit-timer">
                    {pit.remaining === null ? (
                      <>
                        <circle className="note-pulse" cx={pit.x} cy={pit.y} r="3" fill="none" stroke="var(--status-warn)" strokeWidth="0.5" />
                        <text className="spawn-label" x={pit.x} y={pit.y + 4.8} textAnchor="middle">
                          {pit.label} UP
                        </text>
                      </>
                    ) : (
                      <>
                        <circle cx={pit.x} cy={pit.y} r="2.4" fill="none" stroke="var(--map-camp)" strokeWidth="0.5" strokeDasharray="1.2 1" />
                        <text className="spawn-label" x={pit.x} y={pit.y + 4.8} textAnchor="middle">
                          {pit.label} {mmss(pit.remaining)}
                        </text>
                      </>
                    )}
                  </g>
                ))}
                {activeWards.map((w, i) => {
                  const fade = Math.min(1, (w.ts + w.life - clock) / 10_000)
                  const mine = w.creatorId === me?.participantId
                  const c = w.team === 100 ? 'var(--series-1)' : 'var(--series-2)'
                  const wx = sx(w.pos.x)
                  const wy = sy(w.pos.y)
                  return (
                    <g key={`ward-${i}`} opacity={(mine ? 0.95 : 0.5) * fade}>
                      {w.control ? (
                        <rect
                          x={wx - 0.9}
                          y={wy - 0.9}
                          width="1.8"
                          height="1.8"
                          transform={`rotate(45 ${wx} ${wy})`}
                          fill="none"
                          stroke={c}
                          strokeWidth="0.45"
                        />
                      ) : (
                        <circle cx={wx} cy={wy} r="1" fill="none" stroke={c} strokeWidth="0.45" />
                      )}
                      <circle cx={wx} cy={wy} r="0.4" fill={c} />
                    </g>
                  )
                })}
                {activeTowers.map((t, i) => {
                  const age = (clock - t.timestamp) / (PING_LIFE_MS * 1.5)
                  return (
                    <rect
                      key={`tower-${i}`}
                      x={sx(t.position.x) - 1.3}
                      y={sy(t.position.y) - 1.3}
                      width="2.6"
                      height="2.6"
                      fill="none"
                      stroke={t.team === 100 ? 'var(--series-1)' : 'var(--series-2)'}
                      strokeWidth="0.6"
                      opacity={0.8 * (1 - age)}
                    />
                  )
                })}
                {activeMonsters.map((m, i) => {
                  const age = (clock - m.timestamp) / (PING_LIFE_MS * 1.5)
                  return (
                    <rect
                      key={`mon-${i}`}
                      x={sx(m.position.x) - 1.8}
                      y={sy(m.position.y) - 1.8}
                      width="3.6"
                      height="3.6"
                      transform={`rotate(45 ${sx(m.position.x)} ${sy(m.position.y)})`}
                      fill="none"
                      stroke={m.team === 100 ? 'var(--series-1)' : 'var(--series-2)'}
                      strokeWidth="0.7"
                      opacity={1 - age}
                    />
                  )
                })}
                {activePings.map((k, i) => {
                  const age = (clock - k.timestamp) / PING_LIFE_MS
                  const c = k.victimTeam === 100 ? 'var(--series-1)' : 'var(--series-2)'
                  return (
                    <g key={`kill-${i}`} opacity={0.9 * (1 - age)}>
                      <path
                        d={`M ${sx(k.position.x) - 1.2} ${sy(k.position.y) - 1.2} l 2.4 2.4 M ${sx(k.position.x) + 1.2} ${sy(k.position.y) - 1.2} l -2.4 2.4`}
                        stroke={c}
                        strokeWidth="0.7"
                        strokeLinecap="round"
                      />
                      {age < 0.25 && (
                        <circle
                          cx={sx(k.position.x)}
                          cy={sy(k.position.y)}
                          r={2 + age * 10}
                          fill="none"
                          stroke={c}
                          strokeWidth="0.4"
                          opacity={1 - age * 4}
                        />
                      )}
                    </g>
                  )
                })}
                {dots.map(d => {
                  const pid = d.participant.participantId
                  const r = d.isMe ? 3 : 2.4
                  const cx = sx(d.x)
                  const cy = sy(d.y)
                  const team = d.participant.teamId === 100 ? 'var(--series-1)' : 'var(--series-2)'
                  return (
                    <g key={pid} opacity={d.respawning ? 0.35 : 1}>
                      <title>{d.participant.championName}</title>
                      <circle cx={cx} cy={cy} r={r} fill={team} />
                      {version && (
                        <>
                          <clipPath id={`champ-clip-${pid}`}>
                            <circle cx={cx} cy={cy} r={r - 0.3} />
                          </clipPath>
                          <image
                            href={champIconUrl(version, d.participant.championName)}
                            x={cx - r}
                            y={cy - r}
                            width={r * 2}
                            height={r * 2}
                            clipPath={`url(#champ-clip-${pid})`}
                            preserveAspectRatio="xMidYMid slice"
                          />
                        </>
                      )}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={r}
                        fill="none"
                        stroke={d.isMe ? 'var(--brand)' : team}
                        strokeWidth={d.isMe ? 0.9 : 0.55}
                      />
                    </g>
                  )
                })}
                {mapNotes.map((note, i) => (
                  <g
                    key={`note-${i}`}
                    className="map-note"
                    onMouseMove={e => mapTip.show(e, note.title, [note.tip])}
                    onMouseLeave={mapTip.hide}
                  >
                    {note.from && (
                      <line
                        x1={sx(note.from.x)}
                        y1={sy(note.from.y)}
                        x2={sx(note.x)}
                        y2={sy(note.y)}
                        stroke="var(--status-warn)"
                        strokeWidth="0.4"
                        strokeDasharray="1.2 1"
                        opacity="0.8"
                      />
                    )}
                    <circle className="note-pulse" cx={sx(note.x)} cy={sy(note.y)} r="3.4" fill="none" stroke="var(--status-warn)" strokeWidth="0.5" />
                    <circle cx={sx(note.x)} cy={sy(note.y)} r="1.7" fill="var(--status-warn)" />
                    <text className="note-glyph" x={sx(note.x)} y={sy(note.y) + 0.85} textAnchor="middle">
                      !
                    </text>
                  </g>
                ))}
              </g>
              {spot && (
                <>
                  <defs>
                    <mask id="spotlight-mask">
                      <rect x="0" y="0" width="100" height="100" fill="white" />
                      <circle cx={spot.x} cy={spot.y} r="19" fill="black" />
                    </mask>
                  </defs>
                  <rect
                    className="spotlight"
                    x="0.5"
                    y="0.5"
                    width="99"
                    height="99"
                    rx="4"
                    fill="black"
                    opacity="0.4"
                    mask="url(#spotlight-mask)"
                  />
                </>
              )}
            </svg>
            <span className="map-clock">{mmss(clock)}</span>
            <div className="killfeed">
              {killfeed.map(k => (
                <div className="kf-entry" key={`${k.timestamp}-${k.victimId}`}>
                  {k.killerId >= 1 && k.killerId <= 10 ? (
                    <ChampIcon name={champByPid.get(k.killerId) ?? null} size={18} />
                  ) : (
                    <span className="kf-exec">⌀</span>
                  )}
                  <svg viewBox="0 0 10 10" className="kf-x" aria-hidden="true">
                    <path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  <ChampIcon name={champByPid.get(k.victimId) ?? null} size={18} />
                </div>
              ))}
            </div>
            {mapTip.node}
          </div>

          <div className="timeline-wrap">
            <svg
              viewBox={`0 0 ${TL_W} ${TL_H}`}
              className="timeline"
              role="img"
              aria-label="Your team's gold lead over time; click or drag to seek"
              onPointerDown={e => {
                scrubbing.current = true
                e.currentTarget.setPointerCapture(e.pointerId)
                seekFromPointer(e)
              }}
              onPointerMove={e => scrubbing.current && seekFromPointer(e)}
              onPointerUp={() => (scrubbing.current = false)}
            >
              <defs>
                <clipPath id="tl-above">
                  <rect x="0" y="0" width={TL_W} height={y0} />
                </clipPath>
                <clipPath id="tl-below">
                  <rect x="0" y={y0} width={TL_W} height={TL_H - y0} />
                </clipPath>
              </defs>
              <path d={leadArea} fill="var(--series-1)" opacity="0.25" clipPath="url(#tl-above)" />
              <path d={leadArea} fill="var(--series-2)" opacity="0.25" clipPath="url(#tl-below)" />
              <line x1="0" x2={TL_W} y1={y0} y2={y0} stroke="var(--grid)" strokeWidth="1" strokeDasharray="3 3" />
              <polyline fill="none" stroke="var(--ink-2)" strokeWidth="1.5" points={leadLine} />
              {clusters.map((c, i) => (
                <line
                  key={`cl-${i}`}
                  x1={tx(c[0]!.timestamp)}
                  x2={tx(c[0]!.timestamp)}
                  y1={plotBot + 4}
                  y2={plotBot + 9}
                  stroke="var(--baseline)"
                  strokeWidth="1.5"
                />
              ))}
              {activeMonsters.length >= 0 &&
                monsters.map((m, i) => (
                  <rect
                    key={`tl-obj-${i}`}
                    x={tx(m.timestamp) - 2.4}
                    y={ty(leadAt(m.timestamp)) - 2.4}
                    width="4.8"
                    height="4.8"
                    transform={`rotate(45 ${tx(m.timestamp)} ${ty(leadAt(m.timestamp))})`}
                    fill={m.team === me?.teamId ? 'var(--status-warn)' : 'var(--surface)'}
                    stroke="var(--status-warn)"
                    strokeWidth="1"
                    onMouseMove={e =>
                      timelineTip.show(e, `${mmss(m.timestamp)} — ${m.team === me?.teamId ? 'Objective secured' : 'Objective lost'}`, [
                        `Gold swing context: ${leadAt(m.timestamp) >= 0 ? '+' : ''}${Math.round(leadAt(m.timestamp)).toLocaleString()} at the time.`,
                      ])
                    }
                    onMouseLeave={timelineTip.hide}
                  />
                ))}
              {myKillMarks.map((k, i) => (
                <circle
                  key={`tl-k-${i}`}
                  cx={tx(k.timestamp)}
                  cy={ty(leadAt(k.timestamp))}
                  r="2.6"
                  fill="var(--status-good)"
                  stroke="var(--surface)"
                  strokeWidth="1"
                  onMouseMove={e =>
                    timelineTip.show(e, `${mmss(k.timestamp)} — You killed ${champByPid.get(k.victimId) ?? '?'}`, [])
                  }
                  onMouseLeave={timelineTip.hide}
                />
              ))}
              {myDeathMarks.map((k, i) => (
                <g
                  key={`tl-d-${i}`}
                  onMouseMove={e =>
                    timelineTip.show(e, `${mmss(k.timestamp)} — Died to ${champByPid.get(k.killerId) ?? 'the enemy team'}`, [])
                  }
                  onMouseLeave={timelineTip.hide}
                >
                  <circle cx={tx(k.timestamp)} cy={ty(leadAt(k.timestamp))} r="3.2" fill="var(--status-critical)" stroke="var(--surface)" strokeWidth="1" />
                  <path
                    d={`M ${tx(k.timestamp) - 1.2} ${ty(leadAt(k.timestamp)) - 1.2} l 2.4 2.4 M ${tx(k.timestamp) + 1.2} ${ty(leadAt(k.timestamp)) - 1.2} l -2.4 2.4`}
                    stroke="#ffffff"
                    strokeWidth="0.9"
                    strokeLinecap="round"
                  />
                </g>
              ))}
              <text x="4" y={plotTop + 6}>{`+${Math.round(maxLead / 1000)}k`}</text>
              <text x="4" y={plotBot}>{`-${Math.round(maxLead / 1000)}k`}</text>
              <line
                x1={tx(clock)}
                x2={tx(clock)}
                y1="2"
                y2={TL_H - 12}
                stroke="var(--brand)"
                strokeWidth="1.5"
              />
              <circle cx={tx(clock)} cy="4" r="3" fill="var(--brand)" />
            </svg>
            {timelineTip.node}
          </div>

          <div className="replay-controls">
            <button className="play-btn" onClick={() => (clock >= duration ? restart() : setPlaying(p => !p))}>
              {clock >= duration ? 'Replay' : playing ? 'Pause' : 'Play'}
            </button>
            <span className="replay-clock">
              {mmss(clock)} / {mmss(duration)}
            </span>
            <div className="speed-group">
              {SPEEDS.map(s => (
                <button key={s} className={`chip-btn${speed === s ? ' active' : ''}`} onClick={() => setSpeed(s)}>
                  {s}x
                </button>
              ))}
            </div>
            <button className={`chip-btn${showWards ? ' active' : ''}`} onClick={() => setShowWards(v => !v)}>
              Wards
            </button>
            <button className={`chip-btn${autoPause ? ' active' : ''}`} onClick={() => setAutoPause(v => !v)}>
              Pause at moments
            </button>
          </div>
        </div>

        <aside className="moment-list">
          {activeCluster ? (
            <div className="current-moment" key={activeCluster[0]!.title}>
              {activeCluster.map((moment, i) => (
                <div key={i} className="moment-entry">
                  <div className="moment-head">
                    <span
                      className="sev-chip"
                      style={{ background: KIND_STYLE[moment.kind].bg, color: KIND_STYLE[moment.kind].text }}
                    >
                      {KIND_STYLE[moment.kind].label}
                    </span>
                    <strong>{moment.title}</strong>
                    {i === 0 && clusterIndex >= 0 && (
                      <span className="moment-count">
                        {clusterIndex + 1} of {clusters.length}
                      </span>
                    )}
                  </div>
                  {moment.note && <p>{moment.note}</p>}
                </div>
              ))}
              <div className="moment-actions">
                {clock < duration ? (
                  <button className="play-btn" onClick={resume}>
                    Continue
                  </button>
                ) : (
                  <button className="play-btn" onClick={restart}>
                    Watch again
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="current-moment idle">
              Playing. The replay pauses itself at coaching moments and the notes land here; space
              toggles play, the gold chart scrubs.
            </div>
          )}
          <h4>Moments</h4>
          {moments
            .filter(m => m.autoPause || m.kind === 'kill')
            .map((m, i) => (
              <button
                key={i}
                className={`moment-item${m.timestamp <= clock ? ' past' : ''}${activeCluster?.includes(m) ? ' current' : ''}`}
                onClick={() => seek(m.timestamp, m.autoPause ? clusters.find(c => c.includes(m)) ?? null : null)}
              >
                <span className="moment-dot" style={{ background: KIND_STYLE[m.kind].bg }} />
                {m.title}
              </button>
            ))}
        </aside>
      </div>
    </>
  )
}

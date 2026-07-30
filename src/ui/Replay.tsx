// Full-screen match replay driven by timeline frames: all ten champions
// animate along their per-minute positions (as icon dots once Data Dragon
// resolves), kills, objectives, and towers ping the map, your champion drags
// a movement trail, and the replay auto-pauses at coaching moments.
//
// Movement model: positions are linearly interpolated between minute frames,
// EXCEPT across a "break" (a death, or an item purchase marking a base
// visit). Across a break the champion walks to the known death spot (when we
// have one), then teleports, instead of gliding across the whole map. The
// trail restarts at every break for the same reason.
//
// Pausing model: auto-pause moments are grouped into clusters (see
// clusterMoments) so a death and the objective that fell five seconds later
// are one card, and Continue always jumps past the entire story beat.

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  BuildingKillEvent,
  ChampionKillEvent,
  EliteMonsterKillEvent,
  ItemPurchasedEvent,
  MatchDto,
  Position,
  TimelineDto,
} from '../riot/types'
import { normalizeDuration } from '../riot/types'
import { buildMoments, clusterMoments, type Moment, type MomentKind } from '../analysis/moments'
import { ChampIcon, champIconUrl, useDdragonVersion } from './ddragon'
import { RiftBackdrop, sx, sy } from './RiftMap'

interface RawEntry {
  match: MatchDto
  timeline: TimelineDto
}

// 60 in-game seconds per real second at 1x: a 30 minute game replays in 30s.
const BASE_RATE = 60
const SPEEDS = [0.5, 1, 2, 4]
const PING_LIFE_MS = 30_000 // in-game lifetime of a kill ping
const TRAIL_FRAMES = 6 // minutes of movement history behind your champion

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

interface Break {
  ts: number
  pos?: Position
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

  const moments = useMemo(() => buildMoments(match, timeline, puuid), [match, timeline, puuid])
  const clusters = useMemo(() => clusterMoments(moments), [moments])

  const kills = useMemo(
    () =>
      timeline.info.frames.flatMap(f =>
        f.events
          .filter((e): e is ChampionKillEvent => e.type === 'CHAMPION_KILL')
          .map(e => ({ timestamp: e.timestamp, position: e.position, victimTeam: e.victimId <= 5 ? 100 : 200 })),
      ),
    [timeline],
  )
  const monsters = useMemo(
    () =>
      timeline.info.frames.flatMap(f =>
        f.events
          .filter((e): e is EliteMonsterKillEvent => e.type === 'ELITE_MONSTER_KILL')
          .map(e => ({ timestamp: e.timestamp, position: e.position, team: e.killerTeamId })),
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

  // Interpolation breaks per participant: deaths (with the exact death spot)
  // and base visits (first item purchase of a shopping trip).
  const breaks = useMemo(() => {
    const map = new Map<number, Break[]>()
    const push = (pid: number, b: Break) => {
      const list = map.get(pid) ?? []
      list.push(b)
      map.set(pid, list)
    }
    for (const frame of timeline.info.frames) {
      for (const event of frame.events) {
        if (event.type === 'CHAMPION_KILL') {
          const kill = event as ChampionKillEvent
          push(kill.victimId, { ts: kill.timestamp, pos: kill.position })
        } else if (event.type === 'ITEM_PURCHASED') {
          const buy = event as ItemPurchasedEvent
          const list = map.get(buy.participantId)
          const last = list?.[list.length - 1]
          // Collapse a shopping spree into one base visit.
          if (!last || buy.timestamp - last.ts > 3_000) push(buy.participantId, { ts: buy.timestamp })
        }
      }
    }
    for (const list of map.values()) list.sort((a, b) => a.ts - b.ts)
    return map
  }, [timeline])

  const firstBreak = (pid: number, from: number, to: number): Break | null =>
    breaks.get(pid)?.find(b => b.ts > from && b.ts <= to) ?? null

  // Blue team gold lead per frame, for the strip under the map.
  const goldDiff = useMemo(
    () =>
      timeline.info.frames.map(f => {
        let blue = 0
        let red = 0
        for (const pf of Object.values(f.participantFrames)) {
          if (pf.participantId <= 5) blue += pf.totalGold
          else red += pf.totalGold
        }
        return blue - red
      }),
    [timeline],
  )

  const [clock, setClock] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [autoPause, setAutoPause] = useState(true)
  const [activeCluster, setActiveCluster] = useState<Moment[] | null>(null)
  const clockRef = useRef(0)

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = now - last
      last = now
      const next = clockRef.current + dt * BASE_RATE * speed
      const crossed = autoPause
        ? clusters.find(c => c[0]!.timestamp > clockRef.current && c[0]!.timestamp <= next)
        : undefined
      if (crossed) {
        clockRef.current = crossed[0]!.timestamp
        setClock(crossed[0]!.timestamp)
        setActiveCluster(crossed)
        setPlaying(false)
        return
      }
      if (next >= duration) {
        clockRef.current = duration
        setClock(duration)
        setActiveCluster(clusters[clusters.length - 1] ?? null)
        setPlaying(false)
        return
      }
      clockRef.current = next
      setClock(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, autoPause, clusters, duration])

  const seek = (t: number, cluster: Moment[] | null = null) => {
    clockRef.current = t
    setClock(t)
    setActiveCluster(cluster)
    if (cluster) setPlaying(false)
  }

  const restart = () => {
    seek(0)
    setPlaying(true)
  }

  // Continue from a card: step past the WHOLE cluster so the crossing check
  // can't re-match any of it, then play.
  const resume = () => {
    const clusterEnd = activeCluster?.[activeCluster.length - 1]?.timestamp ?? clockRef.current
    clockRef.current = Math.min(duration, Math.max(clockRef.current, clusterEnd) + 250)
    setClock(clockRef.current)
    setActiveCluster(null)
    setPlaying(true)
  }

  // Space toggles play/pause (Escape close is handled by the wrapper).
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

  // Positions at `clock`: lerp between frames unless a break interrupts.
  const interval = timeline.info.frameInterval || 60_000
  const frames = timeline.info.frames
  const idx = Math.min(Math.floor(clock / interval), frames.length - 1)
  const nextIdx = Math.min(idx + 1, frames.length - 1)
  const tsA = idx * interval
  const tsB = nextIdx * interval

  const positionFor = (pid: number, a: Position, b: Position): Position => {
    const alpha = tsB === tsA ? 0 : Math.min(1, Math.max(0, (clock - tsA) / (tsB - tsA)))
    const brk = firstBreak(pid, tsA, tsB)
    if (!brk) {
      return { x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha }
    }
    if (clock < brk.ts) {
      if (!brk.pos) return a // heading to base: hold until the teleport
      const beta = brk.ts === tsA ? 1 : Math.min(1, (clock - tsA) / (brk.ts - tsA))
      return { x: a.x + (brk.pos.x - a.x) * beta, y: a.y + (brk.pos.y - a.y) * beta }
    }
    return b
  }

  const dots = match.info.participants.flatMap(p => {
    const a = frames[idx]?.participantFrames[String(p.participantId)]
    const b = frames[nextIdx]?.participantFrames[String(p.participantId)]
    if (!a || !b) return []
    const pos = positionFor(p.participantId, a.position, b.position)
    return [{ participant: p, x: pos.x, y: pos.y, isMe: p.puuid === puuid }]
  })

  // Movement history for your champion, split into segments at every break
  // (death or base visit) so the trail never draws impossible walks.
  const meDot = dots.find(d => d.isMe)
  const trailSegments: string[][] = [[]]
  if (me && meDot) {
    const pid = me.participantId
    const point = (p: Position) => `${sx(p.x)},${sy(p.y)}`
    for (let i = Math.max(0, idx - TRAIL_FRAMES); i < idx; i++) {
      const pf = frames[i]?.participantFrames[String(pid)]
      if (pf) trailSegments[trailSegments.length - 1]!.push(point(pf.position))
      const brk = firstBreak(pid, i * interval, (i + 1) * interval)
      if (brk) {
        if (brk.pos) trailSegments[trailSegments.length - 1]!.push(point(brk.pos))
        trailSegments.push([])
      }
    }
    const pfNow = frames[idx]?.participantFrames[String(pid)]
    if (pfNow) trailSegments[trailSegments.length - 1]!.push(point(pfNow.position))
    const brkNow = firstBreak(pid, tsA, Math.min(clock, tsB))
    if (brkNow) {
      if (brkNow.pos) trailSegments[trailSegments.length - 1]!.push(point(brkNow.pos))
      trailSegments.push([])
    }
    trailSegments[trailSegments.length - 1]!.push(point({ x: meDot.x, y: meDot.y }))
  }

  const activePings = kills.filter(k => clock >= k.timestamp && clock - k.timestamp < PING_LIFE_MS)
  const activeMonsters = monsters.filter(m => clock >= m.timestamp && clock - m.timestamp < PING_LIFE_MS * 1.5)
  const activeTowers = towers.filter(t => clock >= t.timestamp && clock - t.timestamp < PING_LIFE_MS * 1.5)
  const maxGold = Math.max(1000, ...goldDiff.map(Math.abs))
  const clusterIndex = activeCluster ? clusters.indexOf(activeCluster) : -1

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
                  <g key={pid}>
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
            </svg>

            {activeCluster && (
              <div className="moment-card" key={activeCluster[0]!.title}>
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
                  <label className="autopause-toggle">
                    <input type="checkbox" checked={autoPause} onChange={e => setAutoPause(e.target.checked)} />
                    Pause at moments
                  </label>
                </div>
              </div>
            )}
          </div>

          <svg className="gold-strip" viewBox="0 0 560 44" role="img" aria-label="Blue team gold lead over time">
            <line x1="0" x2="560" y1="22" y2="22" stroke="var(--grid)" strokeWidth="1" strokeDasharray="3 3" />
            <polyline
              fill="none"
              stroke="var(--muted)"
              strokeWidth="1.5"
              points={goldDiff
                .map((g, i) => `${(i / Math.max(1, goldDiff.length - 1)) * 560},${22 - (g / maxGold) * 18}`)
                .join(' ')}
            />
            <line
              x1={(clock / duration) * 560}
              x2={(clock / duration) * 560}
              y1="2"
              y2="42"
              stroke="var(--brand)"
              strokeWidth="1.5"
            />
            <text x="4" y="10">
              {me?.teamId === 100 ? 'your team' : 'enemy team'} gold lead up
            </text>
          </svg>

          <div className="replay-controls">
            <button className="play-btn" onClick={() => (clock >= duration ? restart() : setPlaying(p => !p))}>
              {clock >= duration ? 'Replay' : playing ? 'Pause' : 'Play'}
            </button>
            <span className="replay-clock">
              {mmss(clock)} / {mmss(duration)}
            </span>
            <input
              className="scrubber"
              type="range"
              min={0}
              max={duration}
              step={1000}
              value={clock}
              onChange={e => seek(Number(e.target.value))}
            />
            <div className="speed-group">
              {SPEEDS.map(s => (
                <button
                  key={s}
                  className={`chip-btn${speed === s ? ' active' : ''}`}
                  onClick={() => setSpeed(s)}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
        </div>

        <aside className="moment-list">
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

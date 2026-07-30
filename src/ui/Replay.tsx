// Full-screen match replay driven by timeline frames: all ten champions
// animate along their per-minute positions (as icon dots once Data Dragon
// resolves), kills, objectives, and towers ping the map, your champion drags
// a movement trail, and the replay auto-pauses at coaching moments. The
// analysis lives in src/analysis/moments.ts; this component is playback.

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  BuildingKillEvent,
  ChampionKillEvent,
  EliteMonsterKillEvent,
  MatchDto,
  TimelineDto,
} from '../riot/types'
import { normalizeDuration } from '../riot/types'
import { buildMoments, type Moment, type MomentKind } from '../analysis/moments'
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
  const pauseMoments = useMemo(() => moments.filter(m => m.autoPause), [moments])

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
  const [activeMoment, setActiveMoment] = useState<Moment | null>(null)
  const clockRef = useRef(0)

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = now - last
      last = now
      let next = clockRef.current + dt * BASE_RATE * speed
      const crossed = autoPause
        ? moments.find(m => m.autoPause && m.timestamp > clockRef.current && m.timestamp <= next)
        : undefined
      if (crossed) {
        clockRef.current = crossed.timestamp
        setClock(crossed.timestamp)
        setActiveMoment(crossed)
        setPlaying(false)
        return
      }
      if (next >= duration) {
        clockRef.current = duration
        setClock(duration)
        setActiveMoment(moments[moments.length - 1] ?? null)
        setPlaying(false)
        return
      }
      clockRef.current = next
      setClock(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, autoPause, moments, duration])

  const seek = (t: number, moment: Moment | null = null) => {
    clockRef.current = t
    setClock(t)
    setActiveMoment(moment)
    if (moment) setPlaying(false)
  }

  const restart = () => {
    seek(0)
    setPlaying(true)
  }

  // Resume from a moment card. The tiny clock nudge steps past the paused
  // moment so the crossing check can't re-match it, and playback visibly
  // advances even when the next moment is seconds away.
  const resume = () => {
    clockRef.current = Math.min(duration, clockRef.current + 250)
    setClock(clockRef.current)
    setActiveMoment(null)
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
        setActiveMoment(null)
        setPlaying(p => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration])

  // Interpolated positions for everyone on the map at `clock`.
  const interval = timeline.info.frameInterval || 60_000
  const frames = timeline.info.frames
  const idx = Math.min(Math.floor(clock / interval), frames.length - 1)
  const nextIdx = Math.min(idx + 1, frames.length - 1)
  const alpha = nextIdx === idx ? 0 : Math.min(1, Math.max(0, (clock - idx * interval) / interval))
  const dots = match.info.participants.flatMap(p => {
    const a = frames[idx]?.participantFrames[String(p.participantId)]
    const b = frames[nextIdx]?.participantFrames[String(p.participantId)]
    if (!a || !b) return []
    return [
      {
        participant: p,
        x: a.position.x + (b.position.x - a.position.x) * alpha,
        y: a.position.y + (b.position.y - a.position.y) * alpha,
        isMe: p.puuid === puuid,
      },
    ]
  })

  // Movement history for your champion: the last few minutes of positions.
  const meDot = dots.find(d => d.isMe)
  const trail: string[] = []
  if (me && meDot) {
    for (let i = Math.max(0, idx - TRAIL_FRAMES); i <= idx; i++) {
      const pf = frames[i]?.participantFrames[String(me.participantId)]
      if (pf) trail.push(`${sx(pf.position.x)},${sy(pf.position.y)}`)
    }
    trail.push(`${sx(meDot.x)},${sy(meDot.y)}`)
  }

  const activePings = kills.filter(k => clock >= k.timestamp && clock - k.timestamp < PING_LIFE_MS)
  const activeMonsters = monsters.filter(m => clock >= m.timestamp && clock - m.timestamp < PING_LIFE_MS * 1.5)
  const activeTowers = towers.filter(t => clock >= t.timestamp && clock - t.timestamp < PING_LIFE_MS * 1.5)
  const maxGold = Math.max(1000, ...goldDiff.map(Math.abs))
  const momentIndex = activeMoment ? pauseMoments.indexOf(activeMoment) : -1

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
              {trail.length > 1 && (
                <polyline
                  points={trail.join(' ')}
                  fill="none"
                  stroke="var(--brand)"
                  strokeWidth="0.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="1.7 1.1"
                  opacity="0.5"
                />
              )}
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

            {activeMoment && (
              <div className="moment-card" key={activeMoment.title}>
                <div className="moment-head">
                  <span
                    className="sev-chip"
                    style={{ background: KIND_STYLE[activeMoment.kind].bg, color: KIND_STYLE[activeMoment.kind].text }}
                  >
                    {KIND_STYLE[activeMoment.kind].label}
                  </span>
                  <strong>{activeMoment.title}</strong>
                  {momentIndex >= 0 && (
                    <span className="moment-count">
                      {momentIndex + 1} of {pauseMoments.length}
                    </span>
                  )}
                </div>
                {activeMoment.note && <p>{activeMoment.note}</p>}
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
                className={`moment-item${m.timestamp <= clock ? ' past' : ''}${activeMoment === m ? ' current' : ''}`}
                onClick={() => seek(m.timestamp, m.autoPause ? m : null)}
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

// Full-screen match replay driven by timeline frames: all ten champions
// animate along their per-minute positions, kills and objectives ping the
// map, and the replay auto-pauses at coaching moments. The analysis lives
// in src/analysis/moments.ts; this component is playback and presentation.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChampionKillEvent, EliteMonsterKillEvent, MatchDto, TimelineDto } from '../riot/types'
import { normalizeDuration } from '../riot/types'
import { buildMoments, type Moment, type MomentKind } from '../analysis/moments'
import { RiftBackdrop, sx, sy } from './RiftMap'

interface RawEntry {
  match: MatchDto
  timeline: TimelineDto
}

// 60 in-game seconds per real second at 1x: a 30 minute game replays in 30s.
const BASE_RATE = 60
const SPEEDS = [0.5, 1, 2, 4]
const PING_LIFE_MS = 30_000 // in-game lifetime of a kill ping

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
  const duration = normalizeDuration(match.info.gameDuration) * 1000
  const me = match.info.participants.find(p => p.puuid === puuid)
  const opp = me
    ? match.info.participants.find(p => p.teamId !== me.teamId && p.teamPosition === me.teamPosition)
    : undefined

  const moments = useMemo(() => buildMoments(match, timeline, puuid), [match, timeline, puuid])

  const kills = useMemo(
    () =>
      timeline.info.frames.flatMap(f =>
        f.events
          .filter((e): e is ChampionKillEvent => e.type === 'CHAMPION_KILL')
          .map(e => ({ timestamp: e.timestamp, position: e.position, victimTeam: e.victimId <= 5 ? 100 : 200, mine: false })),
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

  // Interpolated positions for everyone alive on the map at `clock`.
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

  const activePings = kills.filter(k => clock >= k.timestamp && clock - k.timestamp < PING_LIFE_MS)
  const activeMonsters = monsters.filter(m => clock >= m.timestamp && clock - m.timestamp < PING_LIFE_MS * 1.5)
  const maxGold = Math.max(1000, ...goldDiff.map(Math.abs))

  return (
    <>
      <header className="replay-head">
        <div className="replay-title">
          <span className="replay-matchup">
            {me?.championName ?? '?'} <span className="vs">vs {opp?.championName ?? '?'}</span>
          </span>
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
              {activeMonsters.map((m, i) => {
                const age = (clock - m.timestamp) / (PING_LIFE_MS * 1.5)
                return (
                  <g key={`mon-${i}`} opacity={1 - age}>
                    <rect
                      x={sx(m.position.x) - 1.8}
                      y={sy(m.position.y) - 1.8}
                      width="3.6"
                      height="3.6"
                      transform={`rotate(45 ${sx(m.position.x)} ${sy(m.position.y)})`}
                      fill="none"
                      stroke={m.team === 100 ? 'var(--series-1)' : 'var(--series-2)'}
                      strokeWidth="0.7"
                    />
                  </g>
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
              {dots.map(d => (
                <g key={d.participant.participantId}>
                  <circle
                    cx={sx(d.x)}
                    cy={sy(d.y)}
                    r={d.isMe ? 2.6 : 2}
                    fill={d.participant.teamId === 100 ? 'var(--series-1)' : 'var(--series-2)'}
                    stroke={d.isMe ? 'var(--brand)' : 'var(--surface)'}
                    strokeWidth={d.isMe ? 0.9 : 0.5}
                  >
                    <title>{d.participant.championName}</title>
                  </circle>
                  {d.isMe && (
                    <text className="you-label" x={sx(d.x)} y={sy(d.y) - 3.4} textAnchor="middle">
                      YOU
                    </text>
                  )}
                </g>
              ))}
            </svg>

            {activeMoment && (
              <div className="moment-card">
                <div className="moment-head">
                  <span
                    className="sev-chip"
                    style={{ background: KIND_STYLE[activeMoment.kind].bg, color: KIND_STYLE[activeMoment.kind].text }}
                  >
                    {KIND_STYLE[activeMoment.kind].label}
                  </span>
                  <strong>{activeMoment.title}</strong>
                </div>
                {activeMoment.note && <p>{activeMoment.note}</p>}
                <div className="moment-actions">
                  {clock < duration ? (
                    <button
                      className="play-btn"
                      onClick={() => {
                        setActiveMoment(null)
                        setPlaying(true)
                      }}
                    >
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

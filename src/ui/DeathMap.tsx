import { useState } from 'react'
import type { MatchReport } from '../analysis/report'
import type { Phase } from '../analysis/metrics'
import { RiftBackdrop, sx, sy } from './RiftMap'
import { useTooltip } from './shared'

// Categorical slots 1-3, the all-pairs-safe subset in both modes.
const PHASES: { key: Phase; label: string; color: string }[] = [
  { key: 'early', label: 'Before 14:00', color: 'var(--series-1)' },
  { key: 'mid', label: '14:00 to 25:00', color: 'var(--series-2)' },
  { key: 'late', label: 'After 25:00', color: 'var(--series-3)' },
]

export function DeathMap({ matches }: { matches: MatchReport[] }) {
  const tooltip = useTooltip()
  const [hidden, setHidden] = useState<Set<Phase>>(new Set())

  const togglePhase = (phase: Phase) =>
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(phase)) next.delete(phase)
      else next.add(phase)
      return next
    })

  const all = matches.flatMap(m =>
    m.deathList.map(d => ({ ...d, championName: m.championName, win: m.win })),
  )
  const deaths = all.filter(d => !hidden.has(d.phase))

  return (
    <div className="panel">
      <h3>Where you die</h3>
      <div className="panel-sub">
        {hidden.size ? `${deaths.length} of ${all.length}` : all.length} deaths across{' '}
        {matches.length} games. Blue base bottom-left. Click a phase to toggle it.
      </div>
      <svg viewBox="0 0 100 100" role="img" aria-label="Map of death locations on Summoner's Rift">
        <RiftBackdrop />
        {deaths.map((death, i) => (
          <circle
            key={i}
            cx={sx(death.x)}
            cy={sy(death.y)}
            r="1.9"
            fill={PHASES.find(p => p.key === death.phase)!.color}
            stroke="var(--surface)"
            strokeWidth="0.5"
            onMouseMove={e =>
              tooltip.show(e, `${death.championName} died at ${Math.floor(death.minute)}:${String(Math.floor((death.minute % 1) * 60)).padStart(2, '0')}`, [
                `${death.enemySide ? 'Enemy side of the map' : 'Own side of the map'} · ${death.win ? 'win' : 'loss'}`,
              ])
            }
            onMouseLeave={tooltip.hide}
          />
        ))}
      </svg>
      <div className="legend">
        {PHASES.map(p => (
          <button
            className={`item legend-toggle${hidden.has(p.key) ? ' off' : ''}`}
            key={p.key}
            onClick={() => togglePhase(p.key)}
          >
            <span className="swatch" style={{ background: p.color }} />
            {p.label}
          </button>
        ))}
      </div>
      {tooltip.node}
    </div>
  )
}

import type { MatchReport } from '../analysis/report'
import type { Phase } from '../analysis/metrics'
import { MAP_MAX } from '../analysis/metrics'
import { useTooltip } from './shared'

// Categorical slots 1-3, the all-pairs-safe subset in both modes.
const PHASES: { key: Phase; label: string; color: string }[] = [
  { key: 'early', label: 'Before 14:00', color: 'var(--series-1)' },
  { key: 'mid', label: '14:00 to 25:00', color: 'var(--series-2)' },
  { key: 'late', label: 'After 25:00', color: 'var(--series-3)' },
]

// Game coords: blue base at origin (bottom-left), red base top-right.
// SVG y grows downward, so flip y.
const sx = (x: number) => (x / MAP_MAX) * 100
const sy = (y: number) => 100 - (y / MAP_MAX) * 100

export function DeathMap({ matches }: { matches: MatchReport[] }) {
  const tooltip = useTooltip()
  const deaths = matches.flatMap(m =>
    m.deathList.map(d => ({ ...d, championName: m.championName, win: m.win })),
  )

  return (
    <div className="panel">
      <h3>Where you die</h3>
      <div className="panel-sub">
        {deaths.length} deaths across {matches.length} games. Blue base bottom-left.
      </div>
      <svg viewBox="0 0 100 100" role="img" aria-label="Map of death locations on Summoner's Rift">
        <rect x="0.5" y="0.5" width="99" height="99" rx="3" fill="var(--page)" stroke="var(--border)" />
        {/* River along the anti-diagonal, lanes as recessive guides. */}
        <line x1="0" y1="0" x2="100" y2="100" stroke="var(--grid)" strokeWidth="9" opacity="0.7" />
        <path d="M 8 92 L 8 8 L 92 8" fill="none" stroke="var(--grid)" strokeWidth="5" opacity="0.7" />
        <path d="M 8 92 L 92 92 L 92 8" fill="none" stroke="var(--grid)" strokeWidth="5" opacity="0.7" />
        <line x1="8" y1="92" x2="92" y2="8" stroke="var(--grid)" strokeWidth="5" opacity="0.7" />
        <circle cx="7" cy="93" r="6" fill="var(--grid)" />
        <circle cx="93" cy="7" r="6" fill="var(--grid)" />
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
          <span className="item" key={p.key}>
            <span className="swatch" style={{ background: p.color }} />
            {p.label}
          </span>
        ))}
      </div>
      {tooltip.node}
    </div>
  )
}

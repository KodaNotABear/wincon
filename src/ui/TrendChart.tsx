import type { MatchReport } from '../analysis/report'
import { fmtSigned, useTooltip } from './shared'

const W = 560
const H = 210
const TOP = 16
const BOTTOM = 26
const LEFT = 34

/** Bar with a rounded far end, anchored square to the zero baseline. */
function barPath(x: number, y0: number, height: number, width: number, up: boolean): string {
  const r = Math.min(2.5, width / 2, height)
  const yEnd = up ? y0 - height : y0 + height
  const sweep = up ? 1 : 0
  const dir = up ? 1 : -1
  return [
    `M ${x} ${y0}`,
    `L ${x} ${yEnd + dir * r}`,
    `A ${r} ${r} 0 0 ${sweep} ${x + r} ${yEnd}`,
    `L ${x + width - r} ${yEnd}`,
    `A ${r} ${r} 0 0 ${sweep} ${x + width} ${yEnd + dir * r}`,
    `L ${x + width} ${y0}`,
    'Z',
  ].join(' ')
}

export function TrendChart({ matches }: { matches: MatchReport[] }) {
  const tooltip = useTooltip()
  // Report order is newest first; plot oldest to newest, left to right.
  const games = [...matches].reverse()
  const values = games.map(m => m.laning.csDiff10)
  const maxAbs = Math.max(10, ...values.filter((v): v is number => v !== null).map(Math.abs))

  const plotW = W - LEFT - 8
  const plotH = H - TOP - BOTTOM
  const y0 = TOP + plotH / 2
  const scale = plotH / 2 / maxAbs
  const step = plotW / games.length
  const barW = Math.max(3, Math.min(16, step - 2))

  return (
    <div className="panel">
      <h3>Laning trend</h3>
      <div className="panel-sub">CS difference vs your lane opponent at 10:00, oldest game first.</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="CS difference at ten minutes per game">
        {[maxAbs, 0, -maxAbs].map(v => (
          <g key={v}>
            <line
              x1={LEFT}
              x2={W - 8}
              y1={y0 - v * scale}
              y2={y0 - v * scale}
              stroke={v === 0 ? 'var(--baseline)' : 'var(--grid)'}
              strokeWidth="1"
            />
            <text x={LEFT - 6} y={y0 - v * scale + 3} textAnchor="end">
              {fmtSigned(v, 0)}
            </text>
          </g>
        ))}
        {games.map((m, i) => {
          const v = m.laning.csDiff10
          const x = LEFT + i * step + (step - barW) / 2
          if (v === null) {
            // No lane opponent (or a remake): show a neutral tick, not a zero bar.
            return <circle key={m.matchId} cx={x + barW / 2} cy={y0} r="1.5" fill="var(--baseline)" />
          }
          const up = v >= 0
          const height = Math.max(1.5, Math.abs(v) * scale)
          return (
            <g key={m.matchId}>
              <path d={barPath(x, y0, height, barW, up)} fill={m.win ? 'var(--series-1)' : 'var(--series-2)'} />
              {/* Full-height invisible hit target so hover doesn't require pixel aim. */}
              <rect
                x={LEFT + i * step}
                y={TOP}
                width={step}
                height={plotH}
                fill="transparent"
                onMouseMove={e =>
                  tooltip.show(e, `${m.championName} vs ${m.opponentChampion ?? '?'}`, [
                    `${m.win ? 'Win' : 'Loss'} · ${fmtSigned(v, 0)} CS at 10:00`,
                    new Date(m.gameCreation).toLocaleDateString(),
                  ])
                }
                onMouseLeave={tooltip.hide}
              />
            </g>
          )
        })}
      </svg>
      <div className="legend">
        <span className="item">
          <span className="swatch" style={{ background: 'var(--series-1)' }} />
          Win
        </span>
        <span className="item">
          <span className="swatch" style={{ background: 'var(--series-2)' }} />
          Loss
        </span>
        <span className="item">
          <span className="swatch" style={{ background: 'var(--baseline)' }} />
          No lane opponent
        </span>
      </div>
      {tooltip.node}
    </div>
  )
}

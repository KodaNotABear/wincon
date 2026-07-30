import type { MatchReport } from '../analysis/report'
import { fmtSigned, useTooltip } from './shared'

const W = 560
const H = 210
const TOP = 16
const BOTTOM = 26
const LEFT = 40

export type TrendMetric = 'csDiff10' | 'goldDiff14'

const METRICS: Record<TrendMetric, { label: string; sub: string; floor: number; pick: (m: MatchReport) => number | null }> = {
  csDiff10: {
    label: 'CS diff at 10:00',
    sub: 'CS difference vs your lane opponent at 10:00, oldest game first.',
    floor: 10,
    pick: m => m.laning.csDiff10,
  },
  goldDiff14: {
    label: 'Gold diff at 14:00',
    sub: 'Gold difference vs your lane opponent at 14:00, oldest game first.',
    floor: 400,
    pick: m => m.laning.goldDiff14,
  },
}

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

export function TrendChart({
  matches,
  metric,
  onMetricChange,
}: {
  matches: MatchReport[]
  metric: TrendMetric
  onMetricChange: (m: TrendMetric) => void
}) {
  const tooltip = useTooltip()
  const spec = METRICS[metric]
  // Report order is newest first; plot oldest to newest, left to right.
  const games = [...matches].reverse()
  const values = games.map(spec.pick)
  const maxAbs = Math.max(spec.floor, ...values.filter((v): v is number => v !== null).map(Math.abs))

  const plotW = W - LEFT - 8
  const plotH = H - TOP - BOTTOM
  const y0 = TOP + plotH / 2
  const scale = plotH / 2 / maxAbs
  const step = games.length ? plotW / games.length : plotW
  const barW = Math.max(3, Math.min(16, step - 2))

  const axisLabel = (v: number) =>
    metric === 'goldDiff14' && Math.abs(v) >= 1000 ? `${fmtSigned(v / 1000, 1)}k` : fmtSigned(v, 0)

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Laning trend</h3>
        <select
          className="mini-select"
          value={metric}
          onChange={e => onMetricChange(e.target.value as TrendMetric)}
        >
          {Object.entries(METRICS).map(([key, m]) => (
            <option key={key} value={key}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="panel-sub">{spec.sub}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${spec.label} per game`}>
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
              {axisLabel(v)}
            </text>
          </g>
        ))}
        {games.map((m, i) => {
          const v = spec.pick(m)
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
                    `${m.win ? 'Win' : 'Loss'} · ${axisLabel(v)} (${spec.label.toLowerCase()})`,
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

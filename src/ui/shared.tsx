import { useState, type ReactNode } from 'react'
import type { Severity } from '../analysis/insights'

// Status colors are the reserved status palette; they never impersonate a
// series and always ship next to a text label.
export const SEVERITY: Record<Severity, { label: string; color: string }> = {
  bad: { label: 'Fix this', color: 'var(--status-critical)' },
  warn: { label: 'Watch', color: 'var(--status-warn)' },
  info: { label: 'Note', color: 'var(--baseline)' },
  good: { label: 'Strength', color: 'var(--status-good)' },
}

export function SeverityChip({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity]
  return (
    <span className="chip">
      <span className="dot" style={{ background: s.color }} />
      {s.label.toUpperCase()}
    </span>
  )
}

export const fmtSigned = (x: number, digits = 1) => (x >= 0 ? '+' : '') + x.toFixed(digits)

export interface TipState {
  x: number
  y: number
  title: string
  lines: string[]
}

/** Shared hover tooltip, positioned relative to the chart panel. */
export function useTooltip() {
  const [tip, setTip] = useState<TipState | null>(null)
  const show = (e: React.MouseEvent, title: string, lines: string[]) => {
    const host = (e.currentTarget as Element).closest('.panel')
    if (!host) return
    const rect = host.getBoundingClientRect()
    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, title, lines })
  }
  const hide = () => setTip(null)
  const node: ReactNode = tip && (
    <div className="tooltip" style={{ left: tip.x, top: tip.y }}>
      <div className="tip-title">{tip.title}</div>
      {tip.lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  )
  return { show, hide, node }
}

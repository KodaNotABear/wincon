import { useEffect, useState, type ReactNode } from 'react'
import type { Severity } from '../analysis/insights'

// Status colors are the reserved status palette; they never impersonate a
// series and always ship next to a text label. Filled chips pick their text
// color for contrast against the fill in both modes.
export const SEVERITY: Record<Severity, { label: string; color: string; textOnFill: string }> = {
  bad: { label: 'Fix this', color: 'var(--status-critical)', textOnFill: '#ffffff' },
  warn: { label: 'Watch', color: 'var(--status-warn)', textOnFill: '#0b0b0b' },
  info: { label: 'Note', color: 'var(--baseline)', textOnFill: 'var(--ink)' },
  good: { label: 'Strength', color: 'var(--status-good)', textOnFill: '#ffffff' },
}

export function SeverityChip({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity]
  return (
    <span className="sev-chip" style={{ background: s.color, color: s.textOnFill }}>
      {s.label.toUpperCase()}
    </span>
  )
}

export const fmtSigned = (x: number, digits = 1) => (x >= 0 ? '+' : '') + x.toFixed(digits)

const REDUCED_MOTION =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Eases a number from 0 to its target on mount / target change. */
export function useCountUp(target: number | null, duration = 650): number | null {
  const [value, setValue] = useState<number | null>(REDUCED_MOTION ? target : target === null ? null : 0)
  useEffect(() => {
    if (target === null || REDUCED_MOTION) {
      setValue(target)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 3
      setValue(target * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

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
    const host = (e.currentTarget as Element).closest('.panel, .replay-map')
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

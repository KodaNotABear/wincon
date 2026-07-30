import { MAP_MAX } from '../analysis/metrics'

// Game coords: blue base at origin (bottom-left), red base top-right.
// SVG y grows downward, so flip y. Both map views share this projection.
export const sx = (x: number) => (x / MAP_MAX) * 100
export const sy = (y: number) => 100 - (y / MAP_MAX) * 100

// Real pit locations from timeline event positions.
export const DRAGON_PIT = { x: sx(9866), y: sy(4414) }
export const BARON_PIT = { x: sx(5007), y: sy(10471) }

/**
 * Stylized Summoner's Rift: river along the anti-diagonal, cornered lanes,
 * team base arcs, and the two objective pits. Colors come from map tokens so
 * both themes read as terrain rather than chrome.
 */
export function RiftBackdrop() {
  return (
    <>
      <rect x="0.5" y="0.5" width="99" height="99" rx="4" fill="var(--map-bg)" stroke="var(--border)" />
      {/* River */}
      <line x1="-4" y1="-4" x2="104" y2="104" stroke="var(--map-river)" strokeWidth="11" />
      {/* Lanes: top hugs left+top edges, bot hugs bottom+right, mid cuts across */}
      <path d="M 9 82 L 9 15 Q 9 9 15 9 L 82 9" fill="none" stroke="var(--map-lane)" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M 18 91 L 85 91 Q 91 91 91 85 L 91 18" fill="none" stroke="var(--map-lane)" strokeWidth="4.5" strokeLinecap="round" />
      <line x1="15" y1="85" x2="85" y2="15" stroke="var(--map-lane)" strokeWidth="4.5" strokeLinecap="round" />
      {/* Bases */}
      <path d="M 0 76 A 24 24 0 0 1 24 100 L 0 100 Z" fill="var(--series-1)" opacity="0.16" />
      <path d="M 76 0 A 24 24 0 0 0 100 24 L 100 0 Z" fill="var(--series-2)" opacity="0.16" />
      {/* Objective pits: dragon bottom river, baron top river */}
      <g opacity="0.55">
        <circle cx={DRAGON_PIT.x} cy={DRAGON_PIT.y} r="3.4" fill="none" stroke="var(--muted)" strokeWidth="0.6" strokeDasharray="1.4 1" />
        <path
          d={`M ${DRAGON_PIT.x} ${DRAGON_PIT.y - 1.5} L ${DRAGON_PIT.x + 1.3} ${DRAGON_PIT.y} L ${DRAGON_PIT.x} ${DRAGON_PIT.y + 1.5} L ${DRAGON_PIT.x - 1.3} ${DRAGON_PIT.y} Z`}
          fill="var(--muted)"
        />
        <circle cx={BARON_PIT.x} cy={BARON_PIT.y} r="3.4" fill="none" stroke="var(--muted)" strokeWidth="0.6" strokeDasharray="1.4 1" />
        <path
          d={`M ${BARON_PIT.x - 1.4} ${BARON_PIT.y + 1.2} L ${BARON_PIT.x - 1.4} ${BARON_PIT.y - 0.6} L ${BARON_PIT.x - 0.5} ${BARON_PIT.y + 0.2} L ${BARON_PIT.x} ${BARON_PIT.y - 1.4} L ${BARON_PIT.x + 0.5} ${BARON_PIT.y + 0.2} L ${BARON_PIT.x + 1.4} ${BARON_PIT.y - 0.6} L ${BARON_PIT.x + 1.4} ${BARON_PIT.y + 1.2} Z`}
          fill="var(--muted)"
        />
      </g>
    </>
  )
}

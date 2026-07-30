import { MAP_MAX } from '../analysis/metrics'

// Game coords: blue base at origin (bottom-left), red base top-right.
// SVG y grows downward, so flip y. Both map views share this projection.
export const sx = (x: number) => (x / MAP_MAX) * 100
export const sy = (y: number) => 100 - (y / MAP_MAX) * 100

/** Stylized Summoner's Rift: river along the anti-diagonal, lanes as guides. */
export function RiftBackdrop() {
  return (
    <>
      <rect x="0.5" y="0.5" width="99" height="99" rx="3" fill="var(--page)" stroke="var(--border)" />
      <line x1="0" y1="0" x2="100" y2="100" stroke="var(--grid)" strokeWidth="9" opacity="0.7" />
      <path d="M 8 92 L 8 8 L 92 8" fill="none" stroke="var(--grid)" strokeWidth="5" opacity="0.7" />
      <path d="M 8 92 L 92 92 L 92 8" fill="none" stroke="var(--grid)" strokeWidth="5" opacity="0.7" />
      <line x1="8" y1="92" x2="92" y2="8" stroke="var(--grid)" strokeWidth="5" opacity="0.7" />
      <circle cx="7" cy="93" r="6" fill="var(--grid)" />
      <circle cx="93" cy="7" r="6" fill="var(--grid)" />
    </>
  )
}

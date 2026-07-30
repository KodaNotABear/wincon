import type { Role } from '../riot/types'

// Heuristic per-role targets, tuned for "what should climb out of Emerald".
// These are intentionally opinionated coaching thresholds, not scraped
// percentiles; a future version can replace them with cohort data sampled
// from the ranked ladder (see README roadmap).
export interface RoleBenchmark {
  /** CS at 10:00 that keeps you even (solid) or ahead (strong). */
  cs10?: { solid: number; strong: number }
  visionPerMin: { solid: number; strong: number }
}

export const BENCHMARKS: Record<Exclude<Role, ''>, RoleBenchmark> = {
  TOP: { cs10: { solid: 62, strong: 75 }, visionPerMin: { solid: 0.8, strong: 1.2 } },
  MIDDLE: { cs10: { solid: 65, strong: 80 }, visionPerMin: { solid: 0.9, strong: 1.3 } },
  BOTTOM: { cs10: { solid: 68, strong: 82 }, visionPerMin: { solid: 0.9, strong: 1.3 } },
  // Junglers farm camps on a different curve; cs10 targets full clears + counterjungle.
  JUNGLE: { cs10: { solid: 55, strong: 68 }, visionPerMin: { solid: 1.1, strong: 1.6 } },
  UTILITY: { visionPerMin: { solid: 1.8, strong: 2.4 } },
}

export function benchmarkFor(role: Role): RoleBenchmark | undefined {
  return role ? BENCHMARKS[role] : undefined
}

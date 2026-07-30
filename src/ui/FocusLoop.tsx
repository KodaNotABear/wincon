import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildAggregate, type Aggregate, type MatchReport } from '../analysis/report'

export type FocusMetric = 'earlyDeaths' | 'csDiff10' | 'objectives' | 'vision'

export interface FocusGoal {
  metric: FocusMetric
  label: string
  startedAt: number
  baseline: number
  target: number
  direction: 'up' | 'down'
}

interface FocusOption {
  metric: FocusMetric
  label: string
  detail: string
  baseline: number | null
  target: number | null
  direction: FocusGoal['direction']
}

const STORAGE_PREFIX = 'wincon-focus:v1:'

export const focusValue = (metric: FocusMetric, aggregate: Aggregate): number | null => {
  switch (metric) {
    case 'earlyDeaths':
      return aggregate.games ? aggregate.deathsByPhasePerGame.early : null
    case 'csDiff10':
      return aggregate.avgCsDiff10
    case 'objectives':
      return aggregate.objectiveParticipation
    case 'vision':
      return aggregate.games ? aggregate.avgVisionPerMin : null
  }
}

export const focusOptions = (aggregate: Aggregate): FocusOption[] => [
  {
    metric: 'earlyDeaths',
    label: 'Survive the lane',
    detail: 'Deaths before 14:00',
    baseline: focusValue('earlyDeaths', aggregate),
    target: Math.max(0, aggregate.deathsByPhasePerGame.early - 0.5),
    direction: 'down',
  },
  {
    metric: 'csDiff10',
    label: 'Stabilize lane farm',
    detail: 'CS difference at 10:00',
    baseline: focusValue('csDiff10', aggregate),
    target: aggregate.avgCsDiff10 === null ? null : aggregate.avgCsDiff10 + 5,
    direction: 'up',
  },
  {
    metric: 'objectives',
    label: 'Arrive before spawn',
    detail: 'Objective participation',
    baseline: focusValue('objectives', aggregate),
    target:
      aggregate.objectiveParticipation === null
        ? null
        : Math.min(1, aggregate.objectiveParticipation + 0.1),
    direction: 'up',
  },
  {
    metric: 'vision',
    label: 'Own the dark',
    detail: 'Vision score per minute',
    baseline: focusValue('vision', aggregate),
    target: aggregate.avgVisionPerMin + 0.15,
    direction: 'up',
  },
]

export const focusProgress = (goal: FocusGoal, current: number): number => {
  const distance = goal.target - goal.baseline
  if (distance === 0) return 1
  return Math.max(0, Math.min(1, (current - goal.baseline) / distance))
}

const formatValue = (metric: FocusMetric, value: number) => {
  if (metric === 'objectives') return `${Math.round(value * 100)}%`
  if (metric === 'csDiff10') return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`
  return value.toFixed(metric === 'earlyDeaths' ? 1 : 2)
}

const isFocusGoal = (value: unknown): value is FocusGoal => {
  if (!value || typeof value !== 'object') return false
  const goal = value as Partial<FocusGoal>
  return (
    ['earlyDeaths', 'csDiff10', 'objectives', 'vision'].includes(goal.metric ?? '') &&
    typeof goal.label === 'string' &&
    typeof goal.startedAt === 'number' &&
    typeof goal.baseline === 'number' &&
    typeof goal.target === 'number' &&
    (goal.direction === 'up' || goal.direction === 'down')
  )
}

export function useFocusGoal(slug: string, aggregate: Aggregate, matches: MatchReport[]) {
  const [goal, setGoal] = useState<FocusGoal | null>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`${STORAGE_PREFIX}${slug}`)
      const parsed: unknown = stored ? JSON.parse(stored) : null
      setGoal(isFocusGoal(parsed) ? parsed : null)
    } catch {
      setGoal(null)
    }
  }, [slug])

  const choose = useCallback(
    (metric: FocusMetric) => {
      const option = focusOptions(aggregate).find(candidate => candidate.metric === metric)
      if (!option || option.baseline === null || option.target === null) return
      const next: FocusGoal = {
        metric,
        label: option.label,
        startedAt: matches[0]?.gameCreation ?? Date.now(),
        baseline: option.baseline,
        target: option.target,
        direction: option.direction,
      }
      setGoal(next)
      localStorage.setItem(`${STORAGE_PREFIX}${slug}`, JSON.stringify(next))
    },
    [aggregate, matches, slug],
  )

  const clear = useCallback(() => {
    setGoal(null)
    localStorage.removeItem(`${STORAGE_PREFIX}${slug}`)
  }, [slug])

  return { goal, choose, clear }
}

export function FocusPanel({
  goal,
  aggregate,
  matches,
  recommended,
  highlighted = false,
  onChoose,
  onClear,
}: {
  goal: FocusGoal | null
  aggregate: Aggregate
  matches: MatchReport[]
  recommended: FocusMetric
  highlighted?: boolean
  onChoose: (metric: FocusMetric) => void
  onClear: () => void
}) {
  const options = useMemo(() => focusOptions(aggregate), [aggregate])
  const newMatches = useMemo(
    () => (goal ? matches.filter(match => match.gameCreation > goal.startedAt) : []),
    [goal, matches],
  )
  const currentAggregate = useMemo(
    () => (newMatches.length ? buildAggregate(newMatches) : null),
    [newMatches],
  )
  const current = goal && currentAggregate ? focusValue(goal.metric, currentAggregate) : null
  const progress = goal && current !== null ? focusProgress(goal, current) : 0

  return (
    <section className={`focus-panel${highlighted ? ' tour-emphasis' : ''}`} data-tour="focus">
      {goal ? (
        <>
          <div className="focus-copy">
            <span className="focus-kicker">Current win condition</span>
            <h2>{goal.label}</h2>
            <p>
              {newMatches.length
                ? `${newMatches.length} new ${newMatches.length === 1 ? 'game' : 'games'}; ${formatValue(goal.metric, current!)} now`
                : 'Baseline locked. New games after your next sync will count toward this goal.'}
            </p>
          </div>
          <div className="focus-score">
            <div className="focus-numbers">
              <span>
                <small>Baseline</small>
                {formatValue(goal.metric, goal.baseline)}
              </span>
              <span className="focus-arrow" aria-hidden="true">
                &rarr;
              </span>
              <span>
                <small>Target</small>
                {formatValue(goal.metric, goal.target)}
              </span>
            </div>
            <div
              className="focus-progress"
              role="progressbar"
              aria-label={`${goal.label} progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            >
              <span style={{ width: `${progress * 100}%` }} />
            </div>
            <button className="ghost-btn focus-change" onClick={onClear}>
              Change focus
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="focus-copy">
            <span className="focus-kicker">Next queue</span>
            <h2>Choose one win condition</h2>
            <p>Lock today's baseline, then measure only the games that come after it.</p>
          </div>
          <div className="focus-options">
            {options.map(option => (
              <button
                key={option.metric}
                className={`focus-option${recommended === option.metric ? ' recommended' : ''}`}
                disabled={option.baseline === null || option.target === null}
                onClick={() => onChoose(option.metric)}
              >
                <span>
                  {option.label}
                  {recommended === option.metric && <small>Recommended</small>}
                </span>
                <strong>
                  {option.baseline === null || option.target === null
                    ? 'Not enough data'
                    : `${formatValue(option.metric, option.baseline)} to ${formatValue(option.metric, option.target)}`}
                </strong>
                <em>{option.detail}</em>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

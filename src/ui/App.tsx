import { useEffect, useMemo, useState } from 'react'
import { buildAggregate, type ClimbReport, type MatchReport } from '../analysis/report'
import { buildInsights } from '../analysis/insights'
import { DeathMap } from './DeathMap'
import { LivePanel } from './LivePanel'
import { MatchTable } from './MatchTable'
import { TrendChart, type TrendMetric } from './TrendChart'
import { SEVERITY, SeverityChip, fmtSigned } from './shared'

const INSIGHTS_SHOWN = 4
const GAMES_SHOWN = 10

type LoadState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; report: ClimbReport }

export function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    fetch('/report.json')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((report: ClimbReport) => setState({ status: 'ready', report }))
      .catch(() => setState({ status: 'missing' }))
  }, [])

  if (state.status === 'loading') return null
  if (state.status === 'missing') return <Onboarding />
  return <Dashboard report={state.report} />
}

function Brand() {
  return (
    <h1 className="wordmark">
      <span className="accent">Win</span>con
    </h1>
  )
}

function Onboarding() {
  return (
    <div className="shell">
      <div className="onboard">
        <Brand />
        <p>
          Find your win condition. Wincon pulls your recent ranked games from the Riot API and
          tells you why you lost, not just that you did. No report found yet; two ways to get one:
        </p>
        <ol>
          <li>
            <strong>Sample data, no setup:</strong> <code>npm run demo</code>, then refresh this page.
          </li>
          <li>
            <strong>Your own games:</strong> copy <code>.env.example</code> to <code>.env</code>, add a
            key from <code>developer.riotgames.com</code> and your Riot ID, then run{' '}
            <code>npm run sync</code> followed by <code>npm run analyze</code>.
          </li>
        </ol>
      </div>
    </div>
  )
}

const ROLE_LABELS: Record<string, string> = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MIDDLE: 'Mid',
  BOTTOM: 'Bot',
  UTILITY: 'Support',
}

function Dashboard({ report }: { report: ClimbReport }) {
  const { player } = report
  const [allInsights, setAllInsights] = useState(false)
  const [allGames, setAllGames] = useState(false)
  const [roleFilter, setRoleFilter] = useState<string | null>(null)
  const [champFilter, setChampFilter] = useState<string | null>(null)
  const [metric, setMetric] = useState<TrendMetric>('csDiff10')

  // The whole dashboard recomputes from the filtered subset: the analysis
  // layer is pure functions shared with the CLI, so filtering is just
  // re-running it on fewer games.
  const filtered = useMemo(
    () =>
      report.matches.filter(
        m => (!roleFilter || m.role === roleFilter) && (!champFilter || m.championName === champFilter),
      ),
    [report.matches, roleFilter, champFilter],
  )
  const agg = useMemo(() => buildAggregate(filtered), [filtered])
  const insights = useMemo(() => buildInsights(agg, filtered), [agg, filtered])

  const rolesPresent = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of report.matches) counts.set(m.role, (counts.get(m.role) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [report.matches])

  const champsPresent = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of report.matches) counts.set(m.championName, (counts.get(m.championName) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [report.matches])

  const filterActive = roleFilter !== null || champFilter !== null
  const shownInsights = allInsights ? insights : insights.slice(0, INSIGHTS_SHOWN)
  const shownGames = allGames ? filtered : filtered.slice(0, GAMES_SHOWN)

  const window = report.matches.length
    ? `${new Date(report.matches[report.matches.length - 1]!.gameCreation).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} to ${new Date(report.matches[0]!.gameCreation).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : ''

  return (
    <div className="shell">
      <header className="masthead">
        <div className="brand">
          <Brand />
          <span className="tagline">find your win condition</span>
        </div>
        <span className="player-line">
          <strong>
            {player.gameName}#{player.tagLine}
          </strong>{' '}
          · {report.matches.length} ranked games · {window}
        </span>
      </header>

      <div className="filter-bar">
        <button
          className={`chip-btn${roleFilter === null ? ' active' : ''}`}
          onClick={() => setRoleFilter(null)}
        >
          All roles
        </button>
        {rolesPresent.map(([role, count]) => (
          <button
            key={role}
            className={`chip-btn${roleFilter === role ? ' active' : ''}`}
            onClick={() => setRoleFilter(r => (r === role ? null : role))}
          >
            {ROLE_LABELS[role] ?? role} {count}
          </button>
        ))}
        <select
          className="mini-select"
          value={champFilter ?? ''}
          onChange={e => setChampFilter(e.target.value || null)}
        >
          <option value="">All champions</option>
          {champsPresent.map(([champ, count]) => (
            <option key={champ} value={champ}>
              {champ} ({count})
            </option>
          ))}
        </select>
        <span className="filter-count">
          {filterActive ? `${filtered.length} of ${report.matches.length} games` : `${filtered.length} games`}
          {' · '}
          {agg.games ? `${(agg.winrate * 100).toFixed(0)}% winrate` : 'no games match'}
        </span>
        {filterActive && (
          <button
            className="chip-btn"
            onClick={() => {
              setRoleFilter(null)
              setChampFilter(null)
            }}
          >
            Reset
          </button>
        )}
      </div>

      <div className="stat-strip">
        <Stat
          value={agg.avgCsDiff10 !== null ? fmtSigned(agg.avgCsDiff10) : '·'}
          label="CS diff at 10:00"
        />
        <Stat value={agg.games ? agg.deathsByPhasePerGame.early.toFixed(1) : '·'} label="deaths before 14:00" />
        <Stat
          value={agg.objectiveParticipation !== null ? `${Math.round(agg.objectiveParticipation * 100)}%` : '·'}
          label="objective participation"
        />
        <Stat value={agg.games ? agg.avgVisionPerMin.toFixed(2) : '·'} label="vision per minute" />
      </div>

      <LivePanel matches={report.matches} />

      {report.isDemo && (
        <div className="demo-banner">
          Sample data. Run <code>npm run sync</code> with your own Riot ID (see <code>.env.example</code>),
          then <code>npm run analyze</code> to see your games.
        </div>
      )}

      <h2 className="section-title">Coach's notes</h2>
      <div className="insights">
        {insights.length === 0 && (
          <div className="insight" style={{ borderLeftColor: 'var(--baseline)' }}>
            <p className="insight-detail">
              {agg.games < 15
                ? `Only ${agg.games} games in this slice; most rules stay quiet under 15. Widen the filter for a clearer signal.`
                : 'Nothing stands out in this slice.'}
            </p>
          </div>
        )}
        {shownInsights.map(insight => (
          <div
            className="insight"
            key={insight.id}
            style={{ borderLeftColor: SEVERITY[insight.severity].color }}
          >
            <div className="insight-head">
              <SeverityChip severity={insight.severity} />
              <span className="insight-title">{insight.title}</span>
            </div>
            <p className="insight-detail">{insight.detail}</p>
          </div>
        ))}
      </div>
      {insights.length > INSIGHTS_SHOWN && (
        <button className="ghost-btn" onClick={() => setAllInsights(v => !v)}>
          {allInsights ? 'Show fewer notes' : `Show ${insights.length - INSIGHTS_SHOWN} more notes`}
        </button>
      )}

      <h2 className="section-title">Patterns</h2>
      <div className="chart-row">
        <DeathMap matches={filtered} />
        <TrendChart matches={filtered} metric={metric} onMetricChange={setMetric} />
      </div>

      <h2 className="section-title">Game by game</h2>
      <MatchTable matches={shownGames} />
      {filtered.length > GAMES_SHOWN && (
        <button className="ghost-btn" onClick={() => setAllGames(v => !v)}>
          {allGames ? 'Show recent 10 only' : `Show all ${filtered.length} games`}
        </button>
      )}

      <footer>
        Report window {window}, generated {new Date(report.generatedAt).toLocaleString()}. Wincon is
        a personal project. It isn't endorsed by Riot Games and doesn't reflect the views or
        opinions of Riot Games or anyone officially involved in producing or managing League of
        Legends. League of Legends and Riot Games are trademarks or registered trademarks of Riot
        Games, Inc.
      </footer>
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { ClimbReport } from '../analysis/report'
import { DeathMap } from './DeathMap'
import { MatchTable } from './MatchTable'
import { TrendChart } from './TrendChart'
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

function Dashboard({ report }: { report: ClimbReport }) {
  const { aggregate: agg, player } = report
  const [allInsights, setAllInsights] = useState(false)
  const [allGames, setAllGames] = useState(false)

  const insights = allInsights ? report.insights : report.insights.slice(0, INSIGHTS_SHOWN)
  const games = allGames ? report.matches : report.matches.slice(0, GAMES_SHOWN)

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
          · {agg.primaryRole ? agg.primaryRole.toLowerCase() : '?'} · {agg.games} ranked games ·{' '}
          {(agg.winrate * 100).toFixed(0)}% winrate
        </span>
      </header>

      <div className="stat-strip">
        <Stat
          value={agg.avgCsDiff10 !== null ? fmtSigned(agg.avgCsDiff10) : '·'}
          label="CS diff at 10:00"
        />
        <Stat value={agg.deathsByPhasePerGame.early.toFixed(1)} label="deaths before 14:00" />
        <Stat
          value={agg.objectiveParticipation !== null ? `${Math.round(agg.objectiveParticipation * 100)}%` : '·'}
          label="objective participation"
        />
        <Stat value={agg.avgVisionPerMin.toFixed(2)} label="vision per minute" />
      </div>

      {report.isDemo && (
        <div className="demo-banner">
          Sample data. Run <code>npm run sync</code> with your own Riot ID (see <code>.env.example</code>),
          then <code>npm run analyze</code> to see your games.
        </div>
      )}

      <h2 className="section-title">Coach's notes</h2>
      <div className="insights">
        {report.insights.length === 0 && (
          <div className="insight" style={{ borderLeftColor: 'var(--baseline)' }}>
            <p className="insight-detail">
              Nothing stands out yet. Sync more games for a clearer signal.
            </p>
          </div>
        )}
        {insights.map(insight => (
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
      {report.insights.length > INSIGHTS_SHOWN && (
        <button className="ghost-btn" onClick={() => setAllInsights(v => !v)}>
          {allInsights ? 'Show fewer notes' : `Show ${report.insights.length - INSIGHTS_SHOWN} more notes`}
        </button>
      )}

      <h2 className="section-title">Patterns</h2>
      <div className="chart-row">
        <DeathMap matches={report.matches} />
        <TrendChart matches={report.matches} />
      </div>

      <h2 className="section-title">Game by game</h2>
      <MatchTable matches={games} />
      {report.matches.length > GAMES_SHOWN && (
        <button className="ghost-btn" onClick={() => setAllGames(v => !v)}>
          {allGames ? 'Show recent 10 only' : `Show all ${report.matches.length} games`}
        </button>
      )}

      <footer>
        Report generated {new Date(report.generatedAt).toLocaleString()}. Wincon is a personal
        project. It isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot
        Games or anyone officially involved in producing or managing League of Legends. League of
        Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.
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

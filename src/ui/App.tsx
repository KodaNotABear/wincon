import { useEffect, useState } from 'react'
import type { ClimbReport } from '../analysis/report'
import { DeathMap } from './DeathMap'
import { MatchTable } from './MatchTable'
import { TrendChart } from './TrendChart'
import { SEVERITY, SeverityChip, fmtSigned } from './shared'

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

function Onboarding() {
  return (
    <div className="shell">
      <div className="onboard">
        <h2>
          Emerald <span style={{ color: 'var(--success-text)' }}>Exit</span>
        </h2>
        <p>
          A personal ranked review tool. It pulls your recent ranked games from the Riot API and
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
  return (
    <div className="shell">
      <header className="masthead">
        <h1 className="wordmark">
          Emerald <span className="accent">Exit</span>
        </h1>
        <span className="player-line">
          <strong>
            {player.gameName}#{player.tagLine}
          </strong>{' '}
          · {agg.games} ranked games · {(agg.winrate * 100).toFixed(0)}% winrate
        </span>
      </header>
      <div className="sub-line">
        Primary role {agg.primaryRole ? agg.primaryRole.toLowerCase() : 'unknown'} · report generated{' '}
        {new Date(report.generatedAt).toLocaleString()}
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
        {report.insights.map(insight => (
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

      <h2 className="section-title">The numbers</h2>
      <div className="tiles">
        <Tile
          value={agg.avgCsDiff10 !== null ? fmtSigned(agg.avgCsDiff10) : '·'}
          label="CS diff at 10:00"
          sub="average vs lane opponent"
        />
        <Tile
          value={agg.deathsByPhasePerGame.early.toFixed(1)}
          label="Deaths before 14:00"
          sub={`per game · ${agg.deathsByPhasePerGame.mid.toFixed(1)} mid, ${agg.deathsByPhasePerGame.late.toFixed(1)} late`}
        />
        <Tile
          value={agg.objectiveParticipation !== null ? `${Math.round(agg.objectiveParticipation * 100)}%` : '·'}
          label="Objective participation"
          sub="credited on team epic monsters"
        />
        <Tile
          value={agg.avgVisionPerMin.toFixed(2)}
          label="Vision score per minute"
          sub={`across ${agg.games} games`}
        />
      </div>

      <h2 className="section-title">Patterns</h2>
      <div className="chart-row">
        <DeathMap matches={report.matches} />
        <TrendChart matches={report.matches} />
      </div>

      <h2 className="section-title">Game by game</h2>
      <MatchTable matches={report.matches} />

      <footer>
        Emerald Exit is a personal project. It isn't endorsed by Riot Games and doesn't reflect the
        views or opinions of Riot Games or anyone officially involved in producing or managing
        League of Legends. League of Legends and Riot Games are trademarks or registered trademarks
        of Riot Games, Inc.
      </footer>
    </div>
  )
}

function Tile({ value, label, sub }: { value: string; label: string; sub: string }) {
  return (
    <div className="tile">
      <div className="tile-value">{value}</div>
      <div className="tile-label">{label}</div>
      <div className="tile-sub">{sub}</div>
    </div>
  )
}

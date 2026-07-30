import type { MatchReport } from '../analysis/report'
import { SEVERITY, fmtSigned } from './shared'

export function MatchTable({ matches }: { matches: MatchReport[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Matchup</th>
            <th>Role</th>
            <th>Result</th>
            <th>KDA</th>
            <th>CS diff @10</th>
            <th>Objectives</th>
            <th>Vision/min</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {matches.map(m => (
            <tr key={m.matchId}>
              <td>{new Date(m.gameCreation).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
              <td className="matchup">
                {m.championName} <span className="vs">vs {m.opponentChampion ?? '?'}</span>
              </td>
              <td>{m.role ? m.role.charAt(0) + m.role.slice(1).toLowerCase() : '?'}</td>
              <td>
                <span className="result">
                  <span
                    className="swatch"
                    style={{ background: m.win ? 'var(--series-1)' : 'var(--series-2)' }}
                  />
                  {m.win ? 'Win' : 'Loss'}
                </span>
              </td>
              <td className="num">
                {m.kills}/{m.deaths}/{m.assists}
              </td>
              <td className="num">{m.laning.csDiff10 !== null ? fmtSigned(m.laning.csDiff10, 0) : '·'}</td>
              <td className="num">
                {m.objectives.credited}/{m.objectives.teamTaken}
              </td>
              <td className="num">{m.visionPerMin.toFixed(2)}</td>
              <td>
                <span className="flag-chips">
                  {m.flags.map(f => (
                    <span className="chip" key={f.id}>
                      <span className="dot" style={{ background: SEVERITY[f.severity].color }} />
                      {f.title}
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

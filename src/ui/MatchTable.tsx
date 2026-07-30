import type { MatchReport } from '../analysis/report'
import { ChampIcon } from './ddragon'
import { SEVERITY, fmtSigned } from './shared'

export function MatchTable({
  matches,
  onReplay,
}: {
  matches: MatchReport[]
  onReplay: (matchId: string) => void
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th aria-label="Replay" />
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
            <tr key={m.matchId} className="match-row" onClick={() => onReplay(m.matchId)}>
              <td>
                <button
                  className="replay-btn"
                  onClick={e => {
                    e.stopPropagation()
                    onReplay(m.matchId)
                  }}
                >
                  <svg viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M3.5 2.2 L9.8 6 L3.5 9.8 Z" fill="currentColor" />
                  </svg>
                  Replay
                </button>
              </td>
              <td>{new Date(m.gameCreation).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
              <td className="matchup">
                <span className="matchup-cell">
                  <ChampIcon name={m.championName} size={22} />
                  {m.championName} <span className="vs">vs</span>
                  <ChampIcon name={m.opponentChampion} size={18} />
                  <span className="vs">{m.opponentChampion ?? '?'}</span>
                </span>
              </td>
              <td>{m.role ? m.role.charAt(0) + m.role.slice(1).toLowerCase() : '?'}</td>
              <td>
                <span className={`result-badge ${m.win ? 'win' : 'loss'}`}>
                  {m.win ? 'WIN' : 'LOSS'}
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

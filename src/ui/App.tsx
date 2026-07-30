import { useEffect, useMemo, useState } from 'react'
import { buildAggregate, type ClimbReport, type MatchReport } from '../analysis/report'
import { buildInsights } from '../analysis/insights'
import { ChampIcon } from './ddragon'
import { DeathMap } from './DeathMap'
import { LivePanel } from './LivePanel'
import { MatchTable } from './MatchTable'
import { Replay } from './Replay'
import { TrendChart, type TrendMetric } from './TrendChart'
import { SEVERITY, SeverityChip, fmtSigned, useCountUp } from './shared'

const INSIGHTS_SHOWN = 4
const GAMES_SHOWN = 10

interface PlayerEntry {
  slug: string
  gameName: string
  tagLine: string
  region: string
  games: number
  generatedAt: string | null
}

export function App() {
  const [players, setPlayers] = useState<PlayerEntry[] | null>(null)
  const [slug, setSlug] = useState<string | null>(null)
  const [report, setReport] = useState<ClimbReport | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch('/players.json')
      .then(res => (res.ok ? res.json() : []))
      .then((list: PlayerEntry[]) => {
        const withReports = list.filter(p => p.games > 0)
        setPlayers(withReports)
        if (withReports.length) setSlug(withReports[0]!.slug)
        else setFailed(true)
      })
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    if (!slug) return
    setReport(null)
    fetch(`/report/${slug}.json`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(setReport)
      .catch(() => setFailed(true))
  }, [slug])

  const [syncBusy, setSyncBusy] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  const addPlayer = async (riotId: string): Promise<boolean> => {
    setSyncBusy(true)
    setSyncError(null)
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riotId }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Sync failed')
      const list: PlayerEntry[] = await fetch('/players.json').then(r => r.json())
      setPlayers(list.filter(p => p.games > 0))
      setSlug(body.slug)
      return true
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed')
      return false
    } finally {
      setSyncBusy(false)
    }
  }

  if (failed) return <Onboarding />
  if (!players || !slug || !report) return null
  return (
    <Dashboard
      report={report}
      slug={slug}
      players={players}
      onSelectPlayer={setSlug}
      onAddPlayer={addPlayer}
      syncBusy={syncBusy}
      syncError={syncError}
    />
  )
}

function Brand() {
  return (
    <h1 className="wordmark">
      <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--brand)" />
        <path
          d="M8.5 10.5 L12 22 L16 13.5 L20 22 L23.5 10.5"
          fill="none"
          stroke="var(--brand-ink)"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
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
          Find your win condition. Wincon pulls recent ranked games from the Riot API, replays them,
          and tells you why you lost, not just that you did. No players synced yet; two ways in:
        </p>
        <ol>
          <li>
            <strong>Sample data, no setup:</strong> <code>npm run demo</code>, then refresh this page.
          </li>
          <li>
            <strong>Any real player:</strong> copy <code>.env.example</code> to <code>.env</code>, add a key
            from <code>developer.riotgames.com</code>, then run{' '}
            <code>npm run sync -- "Name#TAG"</code> followed by <code>npm run analyze</code>.
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

function Dashboard({
  report,
  slug,
  players,
  onSelectPlayer,
  onAddPlayer,
  syncBusy,
  syncError,
}: {
  report: ClimbReport
  slug: string
  players: PlayerEntry[]
  onSelectPlayer: (slug: string) => void
  onAddPlayer: (riotId: string) => Promise<boolean>
  syncBusy: boolean
  syncError: string | null
}) {
  const { player } = report
  const [lookupOpen, setLookupOpen] = useState(false)
  const [lookupValue, setLookupValue] = useState('')
  const [allInsights, setAllInsights] = useState(false)
  const [allGames, setAllGames] = useState(false)
  const [roleFilter, setRoleFilter] = useState<string | null>(null)
  const [champFilter, setChampFilter] = useState<string | null>(null)
  const [metric, setMetric] = useState<TrendMetric>('csDiff10')
  const [replayId, setReplayId] = useState<string | null>(null)

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

  const streak = useMemo(() => {
    const first = report.matches[0]?.win
    if (first === undefined) return null
    let count = 0
    for (const m of report.matches) {
      if (m.win === first) count++
      else break
    }
    return { win: first, count }
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
          {players.length > 1 && (
            <select className="mini-select" value={slug} onChange={e => onSelectPlayer(e.target.value)}>
              {players.map(p => (
                <option key={p.slug} value={p.slug}>
                  {p.gameName}#{p.tagLine}
                </option>
              ))}
            </select>
          )}
          <button className="chip-btn" onClick={() => setLookupOpen(open => !open)}>
            {lookupOpen ? 'Cancel' : 'Add player'}
          </button>
        </span>
      </header>

      {lookupOpen && (
        <form
          className="lookup-row"
          onSubmit={async e => {
            e.preventDefault()
            const riotId = lookupValue.trim()
            if (!riotId || syncBusy) return
            if (await onAddPlayer(riotId)) {
              setLookupOpen(false)
              setLookupValue('')
            }
          }}
        >
          <input
            className="lookup-input"
            placeholder="GameName#TAG"
            value={lookupValue}
            autoFocus
            onChange={e => setLookupValue(e.target.value)}
          />
          <button className="play-btn" type="submit" disabled={syncBusy}>
            {syncBusy ? 'Syncing, this takes a moment…' : 'Look up'}
          </button>
          {syncError && <span className="lookup-error">{syncError}</span>}
        </form>
      )}

      <section className="hero">
        <svg className="hero-mark" viewBox="0 0 32 32" aria-hidden="true">
          <path
            d="M8.5 10.5 L12 22 L16 13.5 L20 22 L23.5 10.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="hero-id">
          <WinrateDonut wins={report.aggregate.wins} games={report.aggregate.games} />
          <div className="hero-id-text">
            <span className="hero-kicker">
              Welcome back · {ROLE_LABELS[report.aggregate.primaryRole] ?? '?'} main ·{' '}
              {report.matches.length} ranked games · {window}
            </span>
            <div className="hero-name-row">
              <h2 className="hero-name">
                {player.gameName}
                <span className="hero-tag">#{player.tagLine}</span>
              </h2>
              {streak && streak.count >= 2 && (
                <span className={`streak-chip ${streak.win ? 'hot' : 'cold'}`}>
                  {streak.count}
                  {streak.win ? 'W' : 'L'} streak
                </span>
              )}
            </div>
            {report.insights[0] && (
              <p className="hero-verdict">
                <span
                  className="verdict-dot"
                  style={{ background: SEVERITY[report.insights[0].severity].color }}
                />
                {report.insights[0].title}
              </p>
            )}
          </div>
        </div>
        {report.matches[0] && (
          <HeroReplay latest={report.matches[0]} onWatch={() => setReplayId(report.matches[0]!.matchId)} />
        )}
      </section>

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
        {filterActive && (
          <span className="filter-count">
            {filtered.length} of {report.matches.length} games ·{' '}
            {agg.games ? `${(agg.winrate * 100).toFixed(0)}% winrate` : 'no games match'}
          </span>
        )}
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
        <Stat value={agg.avgCsDiff10} format={v => fmtSigned(v)} label="CS diff at 10:00" />
        <Stat
          value={agg.games ? agg.deathsByPhasePerGame.early : null}
          format={v => v.toFixed(1)}
          label="deaths before 14:00"
        />
        <Stat
          value={agg.objectiveParticipation !== null ? agg.objectiveParticipation * 100 : null}
          format={v => `${Math.round(v)}%`}
          label="objective participation"
        />
        <Stat
          value={agg.games ? agg.avgVisionPerMin : null}
          format={v => v.toFixed(2)}
          label="vision per minute"
        />
      </div>

      <LivePanel matches={report.matches} />

      {report.isDemo && (
        <div className="demo-banner">
          Sample data. Run <code>npm run sync -- "Name#TAG"</code> (see <code>.env.example</code>), then{' '}
          <code>npm run analyze</code> to see real games.
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

      <h2 className="section-title">Replays</h2>
      <p className="section-sub">Every game replays on the map. Click one.</p>
      <MatchTable matches={shownGames} onReplay={setReplayId} />
      {filtered.length > GAMES_SHOWN && (
        <button className="ghost-btn" onClick={() => setAllGames(v => !v)}>
          {allGames ? 'Show recent 10 only' : `Show all ${filtered.length} games`}
        </button>
      )}

      {replayId && (
        <Replay slug={slug} matchId={replayId} puuid={player.puuid} onClose={() => setReplayId(null)} />
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

function WinrateDonut({ wins, games }: { wins: number; games: number }) {
  const pct = games ? wins / games : 0
  // The arc sweeps in on load, same easing as the stat count-ups.
  const shown = (useCountUp(pct * 100, 900) ?? 0) / 100
  const R = 26
  const C = 2 * Math.PI * R
  return (
    <div className="donut">
      <svg viewBox="0 0 64 64" role="img" aria-label={`${Math.round(pct * 100)} percent winrate`}>
        <circle cx="32" cy="32" r={R} fill="none" stroke="var(--grid)" strokeWidth="7" />
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          stroke="var(--brand)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${C * shown} ${C}`}
          transform="rotate(-90 32 32)"
        />
      </svg>
      <span className="donut-num">{Math.round(shown * 100)}%</span>
      <span className="donut-sub">
        {wins}W {games - wins}L
      </span>
    </div>
  )
}

function HeroReplay({ latest, onWatch }: { latest: MatchReport; onWatch: () => void }) {
  return (
    <button className="hero-replay" onClick={onWatch}>
      <ChampIcon name={latest.championName} size={46} />
      <span className="hero-text">
        <span className="hero-kicker">Latest game</span>
        <span className="hero-title">
          {latest.championName} <span className="vs">vs {latest.opponentChampion ?? '?'}</span>{' '}
          <span className={`result-badge ${latest.win ? 'win' : 'loss'}`}>{latest.win ? 'WIN' : 'LOSS'}</span>{' '}
          <span className="hero-meta">
            {latest.kills}/{latest.deaths}/{latest.assists} · {Math.round(latest.durationMin)} min
          </span>
        </span>
        {latest.flags[0] && <span className="hero-flag">{latest.flags[0].title}</span>}
      </span>
      <span className="play-btn hero-play">
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3.5 2.2 L9.8 6 L3.5 9.8 Z" fill="currentColor" />
        </svg>
        Watch replay
      </span>
    </button>
  )
}

function Stat({
  value,
  format,
  label,
}: {
  value: number | null
  format: (v: number) => string
  label: string
}) {
  const animated = useCountUp(value)
  return (
    <div className="stat">
      <span className="stat-value">{animated !== null ? format(animated) : '·'}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

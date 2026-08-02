import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { buildAggregate, type ClimbReport, type MatchReport } from '../analysis/report'
import { buildInsights } from '../analysis/insights'
import { ChampIcon } from './ddragon'
import { DeathMap } from './DeathMap'
import {
  FocusPanel,
  type FocusMetric,
  useFocusGoal,
} from './FocusLoop'
import { LivePanel } from './LivePanel'
import { MatchTable } from './MatchTable'
import { Replay } from './Replay'
import { TrendChart, type TrendMetric } from './TrendChart'
import { SEVERITY, SeverityChip, fmtSigned, useCountUp } from './shared'

const INSIGHTS_SHOWN = 4
const GAMES_SHOWN = 10
const BASE_URL = import.meta.env.BASE_URL
const IS_PORTFOLIO_DEMO = import.meta.env.VITE_PORTFOLIO_DEMO === true

interface PlayerEntry {
  slug: string
  gameName: string
  tagLine: string
  region: string
  games: number
  generatedAt: string | null
  /** Set by the server for the keep-listed account, the only one safe to feature. */
  showcase?: boolean
}

export function App() {
  const [players, setPlayers] = useState<PlayerEntry[] | null>(null)
  const [slug, setSlug] = useState<string | null>(null)
  const [report, setReport] = useState<ClimbReport | null>(null)

  useEffect(() => {
    fetch(`${BASE_URL}players.json`)
      .then(res => (res.ok ? res.json() : []))
      .then((list: PlayerEntry[]) => setPlayers(list.filter(p => p.games > 0)))
      .catch(() => setPlayers([]))
  }, [])

  useEffect(() => {
    if (!slug) return
    setReport(null)
    fetch(`${BASE_URL}report/${slug}.json`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(setReport)
      .catch(() => setSlug(null))
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
      const list: PlayerEntry[] = await fetch(`${BASE_URL}players.json`).then(r => r.json())
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

  if (!players) return null
  // Search is the front door. Opening straight into whichever player happened to
  // be cached first would show a visitor someone else's account.
  if (!slug || !report) {
    return (
      <Landing
        players={players}
        onLookup={addPlayer}
        onSelect={setSlug}
        busy={syncBusy}
        error={syncError}
        loadingReport={Boolean(slug) && !report}
      />
    )
  }
  return (
    <Dashboard
      report={report}
      slug={slug}
      players={players}
      onSelectPlayer={setSlug}
      onAddPlayer={addPlayer}
      onHome={() => setSlug(null)}
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

function Landing({
  players,
  onLookup,
  onSelect,
  busy,
  error,
  loadingReport,
}: {
  players: PlayerEntry[]
  onLookup: (riotId: string) => Promise<boolean>
  onSelect: (slug: string) => void
  busy: boolean
  error: string | null
  loadingReport: boolean
}) {
  const [value, setValue] = useState('')
  // Prefer the account the server marked safe to feature. A checkout that just
  // ran `npm run demo` has no keep-list to match, but a cache holding exactly
  // one player is unambiguous: there is no stranger it could be mistaken for.
  const showcase = players.find(p => p.showcase) ?? (players.length === 1 ? players[0]! : null)

  return (
    <div className="shell">
      <div className="onboard">
        <Brand />
        <p>
          Find your win condition. Wincon reads your recent ranked games, replays the
          moments that decided them, and tells you why you lost rather than just that
          you did.
        </p>

        <form
          className="lookup-row"
          onSubmit={async e => {
            e.preventDefault()
            const riotId = value.trim()
            if (!riotId || busy) return
            await onLookup(riotId)
          }}
        >
          <input
            className="lookup-input"
            placeholder="GameName#TAG"
            value={value}
            autoFocus
            onChange={e => setValue(e.target.value)}
          />
          <button className="play-btn" type="submit" disabled={busy || loadingReport}>
            {busy ? 'Reading your games, this takes a moment…' : 'Look up'}
          </button>
        </form>
        {error && <p className="lookup-error">{error}</p>}

        {players.length > 0 && (
          <p className="sample-line">
            {/* Most people looking at this do not play League and have no Riot ID
                to type, so there has to be a way in without one. */}
            No Riot ID handy? Open a finished analysis:{' '}
            {players.map((p, i) => (
              <span key={p.slug}>
                {i > 0 && ', '}
                <button type="button" className="link-btn" onClick={() => onSelect(p.slug)}>
                  {p.gameName}#{p.tagLine}
                </button>
              </span>
            ))}
          </p>
        )}
      </div>

      {showcase && <LandingPreview player={showcase} onOpen={() => onSelect(showcase.slug)} />}
    </div>
  )
}

/**
 * A real report rendered under the search box. A visitor who does not play
 * League has nothing to type and no reason to trust a claim about coaching
 * notes, so the front door shows actual output instead of describing it.
 * Silent on failure: the search box above is the thing that has to work.
 */
function LandingPreview({ player, onOpen }: { player: PlayerEntry; onOpen: () => void }) {
  const [report, setReport] = useState<ClimbReport | null>(null)
  const [metric, setMetric] = useState<TrendMetric>('csDiff10')

  useEffect(() => {
    let cancelled = false
    setReport(null)
    fetch(`${BASE_URL}report/${player.slug}.json`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: ClimbReport) => {
        if (!cancelled) setReport(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [player.slug])

  if (!report) return null

  const agg = report.aggregate
  const top = report.insights[0]

  return (
    <section className="preview">
      <h2 className="section-title">What it gives you</h2>
      <p className="preview-sub">
        {agg.games} ranked games from {player.gameName}#{player.tagLine}, read the same way
        yours would be.
      </p>

      <div className="stat-strip">
        <Stat
          value={agg.deathsByPhasePerGame.early}
          format={v => v.toFixed(1)}
          label="deaths before 14:00"
        />
        <Stat value={agg.avgCsDiff10} format={v => fmtSigned(v)} label="CS diff at 10:00" />
        <Stat
          value={agg.objectiveParticipation === null ? null : agg.objectiveParticipation * 100}
          format={v => `${Math.round(v)}%`}
          label="objective participation"
        />
        <Stat value={agg.winrate * 100} format={v => `${Math.round(v)}%`} label="win rate" />
      </div>

      {top && (
        <div
          className="insight"
          style={{ borderLeftColor: SEVERITY[top.severity].color } as CSSProperties}
        >
          <div className="insight-head">
            <SeverityChip severity={top.severity} />
            <span className="insight-title">{top.title}</span>
          </div>
          <p className="insight-detail">{top.detail}</p>
        </div>
      )}

      <div className="chart-row">
        <DeathMap matches={report.matches} />
        <TrendChart matches={report.matches} metric={metric} onMetricChange={setMetric} />
      </div>

      <button className="play-btn preview-cta" type="button" onClick={onOpen}>
        Open the full analysis
      </button>
    </section>
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
  onHome,
  syncBusy,
  syncError,
}: {
  report: ClimbReport
  slug: string
  players: PlayerEntry[]
  onSelectPlayer: (slug: string) => void
  onAddPlayer: (riotId: string) => Promise<boolean>
  onHome: () => void
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
  const [guidedReplay, setGuidedReplay] = useState(false)
  const [tourStep, setTourStep] = useState<number | null>(null)
  const { goal: focusGoal, choose: chooseFocus, clear: clearFocus } = useFocusGoal(
    slug,
    report.aggregate,
    report.matches,
  )

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

  // The most-played champion's splash art becomes the hero backdrop.
  const splashChamp = useMemo(
    () => Object.entries(report.aggregate.championCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    [report.aggregate.championCounts],
  )

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
  const recommendedFocus = useMemo<FocusMetric>(() => {
    const ids = new Set(report.insights.map(insight => insight.id))
    if (ids.has('early-deaths')) return 'earlyDeaths'
    if (ids.has('losing-lane-cs') || ids.has('low-cs10')) return 'csDiff10'
    if (ids.has('low-obj-participation')) return 'objectives'
    if (ids.has('low-vision')) return 'vision'
    return 'earlyDeaths'
  }, [report.insights])

  const reportWindow = report.matches.length
    ? `${new Date(report.matches[report.matches.length - 1]!.gameCreation).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} to ${new Date(report.matches[0]!.gameCreation).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : ''

  useEffect(() => {
    if (tourStep === null || tourStep === 3) return
    const selector = ['[data-tour="hero"]', '[data-tour="notes"]', '[data-tour="patterns"]', '', '[data-tour="focus"]'][
      tourStep
    ]
    if (!selector) return
    requestAnimationFrame(() => {
      document.querySelector(selector)?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center',
      })
    })
  }, [tourStep])

  const stopTour = () => {
    setTourStep(null)
    if (guidedReplay) setReplayId(null)
    setGuidedReplay(false)
  }

  const advanceTour = () => {
    if (tourStep === null) return
    if (tourStep === 2 && report.matches[0]) {
      setGuidedReplay(true)
      setReplayId(report.matches[0].matchId)
      setTourStep(3)
      return
    }
    if (tourStep === 3) {
      setReplayId(null)
      setGuidedReplay(false)
      setTourStep(4)
      return
    }
    if (tourStep === 4) {
      stopTour()
      return
    }
    setTourStep(tourStep + 1)
  }

  return (
    <div className="shell">
      <header className="masthead">
        <div className="brand">
          <button type="button" className="link-btn" onClick={onHome} aria-label="New lookup">
            <Brand />
          </button>
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
          {!IS_PORTFOLIO_DEMO && (
            <button className="chip-btn" onClick={() => setLookupOpen(open => !open)}>
              {lookupOpen ? 'Cancel' : 'Add player'}
            </button>
          )}
          <button
            className="chip-btn tour-launch"
            onClick={() => {
              setTourStep(0)
              setGuidedReplay(false)
            }}
          >
            60-second tour
          </button>
        </span>
      </header>

      {!IS_PORTFOLIO_DEMO && lookupOpen && (
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

      <section
        className={`hero${tourStep === 0 ? ' tour-emphasis' : ''}`}
        data-tour="hero"
      >
        {splashChamp && (
          <img
            className="hero-splash"
            src={`https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${splashChamp}_0.jpg`}
            alt=""
            onError={e => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        )}
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
              {report.matches.length} ranked games · {reportWindow}
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
          <HeroReplay
            latest={report.matches[0]}
            onWatch={() => {
              setGuidedReplay(false)
              setReplayId(report.matches[0]!.matchId)
            }}
          />
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

      <FocusPanel
        goal={focusGoal}
        aggregate={report.aggregate}
        matches={report.matches}
        recommended={recommendedFocus}
        highlighted={tourStep === 4}
        onChoose={chooseFocus}
        onClear={clearFocus}
      />

      {!IS_PORTFOLIO_DEMO && <LivePanel matches={report.matches} />}

      {report.isDemo && (
        <div className="demo-banner">
          {IS_PORTFOLIO_DEMO ? (
            <>
              Portfolio demo with one anonymized showcase match and seeded history. Riot IDs and API
              keys are not included.
            </>
          ) : (
            <>
              Sample data. Run <code>npm run sync -- "Name#TAG"</code> (see <code>.env.example</code>),
              then <code>npm run analyze</code> to see real games.
            </>
          )}
        </div>
      )}

      <section
        className={tourStep === 1 ? 'tour-emphasis' : undefined}
        data-tour="notes"
      >
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
          {shownInsights.map((insight, i) => (
            <div
              className="insight"
              key={insight.id}
              style={
                {
                  borderLeftColor: SEVERITY[insight.severity].color,
                  '--i': i,
                } as CSSProperties
              }
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
      </section>

      <section
        className={tourStep === 2 ? 'tour-emphasis' : undefined}
        data-tour="patterns"
      >
        <h2 className="section-title">Patterns</h2>
        <div className="chart-row">
          <DeathMap matches={filtered} />
          <TrendChart matches={filtered} metric={metric} onMetricChange={setMetric} />
        </div>
      </section>

      <h2 className="section-title">Replays</h2>
      <p className="section-sub">Every game replays on the map. Click one.</p>
      <MatchTable
        matches={shownGames}
        onReplay={matchId => {
          setGuidedReplay(false)
          setReplayId(matchId)
        }}
      />
      {filtered.length > GAMES_SHOWN && (
        <button className="ghost-btn" onClick={() => setAllGames(v => !v)}>
          {allGames ? 'Show recent 10 only' : `Show all ${filtered.length} games`}
        </button>
      )}

      {replayId && (
        <Replay
          slug={slug}
          matchId={replayId}
          puuid={player.puuid}
          guided={guidedReplay}
          selectedFocus={focusGoal?.metric ?? null}
          onChooseFocus={chooseFocus}
          onClose={() => {
            setReplayId(null)
            setGuidedReplay(false)
            if (tourStep === 3) setTourStep(4)
          }}
        />
      )}

      {tourStep !== null && (
        <GuidedTour
          step={tourStep}
          games={report.matches.length}
          onNext={advanceTour}
          onClose={stopTour}
        />
      )}

      <footer>
        Report window {reportWindow}, generated {new Date(report.generatedAt).toLocaleString()}. Wincon is
        a personal project. It isn't endorsed by Riot Games and doesn't reflect the views or
        opinions of Riot Games or anyone officially involved in producing or managing League of
        Legends. League of Legends and Riot Games are trademarks or registered trademarks of Riot
        Games, Inc.
      </footer>
    </div>
  )
}

const tourSteps = (games: number) => [
  {
    kicker: 'Player first',
    title: 'Diagnosis, not dashboard',
    body: `${games} matches collapse into one clear habit that is costing this player the climb.`,
    action: 'Show the evidence',
  },
  {
    kicker: 'Explainable analysis',
    title: 'Strong signals stay; noise stays quiet',
    body: 'Typed timeline events feed rules with sample-size gates, role benchmarks, and concrete next actions.',
    action: 'See the patterns',
  },
  {
    kicker: 'Inspectable evidence',
    title: 'The player can challenge the verdict',
    body: 'Deaths, lane trends, and match-level flags keep every coaching claim connected to visible evidence.',
    action: 'Open the replay',
  },
  {
    kicker: 'Moment-level coaching',
    title: 'The metric becomes a decision',
    body: 'The camera frames the mistake, the player, and the missing context at the exact timestamp it happened.',
    action: 'Close the loop',
  },
  {
    kicker: 'Behavior change',
    title: 'One focus follows the player forward',
    body: 'Today becomes the locked baseline. Only future matches count toward the next measurable target.',
    action: 'Finish',
  },
]

function GuidedTour({
  step,
  games,
  onNext,
  onClose,
}: {
  step: number
  games: number
  onNext: () => void
  onClose: () => void
}) {
  const steps = tourSteps(games)
  const current = steps[step]!
  return (
    <aside className="tour-rail" aria-live="polite">
      <div className="tour-progress" aria-label={`Walkthrough step ${step + 1} of ${steps.length}`}>
        {steps.map((_, i) => (
          <span key={i} className={i <= step ? 'active' : undefined} />
        ))}
      </div>
      <div className="tour-copy">
        <span>{current.kicker}</span>
        <strong>{current.title}</strong>
        <p>{current.body}</p>
      </div>
      <div className="tour-actions">
        <button className="ghost-btn" onClick={onClose}>
          Exit
        </button>
        <button className="play-btn" onClick={onNext}>
          {current.action}
        </button>
      </div>
    </aside>
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

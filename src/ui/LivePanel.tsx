// Live champ-select companion, powered by the League Client (LCU) API via
// the dev server's /lcu proxy. Quietly absent when the client isn't running.

import { useEffect, useState } from 'react'
import type { MatchReport } from '../analysis/report'
import { fmtSigned } from './shared'

const POLL_MS = 4000

// championId -> ddragon id ("MissFortune"), matching report championName.
let champMapPromise: Promise<Record<number, string>> | null = null
function championNames(): Promise<Record<number, string>> {
  champMapPromise ??= (async () => {
    const versions: string[] = await fetch('https://ddragon.leagueoflegends.com/api/versions.json').then(r => r.json())
    const data = await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/en_US/champion.json`,
    ).then(r => r.json())
    const map: Record<number, string> = {}
    for (const champ of Object.values<any>(data.data)) map[Number(champ.key)] = champ.id
    return map
  })().catch(() => {
    champMapPromise = null
    return {}
  })
  return champMapPromise
}

type LiveState =
  | { kind: 'off' }
  | { kind: 'idle' }
  | { kind: 'select'; championId: number; championName: string | null; locked: boolean }

export function LivePanel({ matches }: { matches: MatchReport[] }) {
  const [state, setState] = useState<LiveState>({ kind: 'off' })

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch('/lcu/lol-champ-select/v1/session')
        if (cancelled) return
        if (res.status === 200) {
          const session = await res.json()
          const me = session.myTeam?.find?.((c: any) => c.cellId === session.localPlayerCellId)
          const championId: number = me?.championId || me?.championPickIntent || 0
          if (championId > 0) {
            const name = (await championNames())[championId] ?? null
            if (!cancelled) {
              setState({ kind: 'select', championId, championName: name, locked: Boolean(me?.championId) })
            }
            return
          }
          setState({ kind: 'select', championId: 0, championName: null, locked: false })
        } else if (res.status === 404) {
          setState({ kind: 'idle' }) // client running, not in champ select
        } else {
          setState({ kind: 'off' })
        }
      } catch {
        if (!cancelled) setState({ kind: 'off' })
      }
    }
    poll()
    const timer = setInterval(poll, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  if (state.kind === 'off') return null
  if (state.kind === 'idle') {
    return <div className="live-idle">League client connected · waiting for champ select</div>
  }

  if (!state.championName && state.championId === 0) {
    return (
      <div className="live-panel">
        <span className="live-dot" />
        <strong>Champ select is live.</strong>
        <span className="live-detail">Hover a champion to see your recent record on them.</span>
      </div>
    )
  }

  const name = state.championName ?? `Champion #${state.championId}`
  const onChamp = matches.filter(m => m.championName === state.championName)
  const wins = onChamp.filter(m => m.win).length
  const csVals = onChamp.map(m => m.laning.csDiff10).filter((v): v is number => v !== null)
  const avgCs = csVals.length ? csVals.reduce((a, b) => a + b, 0) / csVals.length : null
  const earlyDeaths = onChamp.length
    ? onChamp.reduce((a, m) => a + m.deathsByPhase.early, 0) / onChamp.length
    : null

  return (
    <div className="live-panel">
      <span className="live-dot" />
      <strong>
        {state.locked ? 'Locked' : 'Hovering'}: {name}.
      </strong>
      {onChamp.length === 0 ? (
        <span className="live-detail">No games on them in this report window; fresh ground.</span>
      ) : (
        <span className="live-detail">
          Your last {onChamp.length} on them: {wins}W {onChamp.length - wins}L
          {avgCs !== null ? ` · ${fmtSigned(avgCs, 0)} CS at 10:00` : ''}
          {earlyDeaths !== null ? ` · ${earlyDeaths.toFixed(1)} early deaths/game` : ''}
        </span>
      )}
    </div>
  )
}

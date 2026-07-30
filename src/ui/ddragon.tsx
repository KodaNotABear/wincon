// Data Dragon: Riot's static asset CDN. Champion square icons and the
// numeric-id -> ddragon-id map, fetched once and cached at module level.
// Everything here degrades quietly offline: icons simply don't render.

import { useEffect, useState } from 'react'

let versionPromise: Promise<string> | null = null
export function ddragonVersion(): Promise<string> {
  versionPromise ??= fetch('https://ddragon.leagueoflegends.com/api/versions.json')
    .then(r => r.json())
    .then((versions: string[]) => versions[0] ?? '')
    .catch(() => {
      versionPromise = null
      return ''
    })
  return versionPromise
}

export function useDdragonVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    ddragonVersion().then(v => live && v && setVersion(v))
    return () => {
      live = false
    }
  }, [])
  return version
}

export const champIconUrl = (version: string, champion: string) =>
  `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champion}.png`

// championId (numeric, from the LCU) -> ddragon id ("MissFortune"), which is
// also what Match-V5 reports as championName.
let champMapPromise: Promise<Record<number, string>> | null = null
export function championIdMap(): Promise<Record<number, string>> {
  champMapPromise ??= ddragonVersion()
    .then(version =>
      fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`).then(r => r.json()),
    )
    .then(data => {
      const map: Record<number, string> = {}
      for (const champ of Object.values<any>(data.data)) map[Number(champ.key)] = champ.id
      return map
    })
    .catch(() => {
      champMapPromise = null
      return {}
    })
  return champMapPromise
}

export function ChampIcon({ name, size = 22 }: { name: string | null; size?: number }) {
  const version = useDdragonVersion()
  if (!version || !name) {
    return <span className="champ-icon champ-icon-fallback" style={{ width: size, height: size }} />
  }
  return (
    <img
      className="champ-icon"
      src={champIconUrl(version, name)}
      width={size}
      height={size}
      alt={name}
      loading="lazy"
      onError={e => {
        ;(e.target as HTMLImageElement).style.visibility = 'hidden'
      }}
    />
  )
}

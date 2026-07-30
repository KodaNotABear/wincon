import fs from 'node:fs'
import path from 'node:path'

// Data layout, one directory per synced player:
//   data/players/<slug>/player.json
//   data/players/<slug>/matches/<matchId>.json   (raw {match, timeline})
//   data/players/<slug>/report.json
//   data/players.json                            (index the UI reads)

export const DATA_DIR = path.resolve('data')
export const PLAYERS_DIR = path.join(DATA_DIR, 'players')

export function slugify(gameName: string, tagLine: string): string {
  return `${gameName}-${tagLine}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export const playerDir = (slug: string) => path.join(PLAYERS_DIR, slug)
export const matchDir = (slug: string) => path.join(playerDir(slug), 'matches')

/** Rebuild data/players.json from what's on disk. */
export function writePlayersIndex(): void {
  const entries = []
  if (fs.existsSync(PLAYERS_DIR)) {
    for (const slug of fs.readdirSync(PLAYERS_DIR)) {
      const playerFile = path.join(playerDir(slug), 'player.json')
      if (!fs.existsSync(playerFile)) continue
      const player = JSON.parse(fs.readFileSync(playerFile, 'utf8'))
      const reportFile = path.join(playerDir(slug), 'report.json')
      let games = 0
      let generatedAt: string | null = null
      if (fs.existsSync(reportFile)) {
        const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'))
        games = report.matches?.length ?? 0
        generatedAt = report.generatedAt ?? null
      }
      entries.push({
        slug,
        gameName: player.gameName,
        tagLine: player.tagLine,
        region: player.region,
        games,
        generatedAt,
      })
    }
  }
  entries.sort((a, b) => (b.generatedAt ?? '').localeCompare(a.generatedAt ?? ''))
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(path.join(DATA_DIR, 'players.json'), JSON.stringify(entries, null, 2))
}

/** Move the old single-player layout (data/player.json + data/matches) into players/<slug>/. */
export function migrateLegacyLayout(): void {
  const legacyPlayer = path.join(DATA_DIR, 'player.json')
  if (!fs.existsSync(legacyPlayer)) return
  const player = JSON.parse(fs.readFileSync(legacyPlayer, 'utf8'))
  const slug = slugify(player.gameName, player.tagLine)
  fs.mkdirSync(matchDir(slug), { recursive: true })
  const legacyMatches = path.join(DATA_DIR, 'matches')
  if (fs.existsSync(legacyMatches)) {
    for (const file of fs.readdirSync(legacyMatches)) {
      fs.renameSync(path.join(legacyMatches, file), path.join(matchDir(slug), file))
    }
    fs.rmdirSync(legacyMatches)
  }
  fs.renameSync(legacyPlayer, path.join(playerDir(slug), 'player.json'))
  const legacyReport = path.join(DATA_DIR, 'report.json')
  if (fs.existsSync(legacyReport)) {
    fs.renameSync(legacyReport, path.join(playerDir(slug), 'report.json'))
  }
  console.log(`Migrated existing data to data/players/${slug}/`)
}

/** Riot ID from argv ("npm run sync -- Name#TAG") or null. */
export function riotIdArg(): string | null {
  const arg = process.argv[2]
  return arg && arg.includes('#') ? arg : null
}

/** Pick the player to operate on when none is named: sole player, else most recent report. */
export function defaultSlug(): string | null {
  if (!fs.existsSync(PLAYERS_DIR)) return null
  const slugs = fs.readdirSync(PLAYERS_DIR).filter(s => fs.existsSync(path.join(playerDir(s), 'player.json')))
  if (slugs.length === 0) return null
  if (slugs.length === 1) return slugs[0]!
  const mtime = (s: string) => fs.statSync(path.join(playerDir(s), 'player.json')).mtimeMs
  return slugs.sort((a, b) => mtime(b) - mtime(a))[0]!
}

/** Tiny .env loader (KEY=VALUE lines) so the CLI has zero runtime deps. */
export function loadEnv(): void {
  const file = path.resolve('.env')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!(key in process.env)) process.env[key] = value
  }
}

export function requireEnv(key: string, hint: string): string {
  const value = process.env[key]
  if (!value) {
    console.error(`Missing ${key}. ${hint}`)
    process.exit(1)
  }
  return value
}

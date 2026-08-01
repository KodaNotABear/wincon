// Production server. In development these routes live as Vite plugins in
// vite.config.ts, which means a built site has no /api/sync and no data routes
// at all. This is the same behaviour as a standalone Node process so the app
// can be hosted.
//
// Serves: the built client from dist/, the player data from DATA_DIR, and
// POST /api/sync for the in-app lookup.
//
// Guards, because this faces the internet with a Riot key behind it:
//   - one sync at a time (same as dev)
//   - per-IP rate limit
//   - a cap on how many players are kept on disk
// Without them a bot could burn the key's rate limit or fill the volume.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { syncAndAnalyze } from './syncPlayer'
import { DATA_DIR, PLAYERS_DIR, loadEnv } from '../cli/env'

const SLUG_RE = /^[a-z0-9-]+$/
const MATCH_ID_RE = /^[A-Za-z0-9_-]+$/

const PORT = Number(process.env.PORT ?? 8080)
const DIST = process.env.WINCON_DIST ?? path.resolve('dist')
const MAX_PLAYERS = Number(process.env.WINCON_MAX_PLAYERS ?? 12)
const SYNCS_PER_HOUR = Number(process.env.WINCON_SYNCS_PER_HOUR ?? 4)
// never evicted, so the showcase player a recruiter lands on always resolves
const KEEP = (process.env.WINCON_KEEP_SLUGS ?? 'koda-10101')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const json = (res: http.ServerResponse, code: number, body: unknown) => {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

// ── rate limiting ─────────────────────────────────────────
const hits = new Map<string, number[]>()

function allow(ip: string): boolean {
  const now = Date.now()
  const cutoff = now - 60 * 60 * 1000
  const recent = (hits.get(ip) ?? []).filter(t => t > cutoff)
  if (recent.length >= SYNCS_PER_HOUR) {
    hits.set(ip, recent)
    return false
  }
  recent.push(now)
  hits.set(ip, recent)
  return true
}

const clientIp = (req: http.IncomingMessage): string => {
  const fwd = req.headers['x-forwarded-for']
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0]
  return (first ?? req.socket.remoteAddress ?? 'unknown').trim()
}

// ── disk cap ──────────────────────────────────────────────
// Cached matches and timelines are immutable, so evicting a player only costs
// a re-sync. Deletes are confined to PLAYERS_DIR, only touch directories whose
// names match the slug pattern, and never touch a protected slug.
function evictIfNeeded(): void {
  if (!fs.existsSync(PLAYERS_DIR)) return
  const dirs = fs
    .readdirSync(PLAYERS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && SLUG_RE.test(d.name) && !KEEP.includes(d.name))
    .map(d => ({
      name: d.name,
      mtime: fs.statSync(path.join(PLAYERS_DIR, d.name)).mtimeMs,
    }))
    .sort((a, b) => a.mtime - b.mtime)

  const total = dirs.length + KEEP.length
  for (let i = 0; i < total - MAX_PLAYERS && i < dirs.length; i++) {
    fs.rmSync(path.join(PLAYERS_DIR, dirs[i]!.name), { recursive: true, force: true })
    console.log(`[wincon] evicted cached player ${dirs[i]!.name}`)
  }
}

// ── data routes ───────────────────────────────────────────
function dataFileFor(url: string): string | null {
  if (url === '/players.json') return path.join(DATA_DIR, 'players.json')
  const report = url.match(/^\/report\/([^/]+)\.json$/)
  if (report && SLUG_RE.test(report[1]!)) {
    return path.join(PLAYERS_DIR, report[1]!, 'report.json')
  }
  const match = url.match(/^\/match\/([^/]+)\/([^/]+)\.json$/)
  if (match && SLUG_RE.test(match[1]!) && MATCH_ID_RE.test(match[2]!)) {
    return path.join(PLAYERS_DIR, match[1]!, 'matches', `${match[2]!}.json`)
  }
  return null
}

// ── static ────────────────────────────────────────────────
function serveStatic(url: string, res: http.ServerResponse): boolean {
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '')
  const file = path.join(DIST, rel)
  // resolve first, then confirm it is still inside DIST: blocks ../ traversal
  if (!path.resolve(file).startsWith(path.resolve(DIST))) return false
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
  if (rel !== 'index.html') res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.end(fs.readFileSync(file))
  return true
}

// ── sync ──────────────────────────────────────────────────
let busy = false

function handleSync(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = ''
  req.on('data', chunk => {
    body += chunk
    if (body.length > 2000) req.destroy()
  })
  req.on('end', async () => {
    // Validate BEFORE spending rate-limit quota. A typo should not cost someone
    // their hourly allowance; only requests that actually reach Riot do.
    let riotId: unknown
    try {
      riotId = JSON.parse(body || '{}').riotId
    } catch {
      return json(res, 400, { error: 'Body must be JSON like {"riotId":"Name#TAG"}' })
    }
    if (typeof riotId !== 'string' || !/^[^#]{3,16}#[A-Za-z0-9]{2,5}$/.test(riotId.trim())) {
      return json(res, 400, { error: 'Riot ID must look like Name#TAG' })
    }

    if (busy) return json(res, 429, { error: 'A sync is already running; wait for it to finish.' })
    if (!allow(clientIp(req))) {
      return json(res, 429, { error: `Rate limit: ${SYNCS_PER_HOUR} lookups per hour.` })
    }

    busy = true
    try {
      evictIfNeeded()
      const result = await syncAndAnalyze(riotId.trim())
      json(res, 200, result)
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : 'Sync failed' })
    } finally {
      busy = false
    }
  })
}

// ── server ────────────────────────────────────────────────
loadEnv()

if (!process.env.RIOT_API_KEY) {
  // not fatal: the site still serves whatever is already on disk, which is the
  // state it runs in before a Riot key is approved
  console.warn('[wincon] RIOT_API_KEY is not set. Lookups will fail; cached data still serves.')
}

const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0]!

  if (url === '/api/sync' && req.method === 'POST') return handleSync(req, res)
  if (url === '/healthz') return json(res, 200, { ok: true })

  const dataFile = dataFileFor(url)
  if (dataFile) {
    if (!fs.existsSync(dataFile)) {
      return url === '/players.json' ? json(res, 200, []) : json(res, 404, { error: 'Not found' })
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    return void res.end(fs.readFileSync(dataFile))
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' })
  if (serveStatic(url, res)) return
  // SPA fallback
  const index = path.join(DIST, 'index.html')
  if (fs.existsSync(index)) {
    res.setHeader('Content-Type', MIME['.html']!)
    return void res.end(fs.readFileSync(index))
  }
  json(res, 404, { error: 'Not found' })
})

server.listen(PORT, () => {
  console.log(`[wincon] listening on :${PORT}`)
  console.log(`[wincon] dist=${DIST}`)
  console.log(`[wincon] data=${DATA_DIR} (max ${MAX_PLAYERS} players, keep: ${KEEP.join(', ') || 'none'})`)
})

import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { buildClimbReport } from './src/analysis/report'
import { DEMO_PLAYER, generateDataset } from './src/fixtures/synthetic'
import { readLockfile } from './src/lcu/lockfile'
import { syncAndAnalyze } from './src/server/syncPlayer'

// Serve the per-player data files to the UI in dev. data/ is gitignored (it
// holds personal match history), so it can't live in public/. Slugs and match
// ids are validated before touching the filesystem.
const SLUG_RE = /^[a-z0-9-]+$/
const MATCH_ID_RE = /^[A-Za-z0-9_-]+$/

const serveData = (): Plugin => ({
  name: 'serve-data',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = req.url?.split('?')[0] ?? ''
      let file: string | null = null
      if (url === '/players.json') {
        // Mirrors the production server: mark the keep-listed player so the
        // landing preview features a known account, never a visitor's.
        const keep = (process.env.WINCON_KEEP_SLUGS ?? 'koda-10101')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
        const players = path.resolve('data/players.json')
        if (!fs.existsSync(players)) {
          res.statusCode = 404
          res.end('[]')
          return
        }
        const list = JSON.parse(fs.readFileSync(players, 'utf8')) as Record<string, unknown>[]
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(list.map(p => ({ ...p, showcase: keep.includes(String(p.slug)) }))))
        return
      } else {
        const report = url.match(/^\/report\/([^/]+)\.json$/)
        const match = url.match(/^\/match\/([^/]+)\/([^/]+)\.json$/)
        if (report && SLUG_RE.test(report[1]!)) {
          file = path.resolve('data/players', report[1]!, 'report.json')
        } else if (match && SLUG_RE.test(match[1]!) && MATCH_ID_RE.test(match[2]!)) {
          file = path.resolve('data/players', match[1]!, 'matches', `${match[2]!}.json`)
        } else {
          return next()
        }
      }
      if (!fs.existsSync(file)) {
        res.statusCode = 404
        res.end(url === '/players.json' ? '[]' : 'Not found. Run `npm run demo` or `npm run sync && npm run analyze`.')
        return
      }
      res.setHeader('Content-Type', 'application/json')
      res.end(fs.readFileSync(file))
    })
  },
})

// Proxy /lcu/* to the running League client's local API. The browser can't
// call it directly (self-signed cert + basic auth), so the dev server
// bridges: reads the lockfile, adds auth, and skips TLS verification for
// 127.0.0.1 only. 503 means "client not running"; the UI treats that as a
// quiet no-op, never an error.
const lcuProxy = (): Plugin => ({
  name: 'lcu-proxy',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/lcu/')) return next()
      const lock = readLockfile()
      if (!lock) {
        res.statusCode = 503
        res.setHeader('Content-Type', 'application/json')
        res.end('{"error":"league-client-not-running"}')
        return
      }
      const proxyReq = https.request(
        {
          hostname: '127.0.0.1',
          port: lock.port,
          path: req.url.slice('/lcu'.length),
          method: req.method,
          rejectUnauthorized: false,
          headers: {
            Authorization: `Basic ${Buffer.from(`riot:${lock.password}`).toString('base64')}`,
            Accept: 'application/json',
          },
        },
        proxyRes => {
          res.statusCode = proxyRes.statusCode ?? 500
          res.setHeader('Content-Type', 'application/json')
          proxyRes.pipe(res)
        },
      )
      proxyReq.on('error', () => {
        res.statusCode = 503
        res.setHeader('Content-Type', 'application/json')
        res.end('{"error":"league-client-unreachable"}')
      })
      req.pipe(proxyReq)
    })
  },
})

// POST /api/sync {riotId}: the in-app player lookup. Runs the same sync +
// analyze flow as the CLI, one at a time, using the API key from .env.
const apiSync = (): Plugin => ({
  name: 'api-sync',
  configureServer(server) {
    let busy = false
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== '/api/sync' || req.method !== 'POST') return next()
      res.setHeader('Content-Type', 'application/json')
      if (busy) {
        res.statusCode = 429
        res.end('{"error":"A sync is already running; wait for it to finish."}')
        return
      }
      busy = true
      let body = ''
      req.on('data', chunk => (body += chunk))
      req.on('end', async () => {
        try {
          const { riotId } = JSON.parse(body || '{}')
          if (typeof riotId !== 'string' || !riotId.includes('#')) {
            throw new Error('Riot ID must look like Name#TAG')
          }
          const result = await syncAndAnalyze(riotId)
          res.end(JSON.stringify(result))
        } catch (err) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Sync failed' }))
        } finally {
          busy = false
        }
      })
    })
  },
})

const portfolioDemo = (): Plugin => ({
  name: 'portfolio-demo',
  apply: 'build',
  generateBundle() {
    const slug = `${DEMO_PLAYER.gameName}-${DEMO_PLAYER.tagLine}`.toLowerCase()
    const showcase = JSON.parse(fs.readFileSync(path.resolve('src/fixtures/locke-vs-fizz.json'), 'utf8'))
    const entries = [showcase, ...generateDataset(7, 23)]
    const generatedAt = '2026-07-30T12:00:00.000Z'
    const report = buildClimbReport(entries, DEMO_PLAYER, { isDemo: true, generatedAt })
    const json = (value: unknown) => JSON.stringify(value)

    this.emitFile({
      type: 'asset',
      fileName: 'players.json',
      source: json([
        {
          slug,
          gameName: DEMO_PLAYER.gameName,
          tagLine: DEMO_PLAYER.tagLine,
          region: DEMO_PLAYER.region,
          games: report.matches.length,
          generatedAt,
          // The static build ships exactly one anonymized player, so it is the
          // showcase by definition.
          showcase: true,
        },
      ]),
    })
    this.emitFile({ type: 'asset', fileName: `report/${slug}.json`, source: json(report) })
    for (const entry of entries) {
      this.emitFile({
        type: 'asset',
        fileName: `match/${slug}/${entry.match.metadata.matchId}.json`,
        source: json(entry),
      })
    }
  },
})

export default defineConfig(() => {
  const isPortfolioDemo = process.env.WINCON_STATIC_DEMO === 'true'
  return {
    base: process.env.WINCON_BASE ?? '/',
    define: {
      'import.meta.env.VITE_PORTFOLIO_DEMO': JSON.stringify(isPortfolioDemo),
    },
    plugins: [
      react(),
      serveData(),
      lcuProxy(),
      apiSync(),
      ...(isPortfolioDemo ? [portfolioDemo()] : []),
    ],
  }
})

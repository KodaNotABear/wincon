import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { readLockfile } from './src/lcu/lockfile'

// Serve data/report.json to the UI in dev. data/ is gitignored (it holds
// personal match history), so it can't live in public/.
const serveReport = (): Plugin => ({
  name: 'serve-report',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== '/report.json') return next()
      const file = path.resolve('data/report.json')
      if (!fs.existsSync(file)) {
        res.statusCode = 404
        res.end('No report yet. Run `npm run demo` or `npm run sync && npm run analyze`.')
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

export default defineConfig({
  plugins: [react(), serveReport(), lcuProxy()],
})

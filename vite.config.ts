import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

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

export default defineConfig({
  plugins: [react(), serveReport()],
})

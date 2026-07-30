import fs from 'node:fs'
import path from 'node:path'

export const DATA_DIR = path.resolve('data')
export const MATCH_DIR = path.join(DATA_DIR, 'matches')

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

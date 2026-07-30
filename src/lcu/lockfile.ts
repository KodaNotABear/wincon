// The League client writes a lockfile while it runs:
//   name:pid:port:password:protocol
// Those credentials authenticate against its local HTTPS API (the LCU).

import fs from 'node:fs'

export interface LcuCredentials {
  port: number
  password: string
  protocol: string
}

const CANDIDATE_PATHS = [
  process.env.LCU_LOCKFILE,
  // macOS default install
  '/Applications/League of Legends.app/Contents/LoL/lockfile',
  // Windows default install (for when the desktop is back)
  'C:/Riot Games/League of Legends/lockfile',
].filter((p): p is string => Boolean(p))

export function parseLockfile(text: string): LcuCredentials | null {
  const parts = text.trim().split(':')
  if (parts.length < 5) return null
  const port = Number(parts[2])
  const password = parts[3]
  const protocol = parts[4]
  if (!Number.isInteger(port) || port <= 0 || !password || !protocol) return null
  return { port, password, protocol }
}

/** Credentials of the running client, or null when it isn't running. */
export function readLockfile(): LcuCredentials | null {
  for (const candidate of CANDIDATE_PATHS) {
    try {
      if (!fs.existsSync(candidate)) continue
      const parsed = parseLockfile(fs.readFileSync(candidate, 'utf8'))
      if (parsed) return parsed
    } catch {
      // Transient read errors (client mid-startup) read as "not running".
    }
  }
  return null
}

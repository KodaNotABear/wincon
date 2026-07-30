import { describe, expect, it } from 'vitest'
import { parseLockfile } from '../src/lcu/lockfile'

describe('parseLockfile', () => {
  it('parses the standard format', () => {
    expect(parseLockfile('LeagueClient:12345:52463:hunter2token:https')).toEqual({
      port: 52463,
      password: 'hunter2token',
      protocol: 'https',
    })
  })

  it('tolerates trailing whitespace', () => {
    expect(parseLockfile('LeagueClient:1:100:pw:https\n')?.port).toBe(100)
  })

  it('rejects malformed content', () => {
    expect(parseLockfile('')).toBeNull()
    expect(parseLockfile('garbage')).toBeNull()
    expect(parseLockfile('a:b:notaport:pw:https')).toBeNull()
    expect(parseLockfile('a:1:0:pw:https')).toBeNull()
    expect(parseLockfile('a:1:100::https')).toBeNull()
  })
})

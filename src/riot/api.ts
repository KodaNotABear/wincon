import { RiotClient } from './client'
import type { AccountDto, MatchDto, TimelineDto } from './types'

// account-v1 and match-v5 both use regional routing, not platform routing.
export const REGIONAL_HOSTS: Record<string, string> = {
  americas: 'americas.api.riotgames.com',
  europe: 'europe.api.riotgames.com',
  asia: 'asia.api.riotgames.com',
  sea: 'sea.api.riotgames.com',
}

export function regionalHost(region: string): string {
  const host = REGIONAL_HOSTS[region]
  if (!host) {
    throw new Error(`Unknown region "${region}". Use one of: ${Object.keys(REGIONAL_HOSTS).join(', ')}`)
  }
  return host
}

export function accountByRiotId(
  client: RiotClient,
  region: string,
  gameName: string,
  tagLine: string,
): Promise<AccountDto> {
  return client.get<AccountDto>(
    regionalHost(region),
    `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
  )
}

export async function rankedMatchIds(
  client: RiotClient,
  region: string,
  puuid: string,
  count: number,
  queue: number,
): Promise<string[]> {
  const ids: string[] = []
  // The ids endpoint caps count at 100 per request.
  for (let start = 0; ids.length < count; start += 100) {
    const page = await client.get<string[]>(
      regionalHost(region),
      `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${queue}&start=${start}&count=${Math.min(100, count - ids.length)}`,
    )
    ids.push(...page)
    if (page.length < 100) break
  }
  return ids.slice(0, count)
}

export function getMatch(client: RiotClient, region: string, matchId: string): Promise<MatchDto> {
  return client.get<MatchDto>(regionalHost(region), `/lol/match/v5/matches/${matchId}`)
}

export function getTimeline(client: RiotClient, region: string, matchId: string): Promise<TimelineDto> {
  return client.get<TimelineDto>(regionalHost(region), `/lol/match/v5/matches/${matchId}/timeline`)
}

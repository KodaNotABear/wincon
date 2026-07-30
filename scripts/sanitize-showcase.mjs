import fs from 'node:fs'
import path from 'node:path'

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('Usage: node scripts/sanitize-showcase.mjs <raw-match.json> <fixture.json>')
  process.exit(1)
}

const entry = JSON.parse(fs.readFileSync(input, 'utf8'))
const participants = entry.match.info.participants
const me = participants.find(
  participant => participant.championName === 'Locke' && participant.teamPosition === 'MIDDLE',
)
if (!me) throw new Error('Could not find the Locke mid participant.')

const puuidMap = new Map()
const summonerIdMap = new Map()
for (const participant of participants) {
  const isMe = participant.participantId === me.participantId
  const demoPuuid = isMe ? 'demo-puuid-me' : `demo-puuid-${participant.participantId}`
  const demoSummonerId = isMe ? 'demo-summoner-me' : `demo-summoner-${participant.participantId}`
  puuidMap.set(participant.puuid, demoPuuid)
  summonerIdMap.set(participant.summonerId, demoSummonerId)
  participant.puuid = demoPuuid
  participant.summonerId = demoSummonerId
  participant.riotIdGameName = isMe ? 'DemoClimber' : `Player${participant.participantId}`
  participant.riotIdTagline = isMe ? 'NA1' : 'DEMO'
  participant.summonerName = ''
}

const replaceIds = value => {
  if (Array.isArray(value)) return value.map(replaceIds)
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) value[key] = replaceIds(child)
    return value
  }
  if (typeof value !== 'string') return value
  return puuidMap.get(value) ?? summonerIdMap.get(value) ?? value
}
replaceIds(entry)

const targetCreation = Date.UTC(2026, 6, 28, 9, 0, 0)
const timestampShift = targetCreation - entry.match.info.gameCreation
const shiftAbsoluteTimes = value => {
  if (Array.isArray(value)) {
    value.forEach(shiftAbsoluteTimes)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (
      typeof child === 'number' &&
      child > 1_000_000_000_000 &&
      (key.endsWith('Timestamp') || key === 'gameCreation')
    ) {
      value[key] = child + timestampShift
    } else {
      shiftAbsoluteTimes(child)
    }
  }
}
shiftAbsoluteTimes(entry)

entry.match.metadata.matchId = 'SHOWCASE_LOCKE_FIZZ'
entry.match.metadata.participants = entry.match.metadata.participants.map(puuid => puuidMap.get(puuid) ?? puuid)
entry.timeline.metadata.matchId = 'SHOWCASE_LOCKE_FIZZ'
entry.match.info.gameId = 9_001_001
entry.match.info.gameName = 'portfolio-showcase'
entry.timeline.info.gameId = 9_001_001
entry.timeline.info.participants = entry.timeline.info.participants.map(participant => ({
  ...participant,
  puuid: puuidMap.get(participant.puuid) ?? participant.puuid,
}))

fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, JSON.stringify(entry))
console.log(`Sanitized showcase written to ${output}`)

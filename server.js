// src/server/serve.ts
import http from "node:http";
import fs3 from "node:fs";
import path3 from "node:path";

// src/server/syncPlayer.ts
import fs2 from "node:fs";
import path2 from "node:path";

// src/riot/client.ts
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var RiotClient = class {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }
  apiKey;
  windows = [
    { limit: 18, ms: 1e3 },
    { limit: 95, ms: 12e4 }
  ];
  sent = [];
  async waitForSlot() {
    for (; ; ) {
      const now = Date.now();
      this.sent = this.sent.filter((t) => now - t < 12e4);
      let wait = 0;
      for (const w of this.windows) {
        const inWindow = this.sent.filter((t) => now - t < w.ms);
        if (inWindow.length >= w.limit) {
          wait = Math.max(wait, inWindow[0] + w.ms - now);
        }
      }
      if (wait <= 0) break;
      await sleep(wait + 25);
    }
    this.sent.push(Date.now());
  }
  async get(host, path4) {
    for (let attempt = 0; ; attempt++) {
      await this.waitForSlot();
      const res = await fetch(`https://${host}${path4}`, {
        headers: { "X-Riot-Token": this.apiKey }
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") ?? 10);
        await sleep(retryAfter * 1e3);
        continue;
      }
      if (res.status >= 500 && attempt < 3) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        throw new Error(`Riot API ${res.status} on ${path4}: ${await res.text()}`);
      }
      return res.json();
    }
  }
};

// src/riot/api.ts
var REGIONAL_HOSTS = {
  americas: "americas.api.riotgames.com",
  europe: "europe.api.riotgames.com",
  asia: "asia.api.riotgames.com",
  sea: "sea.api.riotgames.com"
};
function regionalHost(region) {
  const host = REGIONAL_HOSTS[region];
  if (!host) {
    throw new Error(`Unknown region "${region}". Use one of: ${Object.keys(REGIONAL_HOSTS).join(", ")}`);
  }
  return host;
}
function accountByRiotId(client, region, gameName, tagLine) {
  return client.get(
    regionalHost(region),
    `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  );
}
async function rankedMatchIds(client, region, puuid, count, queue) {
  const ids = [];
  for (let start = 0; ids.length < count; start += 100) {
    const page = await client.get(
      regionalHost(region),
      `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${queue}&start=${start}&count=${Math.min(100, count - ids.length)}`
    );
    ids.push(...page);
    if (page.length < 100) break;
  }
  return ids.slice(0, count);
}
function getMatch(client, region, matchId) {
  return client.get(regionalHost(region), `/lol/match/v5/matches/${matchId}`);
}
function getTimeline(client, region, matchId) {
  return client.get(regionalHost(region), `/lol/match/v5/matches/${matchId}/timeline`);
}

// src/riot/types.ts
function normalizeDuration(gameDuration) {
  return gameDuration > 3e4 ? Math.round(gameDuration / 1e3) : gameDuration;
}

// src/analysis/metrics.ts
var MAP_MAX = 14870;
var EARLY_END_MIN = 14;
var MID_END_MIN = 25;
function phaseOf(minute) {
  if (minute < EARLY_END_MIN) return "early";
  if (minute < MID_END_MIN) return "mid";
  return "late";
}
function participantOf(match, puuid) {
  return match.info.participants.find((p) => p.puuid === puuid);
}
function laneOpponentOf(match, me) {
  if (!me.teamPosition) return void 0;
  return match.info.participants.find(
    (p) => p.teamId !== me.teamId && p.teamPosition === me.teamPosition
  );
}
function frameAtMinute(timeline, minute) {
  const cutoff = minute * 6e4 + 500;
  const eligible = timeline.info.frames.filter((f) => f.timestamp <= cutoff);
  return eligible[eligible.length - 1];
}
function laningDiffs(timeline, myId, oppId) {
  const at = (minute) => {
    const frame = frameAtMinute(timeline, minute);
    if (!frame || frame.timestamp < minute * 6e4 - 500) return null;
    const mine = frame.participantFrames[String(myId)];
    if (!mine) return null;
    const theirs = oppId ? frame.participantFrames[String(oppId)] : void 0;
    return { frame, mine, theirs };
  };
  const f10 = at(10);
  const f14 = at(14);
  const diff = (snap, field) => snap && snap.theirs ? snap.mine[field] - snap.theirs[field] : null;
  const csDiff = (snap) => snap && snap.theirs ? snap.mine.minionsKilled + snap.mine.jungleMinionsKilled - (snap.theirs.minionsKilled + snap.theirs.jungleMinionsKilled) : null;
  return {
    csDiff10: csDiff(f10),
    csDiff14: csDiff(f14),
    goldDiff10: diff(f10, "totalGold"),
    goldDiff14: diff(f14, "totalGold"),
    xpDiff10: diff(f10, "xp"),
    xpDiff14: diff(f14, "xp"),
    cs10: f10 ? f10.mine.minionsKilled + f10.mine.jungleMinionsKilled : null
  };
}
function onEnemySide(pos, teamId) {
  const d = pos.x + pos.y;
  return teamId === 100 ? d > MAP_MAX * 1.06 : d < MAP_MAX * 0.94;
}
function deathsOf(timeline, myId, teamId) {
  const out = [];
  for (const frame of timeline.info.frames) {
    for (const event of frame.events) {
      if (event.type !== "CHAMPION_KILL") continue;
      const kill = event;
      if (kill.victimId !== myId) continue;
      const minute = kill.timestamp / 6e4;
      out.push({
        minute,
        phase: phaseOf(minute),
        x: kill.position.x,
        y: kill.position.y,
        enemySide: onEnemySide(kill.position, teamId)
      });
    }
  }
  return out;
}
function objectivesOf(timeline, myId, teamId) {
  let teamTaken = 0;
  let credited = 0;
  for (const frame of timeline.info.frames) {
    for (const event of frame.events) {
      if (event.type !== "ELITE_MONSTER_KILL") continue;
      const kill = event;
      if (kill.killerTeamId !== teamId) continue;
      teamTaken++;
      if (kill.killerId === myId || kill.assistingParticipantIds?.includes(myId)) credited++;
    }
  }
  return { teamTaken, credited };
}

// src/analysis/benchmarks.ts
var BENCHMARKS = {
  TOP: { cs10: { solid: 62, strong: 75 }, visionPerMin: { solid: 0.8, strong: 1.2 } },
  MIDDLE: { cs10: { solid: 65, strong: 80 }, visionPerMin: { solid: 0.9, strong: 1.3 } },
  BOTTOM: { cs10: { solid: 68, strong: 82 }, visionPerMin: { solid: 0.9, strong: 1.3 } },
  // Junglers farm camps on a different curve; cs10 targets full clears + counterjungle.
  JUNGLE: { cs10: { solid: 55, strong: 68 }, visionPerMin: { solid: 1.1, strong: 1.6 } },
  UTILITY: { visionPerMin: { solid: 1.8, strong: 2.4 } }
};
function benchmarkFor(role) {
  return role ? BENCHMARKS[role] : void 0;
}

// src/analysis/insights.ts
var fmt = (x, digits = 1) => (x >= 0 ? "+" : "") + x.toFixed(digits);
var pct = (x) => `${Math.round(x * 100)}%`;
var HALF_LIFE = 12;
function scoreChampions(matches) {
  const byChamp = /* @__PURE__ */ new Map();
  matches.forEach((m, age) => {
    const entry = byChamp.get(m.championName) ?? {
      name: m.championName,
      games: 0,
      wins: 0,
      weight: 0,
      weightedWins: 0,
      recentTen: 0
    };
    const w = 0.5 ** (age / HALF_LIFE);
    entry.games += 1;
    entry.wins += m.win ? 1 : 0;
    entry.weight += w;
    entry.weightedWins += m.win ? w : 0;
    if (age < 10) entry.recentTen += 1;
    byChamp.set(m.championName, entry);
  });
  return [...byChamp.values()];
}
function championGuidance(agg, matches) {
  const poolSize = Object.keys(agg.championCounts).length;
  if (agg.games < 15) return null;
  if (matches.length === 0) {
    if (poolSize <= 6) return null;
    const top = Object.entries(agg.championCounts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name).join(" and ");
    return {
      id: "wide-champ-pool",
      severity: "warn",
      title: "Your champion pool is too wide to climb with",
      detail: `${poolSize} different champions in ${agg.games} games. Mastery beats variety for climbing; consider narrowing to ${top} plus one backup.`
    };
  }
  const scored = scoreChampions(matches);
  const emerging = scored.filter((c) => c.recentTen >= 4).sort((a, b) => b.recentTen - a.recentTen)[0];
  if (emerging) {
    const wr = emerging.wins / emerging.games;
    if (wr >= 0.5) {
      return {
        id: "emerging-main",
        severity: "good",
        title: `${emerging.name} is becoming your main, and it's working`,
        detail: `${emerging.recentTen} of your last 10 games on ${emerging.name} at ${pct(wr)} overall (${emerging.wins}W ${emerging.games - emerging.wins}L). Keep queueing them.`
      };
    }
    return {
      id: "emerging-main-struggling",
      severity: "info",
      title: `You're committing to ${emerging.name}; the results aren't there yet`,
      detail: `${emerging.recentTen} of your last 10 games on ${emerging.name}, but ${pct(wr)} winrate over ${emerging.games} games. Give it 20 games before judging; review the losses on them specifically.`
    };
  }
  if (poolSize > 6) {
    const score = (c) => c.weightedWins / Math.max(c.weight, 0.01) + c.weight * 0.02;
    const best = scored.filter((c) => c.games >= 3).sort((a, b) => score(b) - score(a)).slice(0, 2);
    const naming = best.length ? best.map((c) => `${c.name} (${pct(c.wins / c.games)} in ${c.games})`).join(" and ") : Object.entries(agg.championCounts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n).join(" and ");
    return {
      id: "wide-champ-pool",
      severity: "warn",
      title: "Your champion pool is too wide to climb with",
      detail: `${poolSize} different champions in ${agg.games} games and no champion in more than a few of your recent picks. Based on recent results your best bets are ${naming}.`
    };
  }
  return null;
}
function momentum(matches) {
  if (matches.length < 16) return null;
  const half = Math.floor(matches.length / 2);
  const recent = matches.slice(0, half);
  const older = matches.slice(half);
  const winrate = (xs) => xs.filter((m) => m.win).length / xs.length;
  const earlyDeaths = (xs) => xs.reduce((a, m) => a + m.deathsByPhase.early, 0) / xs.length;
  const csDiff = (xs) => {
    const vals = xs.map((m) => m.laning.csDiff10).filter((v) => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const wrDelta = winrate(recent) - winrate(older);
  if (Math.abs(wrDelta) >= 0.12) {
    const up = wrDelta > 0;
    return {
      id: "momentum",
      severity: up ? "good" : "warn",
      title: up ? "Your recent games are trending up" : "Your recent games are trending down",
      detail: `Last ${half} games: ${pct(winrate(recent))} winrate vs ${pct(winrate(older))} in the ${matches.length - half} before them. ${up ? "Keep whatever changed." : "Worth asking what changed: champion, role, or queueing tired."}`
    };
  }
  const edDelta = earlyDeaths(recent) - earlyDeaths(older);
  if (Math.abs(edDelta) >= 0.6) {
    const down = edDelta < 0;
    return {
      id: "momentum",
      severity: down ? "good" : "warn",
      title: down ? "Early deaths are trending down" : "Early deaths are creeping up",
      detail: `${earlyDeaths(older).toFixed(1)} per game in your older half vs ${earlyDeaths(recent).toFixed(1)} in your last ${half}. ${down ? "That is the single best predictor in this report; keep it going." : "The laning phase is getting bloodier; slow it down."}`
    };
  }
  const csRecent = csDiff(recent);
  const csOlder = csDiff(older);
  if (csRecent !== null && csOlder !== null && Math.abs(csRecent - csOlder) >= 6) {
    const up = csRecent > csOlder;
    return {
      id: "momentum",
      severity: up ? "good" : "warn",
      title: up ? "Laning is improving" : "Laning is slipping",
      detail: `CS diff at 10:00 moved from ${fmt(csOlder)} to ${fmt(csRecent)} across your last ${half} games.`
    };
  }
  return null;
}
function buildInsights(agg, matches) {
  const out = [];
  const bench = benchmarkFor(agg.primaryRole);
  if (agg.avgCsDiff10 !== null) {
    if (agg.avgCsDiff10 <= -8) {
      out.push({
        id: "losing-lane-cs",
        severity: "bad",
        title: "You lose the farm battle in lane",
        detail: `Average CS diff at 10:00 is ${fmt(agg.avgCsDiff10)} vs your lane opponent. That's an item component behind by the first fight. Catch waves under tower before looking for trades.`
      });
    } else if (agg.avgCsDiff10 >= 8) {
      out.push({
        id: "winning-lane-cs",
        severity: "good",
        title: "Laning is a strength",
        detail: `Average CS diff at 10:00 is ${fmt(agg.avgCsDiff10)}. You reliably come out of lane ahead; the climb blocker is elsewhere.`
      });
    }
  }
  if (bench?.cs10 && agg.avgCs10 !== null && agg.avgCs10 < bench.cs10.solid) {
    out.push({
      id: "low-cs10",
      severity: "warn",
      title: `CS at 10:00 is below target for ${agg.primaryRole.toLowerCase()}`,
      detail: `You average ${agg.avgCs10.toFixed(0)} CS at 10:00; ${bench.cs10.solid} keeps you even and ${bench.cs10.strong} puts you ahead.`
    });
  }
  if (agg.deathsByPhasePerGame.early >= 1.6) {
    const share = agg.earlyEnemySideShare;
    const overextending = share !== null && share >= 0.4;
    out.push({
      id: "early-deaths",
      severity: "bad",
      title: "Too many deaths before 14:00",
      detail: `You average ${agg.deathsByPhasePerGame.early.toFixed(1)} deaths in the laning phase` + (overextending ? `, and ${Math.round(share * 100)}% of them happen on the enemy's side of the map. That pattern is overextension without vision: you are pushing past the river before you know where their jungler is.` : `. Each one hands over lane priority and plates.`)
    });
  }
  if (agg.objectiveParticipation !== null && agg.objectiveParticipation < 0.45) {
    out.push({
      id: "low-obj-participation",
      severity: "warn",
      title: "You are absent when objectives are taken",
      detail: `You are credited on ${pct(agg.objectiveParticipation)} of your team's epic monsters. Emerald games are decided at dragon and baron; start rotating 30 seconds before spawns instead of taking one more wave.`
    });
  }
  if (bench && agg.avgVisionPerMin < bench.visionPerMin.solid) {
    out.push({
      id: "low-vision",
      severity: "warn",
      title: "Vision score is below target",
      detail: `You average ${agg.avgVisionPerMin.toFixed(2)} vision score per minute; the target for ${agg.primaryRole.toLowerCase()} is ${bench.visionPerMin.solid.toFixed(1)}+. Buy control wards on every base once laning ends.`
    });
  }
  const champInsight = championGuidance(agg, matches);
  if (champInsight) out.push(champInsight);
  const momentumInsight = momentum(matches);
  if (momentumInsight) out.push(momentumInsight);
  const biggest = [...agg.winLossGaps].sort((a, b) => {
    const rel = (g) => Math.abs(g.winsAvg - g.lossesAvg) / (Math.abs(g.winsAvg) + Math.abs(g.lossesAvg) || 1);
    return rel(b) - rel(a);
  })[0];
  if (biggest && agg.games >= 10) {
    out.push({
      id: "win-loss-gap",
      severity: "info",
      title: "What your wins have in common",
      detail: `The metric that separates your wins from your losses most is ${biggest.metric}: ${fmt(biggest.winsAvg)} in wins vs ${fmt(biggest.lossesAvg)} in losses.`
    });
  }
  const order = ["bad", "warn", "info", "good"];
  return out.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
}
function matchFlags(m) {
  const out = [];
  if (m.laning.csDiff10 !== null && m.laning.csDiff10 <= -15) {
    out.push({
      id: "match-lost-lane",
      severity: "bad",
      title: `Lost lane on farm (${fmt(m.laning.csDiff10, 0)} CS at 10)`,
      detail: ""
    });
  }
  if (m.deathsByPhase.early >= 3) {
    out.push({
      id: "match-early-deaths",
      severity: "bad",
      title: `${m.deathsByPhase.early} deaths before 14:00`,
      detail: ""
    });
  }
  if (m.objectives.teamTaken >= 3 && m.objectives.credited === 0) {
    out.push({
      id: "match-no-objectives",
      severity: "warn",
      title: `0 of ${m.objectives.teamTaken} team objectives`,
      detail: ""
    });
  }
  if (m.laning.csDiff10 !== null && m.laning.csDiff10 >= 20 && m.win) {
    out.push({
      id: "match-stomped-lane",
      severity: "good",
      title: `Won lane hard (${fmt(m.laning.csDiff10, 0)} CS at 10)`,
      detail: ""
    });
  }
  const order = ["bad", "warn", "info", "good"];
  return out.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity)).slice(0, 2);
}

// src/analysis/report.ts
function buildMatchReport(match, timeline, puuid) {
  const me = participantOf(match, puuid);
  if (!me) return null;
  const durationMin = normalizeDuration(match.info.gameDuration) / 60;
  if (durationMin < 5) return null;
  const opp = laneOpponentOf(match, me);
  const deathList = deathsOf(timeline, me.participantId, me.teamId);
  const deathsByPhase = {
    early: deathList.filter((d) => d.phase === "early").length,
    mid: deathList.filter((d) => d.phase === "mid").length,
    late: deathList.filter((d) => d.phase === "late").length
  };
  const report = {
    matchId: match.metadata.matchId,
    gameCreation: match.info.gameCreation,
    durationMin,
    championName: me.championName,
    role: me.teamPosition,
    win: me.win,
    kills: me.kills,
    deaths: me.deaths,
    assists: me.assists,
    opponentChampion: opp?.championName ?? null,
    laning: laningDiffs(timeline, me.participantId, opp?.participantId),
    deathList,
    deathsByPhase,
    objectives: objectivesOf(timeline, me.participantId, me.teamId),
    visionPerMin: me.visionScore / durationMin,
    flags: []
  };
  report.flags = matchFlags(report);
  return report;
}
var avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
function counted(values) {
  const out = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}
function buildAggregate(matches) {
  const wins = matches.filter((m) => m.win);
  const losses = matches.filter((m) => !m.win);
  const roleCounts = counted(matches.map((m) => m.role || "UNKNOWN"));
  const primaryRole = Object.entries(roleCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const earlyDeaths = matches.flatMap((m) => m.deathList.filter((d) => d.phase === "early"));
  const objTaken = matches.reduce((a, m) => a + m.objectives.teamTaken, 0);
  const objCredited = matches.reduce((a, m) => a + m.objectives.credited, 0);
  const gapMetrics = [
    { metric: "CS diff at 10:00", pick: (m) => m.laning.csDiff10 },
    { metric: "gold diff at 14:00", pick: (m) => m.laning.goldDiff14 },
    { metric: "deaths before 14:00", pick: (m) => m.deathsByPhase.early },
    { metric: "vision score per minute", pick: (m) => m.visionPerMin }
  ];
  const winLossGaps = gapMetrics.map(({ metric, pick }) => {
    const w = avg(wins.map(pick).filter((x) => x !== null));
    const l = avg(losses.map(pick).filter((x) => x !== null));
    return w !== null && l !== null ? { metric, winsAvg: w, lossesAvg: l } : null;
  }).filter((x) => x !== null);
  const n = matches.length || 1;
  return {
    games: matches.length,
    wins: wins.length,
    winrate: matches.length ? wins.length / matches.length : 0,
    primaryRole,
    roleCounts,
    championCounts: counted(matches.map((m) => m.championName)),
    avgCs10: avg(matches.map((m) => m.laning.cs10).filter((x) => x !== null)),
    avgCsDiff10: avg(matches.map((m) => m.laning.csDiff10).filter((x) => x !== null)),
    avgGoldDiff14: avg(matches.map((m) => m.laning.goldDiff14).filter((x) => x !== null)),
    avgDeaths: matches.reduce((a, m) => a + m.deaths, 0) / n,
    deathsByPhasePerGame: {
      early: matches.reduce((a, m) => a + m.deathsByPhase.early, 0) / n,
      mid: matches.reduce((a, m) => a + m.deathsByPhase.mid, 0) / n,
      late: matches.reduce((a, m) => a + m.deathsByPhase.late, 0) / n
    },
    earlyEnemySideShare: earlyDeaths.length ? earlyDeaths.filter((d) => d.enemySide).length / earlyDeaths.length : null,
    objectiveParticipation: objTaken ? objCredited / objTaken : null,
    avgVisionPerMin: matches.reduce((a, m) => a + m.visionPerMin, 0) / n,
    winLossGaps
  };
}
function buildClimbReport(entries, player, opts) {
  const matches = entries.map((e) => buildMatchReport(e.match, e.timeline, player.puuid)).filter((m) => m !== null).sort((a, b) => b.gameCreation - a.gameCreation);
  const aggregate = buildAggregate(matches);
  return {
    schema: 1,
    isDemo: opts.isDemo,
    generatedAt: opts.generatedAt,
    player,
    matches,
    aggregate,
    insights: buildInsights(aggregate, matches)
  };
}

// src/cli/env.ts
import fs from "node:fs";
import path from "node:path";
function applyDotEnv() {
  const file = path.resolve(".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
applyDotEnv();
var DATA_DIR = process.env.WINCON_DATA_DIR ? path.resolve(process.env.WINCON_DATA_DIR) : path.resolve("data");
var PLAYERS_DIR = path.join(DATA_DIR, "players");
function slugify(gameName, tagLine) {
  return `${gameName}-${tagLine}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
var playerDir = (slug) => path.join(PLAYERS_DIR, slug);
var matchDir = (slug) => path.join(playerDir(slug), "matches");
function writePlayersIndex() {
  const entries = [];
  if (fs.existsSync(PLAYERS_DIR)) {
    for (const slug of fs.readdirSync(PLAYERS_DIR)) {
      const playerFile = path.join(playerDir(slug), "player.json");
      if (!fs.existsSync(playerFile)) continue;
      const player = JSON.parse(fs.readFileSync(playerFile, "utf8"));
      const reportFile = path.join(playerDir(slug), "report.json");
      let games = 0;
      let generatedAt = null;
      if (fs.existsSync(reportFile)) {
        const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
        games = report.matches?.length ?? 0;
        generatedAt = report.generatedAt ?? null;
      }
      entries.push({
        slug,
        gameName: player.gameName,
        tagLine: player.tagLine,
        region: player.region,
        games,
        generatedAt
      });
    }
  }
  entries.sort((a, b) => (b.generatedAt ?? "").localeCompare(a.generatedAt ?? ""));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, "players.json"), JSON.stringify(entries, null, 2));
}
function migrateLegacyLayout() {
  const legacyPlayer = path.join(DATA_DIR, "player.json");
  if (!fs.existsSync(legacyPlayer)) return;
  const player = JSON.parse(fs.readFileSync(legacyPlayer, "utf8"));
  const slug = slugify(player.gameName, player.tagLine);
  fs.mkdirSync(matchDir(slug), { recursive: true });
  const legacyMatches = path.join(DATA_DIR, "matches");
  if (fs.existsSync(legacyMatches)) {
    for (const file of fs.readdirSync(legacyMatches)) {
      fs.renameSync(path.join(legacyMatches, file), path.join(matchDir(slug), file));
    }
    fs.rmdirSync(legacyMatches);
  }
  fs.renameSync(legacyPlayer, path.join(playerDir(slug), "player.json"));
  const legacyReport = path.join(DATA_DIR, "report.json");
  if (fs.existsSync(legacyReport)) {
    fs.renameSync(legacyReport, path.join(playerDir(slug), "report.json"));
  }
  console.log(`Migrated existing data to data/players/${slug}/`);
}
function loadEnv() {
  applyDotEnv();
}

// src/server/syncPlayer.ts
async function syncAndAnalyze(riotId, onProgress) {
  loadEnv();
  migrateLegacyLayout();
  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) throw new Error("RIOT_API_KEY is missing. Add a key from developer.riotgames.com to .env");
  const region = process.env.REGION ?? "americas";
  const count = Number(process.env.COUNT ?? 40);
  const queue = Number(process.env.QUEUE ?? 420);
  const [gameName, tagLine] = riotId.split("#");
  if (!gameName || !tagLine) throw new Error("Riot ID must look like Name#TAG");
  const client = new RiotClient(apiKey);
  onProgress?.(`Looking up ${gameName}#${tagLine} (${region})...`);
  let account;
  try {
    account = await accountByRiotId(client, region, gameName, tagLine);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes(" 404 ")) throw new Error(`No player named ${gameName}#${tagLine} in ${region}`);
    if (message.includes(" 401 ") || message.includes(" 403 ")) {
      throw new Error("Riot API key rejected. Dev keys expire daily; paste a fresh one into .env");
    }
    throw err;
  }
  const slug = slugify(account.gameName, account.tagLine);
  fs2.mkdirSync(matchDir(slug), { recursive: true });
  fs2.writeFileSync(
    path2.join(playerDir(slug), "player.json"),
    JSON.stringify({ puuid: account.puuid, gameName: account.gameName, tagLine: account.tagLine, region }, null, 2)
  );
  const ids = await rankedMatchIds(client, region, account.puuid, count, queue);
  onProgress?.(`Found ${ids.length} ranked games (queue ${queue}).`);
  let fetched = 0;
  let cached = 0;
  for (const id of ids) {
    const file = path2.join(matchDir(slug), `${id}.json`);
    if (fs2.existsSync(file)) {
      cached++;
      continue;
    }
    const [match, timeline] = [await getMatch(client, region, id), await getTimeline(client, region, id)];
    fs2.writeFileSync(file, JSON.stringify({ match, timeline }));
    fetched++;
    onProgress?.(`${fetched} fetched, ${cached} cached`);
  }
  const entries = fs2.readdirSync(matchDir(slug)).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs2.readFileSync(path2.join(matchDir(slug), f), "utf8")));
  const report = buildClimbReport(
    entries,
    { puuid: account.puuid, gameName: account.gameName, tagLine: account.tagLine, region },
    { isDemo: false, generatedAt: (/* @__PURE__ */ new Date()).toISOString() }
  );
  fs2.writeFileSync(path2.join(playerDir(slug), "report.json"), JSON.stringify(report, null, 2));
  writePlayersIndex();
  return {
    slug,
    gameName: account.gameName,
    tagLine: account.tagLine,
    games: report.matches.length,
    fetched,
    cached
  };
}

// src/server/serve.ts
var SLUG_RE = /^[a-z0-9-]+$/;
var MATCH_ID_RE = /^[A-Za-z0-9_-]+$/;
var PORT = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 8080);
var DIST = process.env.WINCON_DIST ?? path3.resolve("dist");
var MAX_PLAYERS = Number(process.env.WINCON_MAX_PLAYERS ?? 12);
var SYNCS_PER_HOUR = Number(process.env.WINCON_SYNCS_PER_HOUR ?? 4);
var KEEP = (process.env.WINCON_KEEP_SLUGS ?? "koda-10101").split(",").map((s) => s.trim()).filter(Boolean);
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};
var json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};
var hits = /* @__PURE__ */ new Map();
function allow(ip) {
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1e3;
  const recent = (hits.get(ip) ?? []).filter((t) => t > cutoff);
  if (recent.length >= SYNCS_PER_HOUR) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}
var DEFAULT_TRUSTED_PROXIES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22"
].join(",");
var toV4 = (ip) => {
  const m = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const octet = Number(m[i]);
    if (octet > 255) return null;
    n = n * 256 + octet;
  }
  return n;
};
var TRUSTED_PROXIES = (process.env.WINCON_TRUSTED_PROXIES ?? DEFAULT_TRUSTED_PROXIES).split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
  const [addr, bitsRaw] = entry.split("/");
  const base = toV4(addr ?? "");
  const bits = bitsRaw === void 0 ? 32 : Number(bitsRaw);
  if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : 4294967295 << 32 - bits >>> 0;
  return { base: (base & mask) >>> 0, mask };
}).filter((cidr) => cidr !== null);
var fromTrustedProxy = (ip) => {
  const n = toV4(ip);
  return n === null ? false : TRUSTED_PROXIES.some(({ base, mask }) => (n & mask) >>> 0 === base);
};
var clientIp = (req) => {
  const peer = (req.socket.remoteAddress ?? "unknown").trim();
  if (!fromTrustedProxy(peer)) return peer;
  const cf = req.headers["cf-connecting-ip"];
  const forwarded = Array.isArray(cf) ? cf[0] : cf;
  return (forwarded ?? peer).trim();
};
function evictIfNeeded() {
  if (!fs3.existsSync(PLAYERS_DIR)) return;
  const dirs = fs3.readdirSync(PLAYERS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && SLUG_RE.test(d.name) && !KEEP.includes(d.name)).map((d) => ({
    name: d.name,
    mtime: fs3.statSync(path3.join(PLAYERS_DIR, d.name)).mtimeMs
  })).sort((a, b) => a.mtime - b.mtime);
  const total = dirs.length + KEEP.length;
  for (let i = 0; i < total - MAX_PLAYERS && i < dirs.length; i++) {
    fs3.rmSync(path3.join(PLAYERS_DIR, dirs[i].name), { recursive: true, force: true });
    console.log(`[wincon] evicted cached player ${dirs[i].name}`);
  }
}
function dataFileFor(url) {
  if (url === "/players.json") return path3.join(DATA_DIR, "players.json");
  const report = url.match(/^\/report\/([^/]+)\.json$/);
  if (report && SLUG_RE.test(report[1])) {
    return path3.join(PLAYERS_DIR, report[1], "report.json");
  }
  const match = url.match(/^\/match\/([^/]+)\/([^/]+)\.json$/);
  if (match && SLUG_RE.test(match[1]) && MATCH_ID_RE.test(match[2])) {
    return path3.join(PLAYERS_DIR, match[1], "matches", `${match[2]}.json`);
  }
  return null;
}
function serveStatic(url, res) {
  const rel = url === "/" ? "index.html" : url.replace(/^\/+/, "");
  const file = path3.join(DIST, rel);
  if (!path3.resolve(file).startsWith(path3.resolve(DIST))) return false;
  if (!fs3.existsSync(file) || !fs3.statSync(file).isFile()) return false;
  res.setHeader("Content-Type", MIME[path3.extname(file).toLowerCase()] ?? "application/octet-stream");
  if (rel !== "index.html") res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.end(fs3.readFileSync(file));
  return true;
}
var busy = false;
function handleSync(req, res) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 2e3) req.destroy();
  });
  req.on("end", async () => {
    let riotId;
    try {
      riotId = JSON.parse(body || "{}").riotId;
    } catch {
      return json(res, 400, { error: 'Body must be JSON like {"riotId":"Name#TAG"}' });
    }
    if (typeof riotId !== "string" || !/^[^#]{3,16}#[A-Za-z0-9]{2,5}$/.test(riotId.trim())) {
      return json(res, 400, { error: "Riot ID must look like Name#TAG" });
    }
    if (busy) return json(res, 429, { error: "A sync is already running; wait for it to finish." });
    if (!allow(clientIp(req))) {
      return json(res, 429, { error: `Rate limit: ${SYNCS_PER_HOUR} lookups per hour.` });
    }
    busy = true;
    try {
      evictIfNeeded();
      const result = await syncAndAnalyze(riotId.trim());
      json(res, 200, result);
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : "Sync failed" });
    } finally {
      busy = false;
    }
  });
}
loadEnv();
if (!process.env.RIOT_API_KEY) {
  console.warn("[wincon] RIOT_API_KEY is not set. Lookups will fail; cached data still serves.");
}
var server = http.createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  if (url === "/api/sync" && req.method === "POST") return handleSync(req, res);
  if (url === "/healthz") return json(res, 200, { ok: true });
  const dataFile = dataFileFor(url);
  if (dataFile) {
    if (!fs3.existsSync(dataFile)) {
      return url === "/players.json" ? json(res, 200, []) : json(res, 404, { error: "Not found" });
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    return void res.end(fs3.readFileSync(dataFile));
  }
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method not allowed" });
  if (serveStatic(url, res)) return;
  const index = path3.join(DIST, "index.html");
  if (fs3.existsSync(index)) {
    res.setHeader("Content-Type", MIME[".html"]);
    return void res.end(fs3.readFileSync(index));
  }
  json(res, 404, { error: "Not found" });
});
server.listen(PORT, () => {
  console.log(`[wincon] listening on :${PORT}`);
  console.log(`[wincon] dist=${DIST}`);
  console.log(`[wincon] data=${DATA_DIR} (max ${MAX_PLAYERS} players, keep: ${KEEP.join(", ") || "none"})`);
});

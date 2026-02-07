#!/usr/bin/env node

const DEFAULT_DATE = new Date().toISOString().slice(0, 10);
const inputDate = (process.argv[2] || DEFAULT_DATE).trim();
const compact = inputDate.replace(/-/g, "");

function normalizeStatus(statusObj) {
  const rawType = (((statusObj || {}).type || {}).state || "").toString().toLowerCase();
  const period = (((statusObj || {}).type || {}).shortDetail || "").toString();
  const clock = ((statusObj || {}).displayClock || "").toString();

  let status = "pre";
  if (rawType === "in" || rawType === "live") status = "live";
  else if (rawType === "post" || rawType === "final") status = "final";

  return { status, period, clock };
}

function normalizeTeam(competitor) {
  const team = (competitor && competitor.team) || {};
  return {
    code3: String(team.abbreviation || team.shortDisplayName || "").trim().toUpperCase().slice(0, 3),
    name: team.displayName || team.shortDisplayName || team.name || competitor.displayName || "",
    score: competitor && competitor.score != null ? String(competitor.score) : ""
  };
}

function normalizeEspnOlympicResponse(json, leagueKey, providerName) {
  const events = Array.isArray(json && json.events) ? json.events : [];
  const fetchedAtUTC = new Date().toISOString();

  return events.map((event, idx) => {
    const comp = Array.isArray(event.competitions) ? event.competitions[0] : null;
    const competitors = comp && Array.isArray(comp.competitors) ? comp.competitors : [];
    const home = competitors.find((item) => item && item.homeAway === "home") || competitors[0] || {};
    const away = competitors.find((item) => item && item.homeAway === "away") || competitors[1] || {};
    const status = normalizeStatus(event.status || (comp && comp.status) || {});

    return {
      leagueKey,
      gameId: String(event.id || (comp && comp.id) || `${leagueKey}-${idx}`),
      startTimeUTC: event.date || event.startDate || (comp && (comp.date || comp.startDate)) || "",
      status: status.status,
      period: status.period,
      clock: status.clock,
      home: normalizeTeam(home),
      away: normalizeTeam(away),
      venue: comp && comp.venue ? (comp.venue.fullName || comp.venue.name || "") : "",
      source: { providerName, fetchedAtUTC }
    };
  });
}

async function checkEndpoint(name, url) {
  try {
    const res = await fetch(url);
    return { name, url, ok: res.ok, code: res.status, note: res.ok ? "ok" : res.statusText };
  } catch (err) {
    return { name, url, ok: false, code: 0, note: err.message || String(err) };
  }
}

async function fetchAndNormalize(leagueKey, providerName, path) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/${path}/scoreboard?dates=${compact}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${providerName} HTTP ${res.status} ${res.statusText}`);
  const json = await res.json();
  return normalizeEspnOlympicResponse(json, leagueKey, providerName);
}

(async () => {
  console.log(`Testing Olympic Hockey providers for date ${inputDate}...`);

  const connectivityChecks = [
    ["ESPN men", `https://site.api.espn.com/apis/site/v2/sports/hockey/mens-olympics/scoreboard?dates=${compact}`],
    ["ESPN women", `https://site.api.espn.com/apis/site/v2/sports/hockey/womens-olympics/scoreboard?dates=${compact}`],
    ["Olympics.com hockey", "https://olympics.com/en/sports/ice-hockey/"],
    ["IIHF", "https://www.iihf.com/"],
    ["TheSportsDB", "https://www.thesportsdb.com/api/v1/json/3/all_sports.php"],
    ["Wikipedia", "https://en.wikipedia.org/wiki/Ice_hockey_at_the_Winter_Olympics"]
  ];

  const results = await Promise.all(connectivityChecks.map(([name, url]) => checkEndpoint(name, url)));
  for (const result of results) {
    const status = result.ok ? "✅" : "❌";
    console.log(`${status} ${result.name}: ${result.code} (${result.note}) - ${result.url}`);
  }

  let men = [];
  let women = [];

  try {
    men = await fetchAndNormalize("olympic_mhockey", "espn_mens_olympics", "mens-olympics");
  } catch (err) {
    console.log(`❌ Normalize men failed: ${err.message || err}`);
  }

  try {
    women = await fetchAndNormalize("olympic_whockey", "espn_womens_olympics", "womens-olympics");
  } catch (err) {
    console.log(`❌ Normalize women failed: ${err.message || err}`);
  }

  console.log("\nNormalized men's games:");
  console.log(JSON.stringify(men, null, 2));

  console.log("\nNormalized women's games:");
  console.log(JSON.stringify(women, null, 2));
})();

#!/usr/bin/env node

/**
 * Connectivity probe for all external score APIs used by MMM-Scores.
 *
 * Usage:
 *   node scripts/test-api-connections.js
 */

const TIMEOUT_MS = 15000;

function formatDateIso(date) {
  return date.toISOString().slice(0, 10);
}

function formatDateCompact(date) {
  return formatDateIso(date).replace(/-/g, "");
}

function withTimeout(promise, timeoutMs, label) {
  const timeoutPromise = new Promise((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

async function probeJson({ name, url, headers }) {
  const started = Date.now();

  let res;
  try {
    res = await withTimeout(fetch(url, { headers }), TIMEOUT_MS, name);
  } catch (err) {
    const reason = err?.cause?.message || err.message;
    throw new Error(`Network error (${reason})`);
  }
  const elapsedMs = Date.now() - started;

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} (${elapsedMs}ms)`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`Unexpected content type: ${contentType || "<missing>"}`);
  }

  await res.json();
  return { elapsedMs, status: res.status };
}

async function main() {
  const today = new Date();
  const dateIso = formatDateIso(today);
  const dateCompact = formatDateCompact(today);

  const nhlStatsHeaders = {
    Accept: "application/json, text/plain, */*",
    Referer: "https://www.nhl.com/",
    Origin: "https://www.nhl.com",
    "User-Agent": "MMM-Scores-API-Connectivity-Test/1.0"
  };

  const checks = [
    {
      name: "MLB statsapi schedule",
      url: `https://statsapi.mlb.com/api/v1/schedule/games?sportId=1&date=${dateIso}&hydrate=linescore`
    },
    {
      name: "NHL legacy statsapi schedule",
      url: `https://statsapi.web.nhl.com/api/v1/schedule?date=${dateIso}&expand=schedule.linescore,schedule.teams`,
      headers: nhlStatsHeaders
    },
    {
      name: "NHL web scoreboard (dated)",
      url: `https://api-web.nhle.com/v1/scoreboard/${dateIso}?site=en_nhl`,
      headers: nhlStatsHeaders
    },
    {
      name: "NHL web scoreboard (now)",
      url: "https://api-web.nhle.com/v1/scoreboard/now?site=en_nhl",
      headers: nhlStatsHeaders
    },
    {
      name: "NHL stats REST schedule",
      url: `https://api.nhle.com/stats/rest/en/schedule?cayenneExp=gameDate=%22${dateIso}%22`,
      headers: {
        ...nhlStatsHeaders,
        "x-nhl-stats-origin": "https://www.nhl.com",
        "x-nhl-stats-referer": "https://www.nhl.com"
      }
    },
    {
      name: "NBA ESPN scoreboard",
      url: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateCompact}`
    },
    {
      name: "NFL ESPN scoreboard (date)",
      url: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dateCompact}`
    },
    {
      name: "NFL ESPN scoreboard (default)",
      url: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
    },
    {
      name: "Olympic men's hockey ESPN scoreboard",
      url: `https://site.api.espn.com/apis/site/v2/sports/hockey/mens-olympics/scoreboard?dates=${dateCompact}`
    },
    {
      name: "Olympic women's hockey ESPN scoreboard",
      url: `https://site.api.espn.com/apis/site/v2/sports/hockey/womens-olympics/scoreboard?dates=${dateCompact}`
    }
  ];

  console.log(`Running ${checks.length} API connectivity checks for ${dateIso}...\n`);

  const failures = [];

  for (const check of checks) {
    try {
      const result = await probeJson(check);
      console.log(`✅ ${check.name}: HTTP ${result.status} in ${result.elapsedMs}ms`);
    } catch (err) {
      console.error(`❌ ${check.name}: ${err.message}`);
      failures.push({ name: check.name, reason: err.message });
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Passed: ${checks.length - failures.length}/${checks.length}`);

  if (failures.length > 0) {
    console.log("Failed checks:");
    for (const failure of failures) {
      console.log(`- ${failure.name}: ${failure.reason}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("All API connectivity checks passed.");
}

main().catch((err) => {
  console.error("❌ Unexpected script failure:", err);
  process.exit(1);
});

/* playoff-data-mlb.js
 *
 * Node-only data module for the MLB Playoffs screen. Fetches the MLB Stats
 * API (no key needed) and returns the normalized JSON shape described in the
 * playoff screens spec, section 3.1:
 *
 *   { season, series: [...], seeds: { AL: {...}, NL: {...} }, names: {...} }
 *
 * The caller injects a `fetchJson(url, options, label)` function (node_helper
 * already has one with timeout handling) so this module has no direct
 * dependency on node_helper and stays easy to unit test with a stub.
 */
"use strict";

// Maps the MLB Stats API's own team abbreviation to this project's logo file
// codes (images/mlb/{CODE}.png). Only entries that differ from the API's
// abbreviation need to be listed; everything else passes through uppercased.
var MLB_ABBR_TO_LOGO_CODE = {
  CHC: "CUBS",
  CWS: "SOX",
  WSH: "WAS",
  OAK: "ATH" // legacy Athletics abbreviation, in case a cached response uses it
};

// The 30 real MLB team logo codes. Anything else (TBD placeholders, "AL Wild
// Card Series A Winner", partial names, etc.) is skipped per spec §4.1 step 3.
var VALID_MLB_TEAM_CODES = {
  ARI: true, ATL: true, BAL: true, BOS: true, CUBS: true, CIN: true, CLE: true,
  COL: true, SOX: true, DET: true, HOU: true, KC: true, LAA: true, LAD: true,
  MIA: true, MIL: true, MIN: true, NYM: true, NYY: true, ATH: true, PHI: true,
  PIT: true, SD: true, SEA: true, SF: true, STL: true, TB: true, TEX: true,
  TOR: true, WAS: true
};

var AL_TEAM_CODES = {
  BAL: true, BOS: true, NYY: true, TB: true, TOR: true,
  SOX: true, CLE: true, DET: true, KC: true, MIN: true,
  HOU: true, LAA: true, ATH: true, SEA: true, TEX: true
};

var ROUND_KEYWORDS = [
  { re: /wild\s*card/i, round: "F" },
  { re: /division/i, round: "D" },
  { re: /championship/i, round: "L" },
  { re: /world\s*series/i, round: "W" }
];

var GAME_TYPE_TO_ROUND = { F: "F", D: "D", L: "L", W: "W" };

var ROUND_BEST_OF_DEFAULT = { F: 3, D: 5, L: 7, W: 7 };

// The two-word exceptions mentioned in spec §4.1 step 4 ("Team names come
// from teamName or clubName, else the last word of name. Exceptions are the
// 'Red Sox' and 'White Sox', which keep two words.")
var TWO_WORD_TEAM_NAME_SUFFIXES = ["Red Sox", "White Sox"];

function resolveSeason(now) {
  now = now || new Date();
  var year = now.getFullYear();
  var month = now.getMonth() + 1;
  return month >= 3 ? year : year - 1;
}

function toLogoCode(rawAbbr) {
  if (!rawAbbr) return null;
  var upper = String(rawAbbr).trim().toUpperCase();
  var mapped = MLB_ABBR_TO_LOGO_CODE[upper] || upper;
  return VALID_MLB_TEAM_CODES[mapped] ? mapped : null;
}

function teamDisplayName(team) {
  if (!team) return null;
  var full = team.name || "";
  for (var i = 0; i < TWO_WORD_TEAM_NAME_SUFFIXES.length; i++) {
    if (full.indexOf(TWO_WORD_TEAM_NAME_SUFFIXES[i]) !== -1) return TWO_WORD_TEAM_NAME_SUFFIXES[i];
  }
  return team.teamName || team.clubName || (full ? full.split(" ").slice(-1)[0] : null);
}

function roundFromGame(game) {
  if (game.gameType && GAME_TYPE_TO_ROUND[game.gameType]) return GAME_TYPE_TO_ROUND[game.gameType];
  var desc = game.seriesDescription || "";
  for (var i = 0; i < ROUND_KEYWORDS.length; i++) {
    if (ROUND_KEYWORDS[i].re.test(desc)) return ROUND_KEYWORDS[i].round;
  }
  return null;
}

// Walks the payload recursively and collects every object that looks like a
// game: it has `gamePk` and a `teams` object with `home`/`away` sides. This
// works against both candidate MLB schedule endpoints without needing to
// know each one's exact nesting (spec §4.1, "series_from_games" step 1).
function collectGames(payload) {
  var byPk = new Map();

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) walk(node[i]);
      return;
    }
    if (node.gamePk != null && node.teams && typeof node.teams === "object") {
      var pk = Number(node.gamePk);
      if (Number.isFinite(pk) && !byPk.has(pk)) byPk.set(pk, node);
    }
    Object.keys(node).forEach(function (key) { walk(node[key]); });
  }

  walk(payload);
  return Array.from(byPk.values());
}

function gameState(game) {
  var status = game.status || {};
  var detailed = String(status.detailedState || "").toLowerCase();
  if (detailed.indexOf("postponed") !== -1 || detailed.indexOf("cancelled") !== -1) return "ignored";

  var abstract = status.abstractState || status.abstractGameState || "";
  if (abstract === "Final") return "final";
  if (abstract === "Live" && ["Warmup", "Pre-Game", "Delayed Start"].indexOf(status.detailedState) === -1) return "live";
  if (game.gameDate) return "scheduled";
  return "ignored";
}

function seriesFromGames(payload) {
  var games = collectGames(payload);
  var groups = new Map(); // key => { round, league, teams:Set, games:[] }

  games.forEach(function (game) {
    var round = roundFromGame(game);
    if (!round) return;

    var homeTeam = game.teams.home && game.teams.home.team;
    var awayTeam = game.teams.away && game.teams.away.team;
    var homeCode = toLogoCode(homeTeam && (homeTeam.abbreviation || homeTeam.fileCode || homeTeam.teamCode));
    var awayCode = toLogoCode(awayTeam && (awayTeam.abbreviation || awayTeam.fileCode || awayTeam.teamCode));
    if (!homeCode || !awayCode || homeCode === awayCode) return;

    var pairKey = [homeCode, awayCode].sort().join("-");
    var key = round + ":" + pairKey;
    if (!groups.has(key)) {
      groups.set(key, { round: round, teams: [homeCode, awayCode], games: [] });
    }
    groups.get(key).games.push({
      raw: game,
      homeCode: homeCode,
      awayCode: awayCode,
      homeTeam: homeTeam,
      awayTeam: awayTeam,
      gameNumber: Number(game.seriesGameNumber) || null,
      gameDate: game.gameDate || null,
      gamesInSeries: Number(game.gamesInSeries) || null,
      state: gameState(game)
    });
  });

  var series = [];
  groups.forEach(function (group) {
    var games = group.games.filter(function (g) { return g.state !== "ignored"; });
    if (games.length === 0) return;

    games.sort(function (a, b) {
      var an = a.gameNumber || 999, bn = b.gameNumber || 999;
      if (an !== bn) return an - bn;
      return Date.parse(a.gameDate || "") - Date.parse(b.gameDate || "");
    });

    var firstGame = games[0];
    var topTeam = firstGame.homeCode;
    var bottomTeam = firstGame.awayCode;

    var league = null;
    if (group.round !== "W") {
      var leagueId = firstGame.homeTeam && firstGame.homeTeam.league && firstGame.homeTeam.league.id;
      if (leagueId === 103) league = "AL";
      else if (leagueId === 104) league = "NL";
      else league = AL_TEAM_CODES[topTeam] ? "AL" : "NL";
    }

    var bestOf = ROUND_BEST_OF_DEFAULT[group.round];
    games.forEach(function (g) { if (g.gamesInSeries) bestOf = Math.max(bestOf, g.gamesInSeries); });

    var wins = {};
    wins[topTeam] = 0;
    wins[bottomTeam] = 0;
    var live = false;
    var nextStart = null, nextTimeTbd = false, nextGame = null;

    games.forEach(function (g) {
      if (g.state === "final") {
        var homeIsWinner = g.raw.teams.home && g.raw.teams.home.isWinner;
        var awayIsWinner = g.raw.teams.away && g.raw.teams.away.isWinner;
        var winnerCode = null;
        if (homeIsWinner === true) winnerCode = g.homeCode;
        else if (awayIsWinner === true) winnerCode = g.awayCode;
        else {
          var homeScore = g.raw.teams.home && g.raw.teams.home.score;
          var awayScore = g.raw.teams.away && g.raw.teams.away.score;
          if (typeof homeScore === "number" && typeof awayScore === "number") {
            winnerCode = homeScore > awayScore ? g.homeCode : g.awayCode;
          }
        }
        if (winnerCode) wins[winnerCode] = (wins[winnerCode] || 0) + 1;
      } else if (g.state === "live") {
        live = true;
      } else if (g.state === "scheduled") {
        var start = Date.parse(g.gameDate || "");
        if (!nextStart || start < Date.parse(nextStart)) {
          nextStart = g.gameDate;
          nextTimeTbd = !!(g.raw.status && g.raw.status.startTimeTBD);
          nextGame = g.gameNumber;
        }
      }
    });

    var neededWins = Math.floor(bestOf / 2) + 1;
    var winner = null;
    if (wins[topTeam] >= neededWins) winner = topTeam;
    else if (wins[bottomTeam] >= neededWins) winner = bottomTeam;

    if (winner) {
      live = false;
      nextStart = null;
      nextTimeTbd = false;
      nextGame = null;
    }

    series.push({
      round: group.round,
      league: league || "",
      best_of: bestOf,
      teams: [topTeam, bottomTeam],
      names: buildNamesMap([firstGame.homeTeam, firstGame.awayTeam], [topTeam, bottomTeam]),
      wins: wins,
      live: live,
      next_start: nextStart,
      next_time_tbd: nextTimeTbd,
      next_game: nextGame,
      winner: winner
    });
  });

  return series;
}

function buildNamesMap(teams, codes) {
  var out = {};
  teams.forEach(function (team, i) {
    var code = codes[i];
    var name = teamDisplayName(team);
    if (code && name) out[code] = name;
  });
  return out;
}

function seedsFromStandings(payload) {
  var records = [];
  var records103 = [], records104 = [];

  var groups = (payload && payload.records) || [];
  groups.forEach(function (group) {
    var leagueId = group.league && group.league.id;
    var teamRecords = Array.isArray(group.teamRecords) ? group.teamRecords : [];
    teamRecords.forEach(function (rec) {
      var code = toLogoCode(rec.team && (rec.team.abbreviation || rec.team.fileCode || rec.team.teamCode));
      if (!code) return;
      var entry = {
        code: code,
        divisionRank: parseInt(rec.divisionRank, 10),
        leagueRank: parseInt(rec.leagueRank, 10),
        wildCardRank: rec.wildCardRank != null ? parseInt(rec.wildCardRank, 10) : null,
        winPct: parseFloat(rec.winningPercentage) || 0
      };
      if (leagueId === 103) records103.push(entry);
      else if (leagueId === 104) records104.push(entry);
    });
  });

  function seedsForLeague(records) {
    var divisionLeaders = records.filter(function (r) { return r.divisionRank === 1; });
    if (divisionLeaders.length < 3) return {};

    divisionLeaders.sort(function (a, b) {
      if (a.leagueRank !== b.leagueRank) return a.leagueRank - b.leagueRank;
      return b.winPct - a.winPct;
    });

    var seeds = {};
    divisionLeaders.slice(0, 3).forEach(function (r, i) { seeds[r.code] = i + 1; });

    var wildCards = records.filter(function (r) {
      return r.divisionRank !== 1 && r.wildCardRank != null && !isNaN(r.wildCardRank);
    });
    wildCards.sort(function (a, b) {
      if (a.wildCardRank !== b.wildCardRank) return a.wildCardRank - b.wildCardRank;
      return b.winPct - a.winPct;
    });

    var nextTeams = wildCards;
    if (nextTeams.length < 3) {
      var byLeagueRank = records
        .filter(function (r) { return r.divisionRank !== 1; })
        .sort(function (a, b) { return a.leagueRank - b.leagueRank; });
      nextTeams = byLeagueRank;
    }
    nextTeams.slice(0, 3).forEach(function (r, i) { seeds[r.code] = i + 4; });

    return seeds;
  }

  return { AL: seedsForLeague(records103), NL: seedsForLeague(records104) };
}

function mergeNames(seriesList) {
  var names = {};
  seriesList.forEach(function (s) {
    Object.keys(s.names || {}).forEach(function (code) { names[code] = s.names[code]; });
  });
  return names;
}

/**
 * @param {Object} deps
 * @param {(url:string, options?:Object, label?:string) => Promise<Object>} deps.fetchJson
 * @param {Date} [deps.now]
 * @returns {Promise<Object>} normalized MLB postseason feed (spec §3.1)
 */
async function fetchMlbPostseason(deps) {
  var fetchJson = deps.fetchJson;
  var season = resolveSeason(deps.now);

  var series = [];
  var seriesSourceErrors = [];

  try {
    var scheduleUrl = "https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=" + season
      + "&gameTypes=F,D,L,W&hydrate=team";
    var schedulePayload = await fetchJson(scheduleUrl, {}, "MLB postseason schedule");
    series = seriesFromGames(schedulePayload);
  } catch (e) {
    seriesSourceErrors.push(e);
  }

  if (series.length === 0) {
    try {
      var seriesUrl = "https://statsapi.mlb.com/api/v1/schedule/postseason/series?sportId=1&season=" + season
        + "&hydrate=team";
      var seriesPayload = await fetchJson(seriesUrl, {}, "MLB postseason series");
      series = seriesFromGames(seriesPayload);
    } catch (e2) {
      seriesSourceErrors.push(e2);
    }
  }

  var seeds = { AL: {}, NL: {} };
  var seedsError = null;
  try {
    var standingsUrl = "https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=" + season
      + "&standingsType=regularSeason&hydrate=team";
    var standingsPayload = await fetchJson(standingsUrl, {}, "MLB postseason standings");
    seeds = seedsFromStandings(standingsPayload);
  } catch (e3) {
    seedsError = e3;
  }

  var hasSeeds = Object.keys(seeds.AL).length > 0 || Object.keys(seeds.NL).length > 0;
  if (series.length === 0 && !hasSeeds) {
    var cause = seedsError || seriesSourceErrors[seriesSourceErrors.length - 1];
    throw new Error("MLB postseason fetch failed: " + (cause && cause.message ? cause.message : "no data"));
  }

  return {
    season: season,
    series: series,
    seeds: seeds,
    names: mergeNames(series)
  };
}

module.exports = {
  fetchMlbPostseason: fetchMlbPostseason,
  // exported for tests
  resolveSeason: resolveSeason,
  toLogoCode: toLogoCode,
  seriesFromGames: seriesFromGames,
  seedsFromStandings: seedsFromStandings
};

/* playoff-data-nhl.js
 *
 * Node-only data module for the NHL Playoffs screen. Fetches
 * api-web.nhle.com (no key needed) and returns the normalized JSON shape
 * described in the playoff screens spec, section 3.2:
 *
 *   { season, series: [...], names: {...}, seeds: {...} }
 *
 * The caller injects a `fetchJson(url, options, label)` function.
 */
"use strict";

// seriesLetter -> { round, conference, position } (spec §4.2)
var LETTER_MAP = {
  A: { round: 1, conference: "east", position: 0 },
  B: { round: 1, conference: "east", position: 1 },
  C: { round: 1, conference: "east", position: 2 },
  D: { round: 1, conference: "east", position: 3 },
  E: { round: 1, conference: "west", position: 0 },
  F: { round: 1, conference: "west", position: 1 },
  G: { round: 1, conference: "west", position: 2 },
  H: { round: 1, conference: "west", position: 3 },
  I: { round: 2, conference: "east", position: 0 },
  J: { round: 2, conference: "east", position: 1 },
  K: { round: 2, conference: "west", position: 0 },
  L: { round: 2, conference: "west", position: 1 },
  M: { round: 3, conference: "east", position: 0 },
  N: { round: 3, conference: "west", position: 0 },
  O: { round: 4, conference: "", position: 0 }
};

// Round-1 division letter assignment used by the standings-based projection
// fallback (spec §4.2 step 1 of the fallbacks).
var DIVISION_LETTERS = {
  east: { Atlantic: ["A", "B"], Metropolitan: ["C", "D"] },
  west: { Central: ["E", "F"], Pacific: ["G", "H"] }
};

function resolveSeasonEndYear(now) {
  now = now || new Date();
  var year = now.getFullYear();
  var month = now.getMonth() + 1;
  return month >= 9 ? year + 1 : year;
}

function seriesFromBracket(payload) {
  var items = (payload && Array.isArray(payload.series)) ? payload.series : [];
  var series = [];

  items.forEach(function (item) {
    var meta = LETTER_MAP[item.seriesLetter];
    if (!meta) return;

    var top = item.topSeedTeam, bottom = item.bottomSeedTeam;
    if (!top || !bottom || !top.abbrev || !bottom.abbrev) return;

    var wins = {};
    wins[top.abbrev] = Number(item.topSeedWins) || 0;
    wins[bottom.abbrev] = Number(item.bottomSeedWins) || 0;

    var winner = null;
    if (item.winningTeamId != null) {
      if (top.id === item.winningTeamId) winner = top.abbrev;
      else if (bottom.id === item.winningTeamId) winner = bottom.abbrev;
    }
    if (!winner) {
      if (wins[top.abbrev] >= 4) winner = top.abbrev;
      else if (wins[bottom.abbrev] >= 4) winner = bottom.abbrev;
    }

    var names = {};
    if (top.commonName && top.commonName.default) names[top.abbrev] = top.commonName.default;
    if (bottom.commonName && bottom.commonName.default) names[bottom.abbrev] = bottom.commonName.default;

    var seeds = {};
    if (meta.round === 1) {
      if (item.topSeedRankAbbrev) seeds[top.abbrev] = item.topSeedRankAbbrev;
      if (item.bottomSeedRankAbbrev) seeds[bottom.abbrev] = item.bottomSeedRankAbbrev;
    }

    series.push({
      round: meta.round,
      conference: meta.conference,
      position: meta.position,
      letter: item.seriesLetter,
      teams: [top.abbrev, bottom.abbrev],
      wins: wins,
      winner: winner,
      live: false,
      next_start: null,
      next_time_tbd: false,
      next_game: null,
      _names: names,
      _seeds: seeds
    });
  });

  return series;
}

async function attachLiveAndNextGame(series, fetchJson) {
  if (series.length === 0) return series;

  var payload;
  try {
    payload = await fetchJson("https://api-web.nhle.com/v1/schedule/now", {}, "NHL schedule/now");
  } catch (e) {
    return series; // best-effort; series still render without live/next-game info
  }

  var games = [];
  var weeks = (payload && Array.isArray(payload.gameWeek)) ? payload.gameWeek : [];
  weeks.forEach(function (week) {
    (week.games || []).forEach(function (game) {
      if (game.gameType === 3) games.push(game);
    });
  });

  series.forEach(function (s) {
    if (s.winner) return; // decided series are skipped (spec)
    var matching = games.filter(function (g) {
      var away = g.awayTeam && g.awayTeam.abbrev;
      var home = g.homeTeam && g.homeTeam.abbrev;
      return (away === s.teams[0] && home === s.teams[1]) || (away === s.teams[1] && home === s.teams[0]);
    });
    if (matching.length === 0) return;

    s.live = matching.some(function (g) { return g.gameState === "LIVE" || g.gameState === "CRIT"; });

    var upcoming = matching
      .filter(function (g) { return (g.gameState === "FUT" || g.gameState === "PRE") && g.startTimeUTC; })
      .sort(function (a, b) { return Date.parse(a.startTimeUTC) - Date.parse(b.startTimeUTC); });

    if (upcoming.length > 0) {
      var next = upcoming[0];
      s.next_start = next.startTimeUTC;
      s.next_time_tbd = next.gameScheduleState === "TBD";
      var totalWins = (s.wins[s.teams[0]] || 0) + (s.wins[s.teams[1]] || 0);
      s.next_game = (next.seriesStatus && next.seriesStatus.gameNumberOfSeries) || (totalWins + 1);
    }
  });

  return series;
}

function rankValue(team) {
  return [
    team.points || 0,
    -(team.gamesPlayed || 0),
    team.regulationWins || 0,
    team.regulationPlusOtWins || 0,
    team.wins || 0,
    team.goalDifferential || 0
  ];
}

function compareTeamsDescending(a, b) {
  var ra = rankValue(a), rb = rankValue(b);
  for (var i = 0; i < ra.length; i++) {
    if (ra[i] !== rb[i]) return rb[i] - ra[i];
  }
  return 0;
}

function projectFirstRoundFromStandings(payload) {
  var standings = (payload && Array.isArray(payload.standings)) ? payload.standings : [];
  if (standings.length === 0 || !standings.some(function (t) { return (t.gamesPlayed || 0) > 0; })) return [];

  var byConfDiv = {};
  standings.forEach(function (team) {
    var conf = team.conferenceAbbrev === "E" ? "east" : team.conferenceAbbrev === "W" ? "west" : null;
    var div = team.divisionAbbrev;
    if (!conf || !div) return;
    byConfDiv[conf] = byConfDiv[conf] || {};
    byConfDiv[conf][div] = byConfDiv[conf][div] || [];
    byConfDiv[conf][div].push(team);
  });

  var divisionNameByAbbrev = { A: "Atlantic", M: "Metropolitan", C: "Central", P: "Pacific" };
  return finalizeProjectedSeries(byConfDiv, divisionNameByAbbrev);
}

// The projection above collects raw division/wild-card groupings; this
// second pass builds the actual eight round-1 series per spec §4.2 fallback
// step 1, now that both divisions of each conference are known so the
// "division winner with more points plays WC2" rule can be applied.
function finalizeProjectedSeries(byConfDiv, divisionNameByAbbrev) {
  var series = [];

  ["east", "west"].forEach(function (conf) {
    var divisions = byConfDiv[conf] || {};
    var divAbbrevs = Object.keys(divisions);
    if (divAbbrevs.length < 2) return;

    var ranked = {};
    var wildCardPool = [];
    divAbbrevs.forEach(function (divAbbr) {
      var sorted = divisions[divAbbr].slice().sort(compareTeamsDescending);
      ranked[divAbbr] = sorted;
      wildCardPool = wildCardPool.concat(sorted.slice(3));
    });
    if (divAbbrevs.some(function (d) { return ranked[d].length < 3; })) return;

    wildCardPool.sort(compareTeamsDescending);
    var wc1 = wildCardPool[0], wc2 = wildCardPool[1];
    if (!wc1 || !wc2) return;

    var divisionWinners = divAbbrevs.map(function (divAbbr) { return { divAbbr: divAbbr, team: ranked[divAbbr][0] }; });
    divisionWinners.sort(function (a, b) { return compareTeamsDescending(a.team, b.team); });
    var higherDivAbbr = divisionWinners[0].divAbbr;
    var lowerDivAbbr = divisionWinners[1].divAbbr;

    [higherDivAbbr, lowerDivAbbr].forEach(function (divAbbr, i) {
      var letters = (DIVISION_LETTERS[conf] || {})[divisionNameByAbbrev[divAbbr]];
      if (!letters) return;
      var top3 = ranked[divAbbr];
      var d1 = top3[0], d2 = top3[1], d3 = top3[2];
      var d1Opponent = i === 0 ? wc2 : wc1; // higher-points division winner plays WC2
      var d1OpponentSeed = i === 0 ? "WC2" : "WC1";

      series.push({
        round: 1, conference: conf, position: LETTER_MAP[letters[0]].position, letter: letters[0],
        teams: [d1.teamAbbrev.default, d1Opponent.teamAbbrev.default], wins: {}, winner: null, live: false,
        next_start: null, next_time_tbd: false, next_game: null, projected: true,
        _names: seedName(d1, d1Opponent),
        _seeds: seedMap(d1, "D1", d1Opponent, d1OpponentSeed)
      });
      series.push({
        round: 1, conference: conf, position: LETTER_MAP[letters[1]].position, letter: letters[1],
        teams: [d2.teamAbbrev.default, d3.teamAbbrev.default], wins: {}, winner: null, live: false,
        next_start: null, next_time_tbd: false, next_game: null, projected: true,
        _names: seedName(d2, d3),
        _seeds: seedMap(d2, "D2", d3, "D3")
      });
    });
  });

  return series;
}

function seedName(a, b) {
  var n = {};
  n[a.teamAbbrev.default] = a.teamCommonName ? a.teamCommonName.default : a.teamAbbrev.default;
  n[b.teamAbbrev.default] = b.teamCommonName ? b.teamCommonName.default : b.teamAbbrev.default;
  return n;
}

function seedMap(a, seedA, b, seedB) {
  var s = {};
  s[a.teamAbbrev.default] = seedA;
  s[b.teamAbbrev.default] = seedB;
  return s;
}

function mergeExtras(seriesList) {
  var names = {}, seeds = {};
  seriesList.forEach(function (s) {
    Object.keys(s._names || {}).forEach(function (k) { names[k] = s._names[k]; });
    Object.keys(s._seeds || {}).forEach(function (k) { seeds[k] = s._seeds[k]; });
  });
  return { names: names, seeds: seeds };
}

function stripInternalFields(seriesList) {
  return seriesList.map(function (s) {
    var copy = Object.assign({}, s);
    delete copy._names;
    delete copy._seeds;
    return copy;
  });
}

/**
 * @param {Object} deps
 * @param {(url:string, options?:Object, label?:string) => Promise<Object>} deps.fetchJson
 * @param {Date} [deps.now]
 */
async function fetchNhlPlayoffs(deps) {
  var fetchJson = deps.fetchJson;
  var endYear = resolveSeasonEndYear(deps.now);

  var series = [];
  try {
    var bracketPayload = await fetchJson(
      "https://api-web.nhle.com/v1/playoff-bracket/" + endYear, {}, "NHL playoff bracket"
    );
    series = seriesFromBracket(bracketPayload);
    if (series.length > 0) await attachLiveAndNextGame(series, fetchJson);
  } catch (e) {
    series = [];
  }

  if (series.length === 0) {
    var now = deps.now || new Date();
    var month = now.getMonth() + 1;
    if (month >= 10 || month <= 6) {
      try {
        var standingsPayload = await fetchJson(
          "https://api-web.nhle.com/v1/standings/now", {}, "NHL standings"
        );
        series = projectFirstRoundFromStandings(standingsPayload);
      } catch (e2) {
        series = [];
      }
    }

    if (series.length === 0) {
      try {
        var lastYearPayload = await fetchJson(
          "https://api-web.nhle.com/v1/playoff-bracket/" + (endYear - 1), {}, "NHL playoff bracket (last season)"
        );
        series = seriesFromBracket(lastYearPayload);
      } catch (e3) {
        series = [];
      }
    }
  }

  if (series.length === 0) {
    throw new Error("NHL postseason fetch failed: no bracket, projection, or fallback data");
  }

  var extras = mergeExtras(series);
  return {
    season: endYear,
    series: stripInternalFields(series),
    names: extras.names,
    seeds: extras.seeds
  };
}

module.exports = {
  fetchNhlPlayoffs: fetchNhlPlayoffs,
  // exported for tests
  resolveSeasonEndYear: resolveSeasonEndYear,
  seriesFromBracket: seriesFromBracket,
  projectFirstRoundFromStandings: projectFirstRoundFromStandings,
  LETTER_MAP: LETTER_MAP
};

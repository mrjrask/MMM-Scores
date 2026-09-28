/* playoff-data-nba.js
 *
 * Node-only data module for the NBA Playoffs screen. Fetches the NBA CDN's
 * live bracket JSON (no key needed) and returns the normalized JSON shape
 * described in the playoff screens spec, section 3.2 (NBA variant):
 *
 *   { series: [...], names: {...}, seeds: {...} }
 *
 * The caller injects a `fetchJson(url, options, label)` function. Unlike the
 * MLB/NHL feeds this one needs browser-like headers, since the CDN can
 * reject bare clients (spec §4.3).
 */
"use strict";

var BRACKET_URLS = [
  "https://cdn.nba.com/static/json/liveData/playoffbracket/playoffbracket_00.json",
  "https://nba-prod-us-east-1-media.s3.amazonaws.com/json/liveData/playoffbracket/playoffbracket_00.json"
];

var BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; MMM-Scores/1.0; +https://github.com/mrjrask/MMM-Scores)",
  "Referer": "https://www.nba.com/",
  "Origin": "https://www.nba.com"
};

// NBA tricode -> this project's logo file code (images/nba/{CODE}.png).
// Only entries that differ from the NBA's own tricode need to be listed.
var NBA_TRICODE_TO_LOGO_CODE = {
  BKN: "BRK",
  GSW: "GS",
  NOP: "NO",
  NYK: "NY",
  PHO: "PHX",
  SAS: "SA",
  WAS: "WSH"
};

// Round-1 position from the higher seed (spec §4.3): 1->0, 4->1, 3->2, 2->3.
var ROUND1_POSITION_BY_HIGH_SEED = { 1: 0, 4: 1, 3: 2, 2: 3 };

function toLogoCode(tricode) {
  if (!tricode) return null;
  var upper = String(tricode).trim().toUpperCase();
  return NBA_TRICODE_TO_LOGO_CODE[upper] || upper;
}

function extractSeriesList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.playoffBracketSeries)) return payload.playoffBracketSeries;
  if (payload.bracket && Array.isArray(payload.bracket.playoffBracketSeries)) return payload.bracket.playoffBracketSeries;
  if (Array.isArray(payload.series)) return payload.series;
  return [];
}

function seriesFromBracket(payload) {
  var items = extractSeriesList(payload);
  var series = [];

  items.forEach(function (item) {
    var roundNumber = Number(item.roundNumber);
    if (!(roundNumber >= 1 && roundNumber <= 4)) return;

    var highCode = toLogoCode(item.highSeedTricode);
    var lowCode = toLogoCode(item.lowSeedTricode);
    if (!highCode || !lowCode) return;

    var wins = {};
    wins[highCode] = Number(item.highSeedSeriesWins) || 0;
    wins[lowCode] = Number(item.lowSeedSeriesWins) || 0;

    var winner = null;
    if (item.seriesWinner != null) {
      if (item.seriesWinner === item.highSeedId) winner = highCode;
      else if (item.seriesWinner === item.lowSeedId) winner = lowCode;
    }
    if (!winner) {
      if (wins[highCode] >= 4) winner = highCode;
      else if (wins[lowCode] >= 4) winner = lowCode;
    }

    var conference = roundNumber === 4
      ? ""
      : (item.seriesConference === "West" ? "west" : item.seriesConference === "East" ? "east" : "");

    var position = null;
    if (roundNumber === 1) {
      var highSeedRank = Number(item.highSeedRank);
      position = ROUND1_POSITION_BY_HIGH_SEED[highSeedRank];
      if (position == null) position = null;
    } else if (roundNumber === 4) {
      position = 0;
    }

    var names = {};
    if (item.highSeedName) names[highCode] = item.highSeedName;
    if (item.lowSeedName) names[lowCode] = item.lowSeedName;

    var seeds = {};
    if (roundNumber === 1) {
      if (item.highSeedRank != null) seeds[highCode] = Number(item.highSeedRank);
      if (item.lowSeedRank != null) seeds[lowCode] = Number(item.lowSeedRank);
    }

    var nextGameStatus = Number(item.nextGameStatus);
    var live = nextGameStatus === 2;
    var nextStart = null, nextGame = null;
    if (nextGameStatus === 1) {
      nextStart = item.nextGameDateTimeUTC || null;
      nextGame = item.nextGameNumber != null ? Number(item.nextGameNumber) : null;
    }

    series.push({
      round: roundNumber,
      conference: conference,
      position: position,
      teams: [highCode, lowCode],
      wins: wins,
      winner: winner,
      live: live,
      next_start: nextStart,
      next_time_tbd: false,
      next_game: nextGame,
      _names: names,
      _seeds: seeds
    });
  });

  return series;
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
 */
async function fetchNbaPlayoffs(deps) {
  var fetchJson = deps.fetchJson;
  var payload = null;
  var lastError = null;

  for (var i = 0; i < BRACKET_URLS.length; i++) {
    try {
      payload = await fetchJson(BRACKET_URLS[i], { headers: BROWSER_HEADERS }, "NBA playoff bracket");
      if (payload) break;
    } catch (e) {
      lastError = e;
    }
  }

  if (!payload) {
    throw new Error("NBA postseason fetch failed: " + (lastError && lastError.message ? lastError.message : "no data"));
  }

  var series = seriesFromBracket(payload);
  if (series.length === 0) {
    throw new Error("NBA postseason fetch failed: bracket payload had no usable series");
  }

  var extras = mergeExtras(series);
  return {
    series: stripInternalFields(series),
    names: extras.names,
    seeds: extras.seeds
  };
}

module.exports = {
  fetchNbaPlayoffs: fetchNbaPlayoffs,
  // exported for tests
  toLogoCode: toLogoCode,
  seriesFromBracket: seriesFromBracket
};

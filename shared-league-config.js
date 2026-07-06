(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MmmScoresLeagueConfig = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SUPPORTED_LEAGUES = ["mlb", "wbc", "nhl", "nfl", "nba", "worldcup", "olympic_mhockey", "olympic_whockey"];

  function normalizeLeagueKey(value) {
    if (value == null) return null;
    var str = String(value).trim().toLowerCase();
    return SUPPORTED_LEAGUES.indexOf(str) !== -1 ? str : null;
  }

  function coerceLeagueArray(input) {
    var tokens = [];
    function collect(entry) {
      if (entry == null) return;
      if (Array.isArray(entry)) {
        for (var i = 0; i < entry.length; i += 1) collect(entry[i]);
        return;
      }
      var str = String(entry).trim();
      if (!str) return;
      var parts = str.split(/[\s,]+/);
      for (var j = 0; j < parts.length; j += 1) {
        var part = parts[j].trim();
        if (part) tokens.push(part);
      }
    }
    collect(input);

    var normalized = [];
    var seen = {};
    for (var k = 0; k < tokens.length; k += 1) {
      var lower = String(tokens[k]).toLowerCase();
      if (lower === "all") return SUPPORTED_LEAGUES.slice();
      if (SUPPORTED_LEAGUES.indexOf(lower) !== -1 && !seen[lower]) {
        normalized.push(lower);
        seen[lower] = true;
      }
    }
    return normalized;
  }

  function expandMlbLeagueFamily(leagues) {
    return Array.isArray(leagues) ? leagues.slice() : [];
  }

  function dateInRange(dateIso, fromIso, untilIso) {
    if (!dateIso) return false;
    if (fromIso && dateIso < fromIso) return false;
    if (untilIso && dateIso > untilIso) return false;
    return !!(fromIso || untilIso);
  }

  function boolOrDefault(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  function isNhlBreakWindow(dateIso, config) {
    var cfg = config || {};
    if (cfg.seasonalFiltering === false) return false;
    if (cfg.hideNhlDuringOlympics === false) return false;
    var from = cfg.hideNhlFrom || "2026-02-06";
    var until = cfg.hideNhlUntil || "2026-02-24";
    return dateInRange(dateIso, from, until);
  }

  function hideOlympicScoreboards(dateIso, config) {
    var cfg = config || {};
    if (cfg.seasonalFiltering === false) return false;
    if (cfg.hideOlympicsAfterEnd === false) return false;
    var from = cfg.hideOlympicsFrom || "2026-02-24";
    return dateInRange(dateIso, from, cfg.hideOlympicsUntil || null);
  }

  function filterSeasonalLeagues(leagues, config, dateIso) {
    if (!Array.isArray(leagues)) return [];
    var cfg = config || {};
    var todayIso = dateIso || cfg.todayIso || new Date().toLocaleDateString("en-CA", { timeZone: cfg.timeZone || "America/Chicago" });
    var hideNhl = isNhlBreakWindow(todayIso, cfg);
    var hideOlympics = hideOlympicScoreboards(todayIso, cfg);
    return leagues.filter(function (league) {
      if (hideNhl && league === "nhl") return false;
      if (hideOlympics && (league === "olympic_mhockey" || league === "olympic_whockey")) return false;
      return true;
    });
  }

  function resolveConfiguredLeagues(config, dateIso) {
    var cfg = config || {};
    var source = (typeof cfg.leagues !== "undefined") ? cfg.leagues : cfg.league;
    return filterSeasonalLeagues(expandMlbLeagueFamily(coerceLeagueArray(source)), cfg, dateIso);
  }

  return {
    SUPPORTED_LEAGUES: SUPPORTED_LEAGUES,
    normalizeLeagueKey: normalizeLeagueKey,
    coerceLeagueArray: coerceLeagueArray,
    expandMlbLeagueFamily: expandMlbLeagueFamily,
    isNhlBreakWindow: isNhlBreakWindow,
    hideOlympicScoreboards: hideOlympicScoreboards,
    filterSeasonalLeagues: filterSeasonalLeagues,
    resolveConfiguredLeagues: resolveConfiguredLeagues
  };
}));

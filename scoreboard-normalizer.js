"use strict";

// Converts ESPN scoreboard events into the same flat game contract that the
// desk_display project uses (services/sports/nba.py `_map_espn_game`): MLB
// statsapi-style `gamePk` / `gameDate` / `status` / `teams.{away,home}` /
// `linescore`. Keeping this mapping in one place lets both projects describe a
// game the same way regardless of which upstream feed produced it.

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  var num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function nonEmptyString(value) {
  return (typeof value === "string" && value.trim()) ? value.trim() : "";
}

function espnScoreValue(score) {
  if (score && typeof score === "object") {
    if (score.displayValue !== undefined && score.displayValue !== null && score.displayValue !== "") return score.displayValue;
    var value = score.value;
    if (typeof value === "number") return Math.trunc(value);
    return (value === undefined || value === "") ? null : value;
  }
  return score;
}

function sumLinescores(linescores) {
  if (!Array.isArray(linescores)) return null;
  var total = 0;
  var found = false;
  for (var i = 0; i < linescores.length; i += 1) {
    var ls = linescores[i] || {};
    var num = toNumberOrNull(ls.value !== undefined ? ls.value : (ls.displayValue !== undefined ? ls.displayValue : ls.score));
    if (num != null) {
      total += num;
      found = true;
    }
  }
  return found ? total : null;
}

function espnStatusCode(statusType) {
  var type = statusType || {};
  var state = String(type.state || "").toLowerCase();
  if (state.indexOf("pre") === 0) return "1";
  if (state.indexOf("in") === 0) return "2";
  if (state.indexOf("post") === 0) return "3";
  if (type.completed) return "3";
  var raw = type.id !== undefined && type.id !== null && type.id !== "" ? type.id : (type.name || "");
  var asInt = parseInt(raw, 10);
  return Number.isFinite(asInt) ? String(asInt) : String(raw || "");
}

function espnStatusText(status) {
  var type = (status && status.type) || {};
  var keys = ["shortDetail", "detail", "description", "name"];
  for (var i = 0; i < keys.length; i += 1) {
    var text = nonEmptyString(type[keys[i]]);
    if (text) return text;
  }
  return "";
}

function espnAbstractState(statusCode, status) {
  var type = (status && status.type) || {};
  var state = String(type.state || "").toLowerCase();
  if (type.completed || state.indexOf("post") === 0) return "final";
  if (state.indexOf("in") === 0) return "live";
  if (state.indexOf("pre") === 0) return "preview";
  return { "3": "final", "2": "live", "1": "preview" }[statusCode] || "";
}

function mapEspnCompetitor(competitor) {
  var comp = competitor || {};
  var team = comp.team || {};
  var abbr = nonEmptyString(team.abbreviation) || nonEmptyString(comp.teamAbbreviation);
  abbr = abbr.toUpperCase();

  var location = nonEmptyString(team.location) || nonEmptyString(team.displayName);
  var nickname = nonEmptyString(team.name) || nonEmptyString(team.shortDisplayName);
  if (!nickname && nonEmptyString(team.displayName)) {
    var parts = team.displayName.trim().split(/\s+/);
    if (parts.length > 1) {
      nickname = parts[parts.length - 1];
      location = parts.slice(0, -1).join(" ");
    } else {
      nickname = parts[0];
    }
  }

  var mappedTeam = {};
  var teamId = team.id !== undefined && team.id !== null && team.id !== "" ? team.id : comp.id;
  if (teamId !== undefined && teamId !== null && teamId !== "") mappedTeam.id = teamId;
  if (abbr) {
    mappedTeam.abbreviation = abbr;
    mappedTeam.triCode = abbr;
  }
  var name = (location && nickname && location !== nickname) ? location + " " + nickname : (nickname || location);
  if (name) mappedTeam.name = name;

  var score = espnScoreValue(comp.score);
  if (score === null || score === undefined || score === "") score = sumLinescores(comp.linescores);
  var mapped = { team: mappedTeam };
  if (score !== null && score !== undefined && score !== "") mapped.score = score;
  return mapped;
}

function normalizeEspnNbaEvent(event) {
  if (!event || typeof event !== "object") return null;
  var competition = (event.competitions && event.competitions[0]) || {};
  var status = competition.status || event.status || {};
  var statusCode = espnStatusCode(status.type);
  var statusText = espnStatusText(status);
  var abstractState = espnAbstractState(statusCode, status);

  var periodNumber = parseInt(status.period, 10);
  if (!Number.isFinite(periodNumber)) periodNumber = null;
  var clock = status.displayClock !== undefined && status.displayClock !== null && status.displayClock !== ""
    ? status.displayClock
    : status.clock;
  clock = (clock === undefined || clock === null || clock === "") ? "" : String(clock).trim().toUpperCase();

  var away = null;
  var home = null;
  var competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
  for (var i = 0; i < competitors.length; i += 1) {
    var side = String((competitors[i] && competitors[i].homeAway) || "").toLowerCase();
    if (side === "home") home = mapEspnCompetitor(competitors[i]);
    else if (side === "away" || !away) away = mapEspnCompetitor(competitors[i]);
    else home = home || mapEspnCompetitor(competitors[i]);
  }

  var gameDate = competition.date || event.date || null;
  var mappedStatus = { statusCode: statusCode, detailedState: statusText };
  if (abstractState) mappedStatus.abstractGameState = abstractState;

  var game = {
    gamePk: competition.id || event.id || null,
    gameDate: gameDate,
    status: mappedStatus,
    teams: { away: away || { team: {} }, home: home || { team: {} } }
  };

  var season = event.season || {};
  if (season.type !== undefined && season.type !== null && season.type !== "") game.seasonType = season.type;
  if (season.slug) game.seasonStage = season.slug;

  var linescore = {};
  if (periodNumber != null) {
    linescore.currentPeriod = periodNumber;
    linescore.finalPeriod = periodNumber;
  }
  if (clock) linescore.currentPeriodTimeRemaining = clock;
  if (Object.keys(linescore).length > 0) game.linescore = linescore;

  return game;
}

function normalizeEspnNbaEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.map(normalizeEspnNbaEvent).filter(Boolean);
}

module.exports = {
  normalizeEspnNbaEvent: normalizeEspnNbaEvent,
  normalizeEspnNbaEvents: normalizeEspnNbaEvents
};

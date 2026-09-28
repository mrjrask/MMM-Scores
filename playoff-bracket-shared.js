/* playoff-bracket-shared.js
 *
 * Pure, DOM-free logic shared between node_helper.js (server side) and
 * MMM-Scores.js (browser side) for the MLB/NHL/NBA playoff bracket screens.
 *
 * Responsibilities:
 *  - Turn a league's normalized postseason feed (see the playoff screens spec,
 *    section 3) into a 7-column bracket of "slots".
 *  - Pick the current round to show in the series list.
 *  - Produce the status line text/color-class for a single series.
 *  - Compute the row-height-unit geometry used to position bracket slot boxes
 *    and their connector lines (kept here, rather than in MMM-Scores.js, so it
 *    stays unit-testable with plain node:test).
 *
 * Loaded as a UMD module: `require("./playoff-bracket-shared")` in Node, or
 * `window.MmmScoresPlayoffBracket` in the browser (via getScripts()).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MmmScoresPlayoffBracket = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Round metadata
  // ---------------------------------------------------------------------

  var MLB_ROUND_ORDER = ["F", "D", "L", "W"];
  var MLB_ROUND_NAMES = {
    F: "Wild Card Series",
    D: "Division Series",
    L: "League Championship Series",
    W: "World Series"
  };
  var MLB_ROUND_BEST_OF_DEFAULT = { F: 3, D: 5, L: 7, W: 7 };
  var MLB_COLUMN_LABELS = { F: "WC", D: "DS", L: "LCS", W: "WS" };

  var ROUND16_ORDER = [1, 2, 3, 4];
  var NHL_ROUND_NAMES = {
    1: "First Round",
    2: "Second Round",
    3: "Conference Final",
    4: "Stanley Cup Final"
  };
  var NBA_ROUND_NAMES = {
    1: "First Round",
    2: "Conference Semifinals",
    3: "Conference Finals",
    4: "NBA Finals"
  };
  var ROUND16_COLUMN_LABELS = {
    nhl: { 1: "R1", 2: "R2", 3: "CF", 4: "SCF" },
    nba: { 1: "R1", 2: "R2", 3: "CF", 4: "Finals" }
  };

  function roundNamesFor(sport) {
    return sport === "nba" ? NBA_ROUND_NAMES : NHL_ROUND_NAMES;
  }

  // ---------------------------------------------------------------------
  // Slot helpers
  // ---------------------------------------------------------------------

  function emptySlot() {
    return { teams: [null, null], wins: [null, null], series: null, winner: null };
  }

  function applySeriesToSlot(slot, series, expectedTop, sortBySeed, seeds) {
    var teams = (series.teams || []).slice();
    var top = teams[0] != null ? teams[0] : null;
    var bottom = teams[1] != null ? teams[1] : null;

    if (expectedTop != null) {
      if (bottom === expectedTop && top !== expectedTop) {
        var tmp = top; top = bottom; bottom = tmp;
      }
    } else if (sortBySeed && seeds && top != null && bottom != null) {
      var seedTop = seeds[top];
      var seedBottom = seeds[bottom];
      if (typeof seedTop === "number" && typeof seedBottom === "number" && seedBottom < seedTop) {
        var t2 = top; top = bottom; bottom = t2;
      }
    }

    slot.teams = [top, bottom];

    if (!series || series.projected) {
      slot.wins = [null, null];
      slot.series = null;
      slot.winner = null;
      return;
    }

    var winsMap = series.wins || {};
    slot.wins = [
      typeof winsMap[top] === "number" ? winsMap[top] : 0,
      typeof winsMap[bottom] === "number" ? winsMap[bottom] : 0
    ];
    slot.series = series;
    slot.winner = series.winner || null;
  }

  // Generic slot-filling algorithm shared by both bracket builders (spec §5,
  // "Filling one round's slots (fill)"):
  //   1. (16-team builder only) A series with a `position` goes straight into
  //      that slot.
  //   2. For each remaining slot, find an unplaced series that shares at
  //      least one team with the slot's expected teams, and apply it.
  //   3. Place any series still left into the remaining empty slots, in
  //      order.
  function fillRound(slots, seriesList, options) {
    options = options || {};
    var expected = options.expectedTeams || slots.map(function () { return [null, null]; });
    var filled = slots.map(function () { return false; });
    var used = seriesList.map(function () { return false; });

    if (options.byPosition) {
      seriesList.forEach(function (s, i) {
        if (used[i]) return;
        var pos = s.position;
        if (typeof pos === "number" && pos >= 0 && pos < slots.length && !filled[pos]) {
          applySeriesToSlot(slots[pos], s, (expected[pos] || [])[0], options.sortBySeed, options.seeds);
          filled[pos] = true;
          used[i] = true;
        }
      });
    }

    for (var idx = 0; idx < slots.length; idx++) {
      if (filled[idx]) continue;
      var exp = expected[idx] || [null, null];
      if (exp[0] == null && exp[1] == null) continue;
      for (var j = 0; j < seriesList.length; j++) {
        if (used[j]) continue;
        var teams = seriesList[j].teams || [];
        if (teams.indexOf(exp[0]) !== -1 || teams.indexOf(exp[1]) !== -1) {
          applySeriesToSlot(slots[idx], seriesList[j], exp[0], options.sortBySeed, options.seeds);
          filled[idx] = true;
          used[j] = true;
          break;
        }
      }
    }

    var leftoverSlots = [];
    for (var k = 0; k < slots.length; k++) if (!filled[k]) leftoverSlots.push(k);
    var li = 0;
    for (var m = 0; m < seriesList.length; m++) {
      if (used[m]) continue;
      if (li >= leftoverSlots.length) break;
      var slotIndex = leftoverSlots[li++];
      var exp2 = expected[slotIndex] || [null, null];
      applySeriesToSlot(slots[slotIndex], seriesList[m], exp2[0], options.sortBySeed, options.seeds);
      filled[slotIndex] = true;
      used[m] = true;
    }

    for (var n = 0; n < slots.length; n++) {
      if (!filled[n]) {
        var exp3 = expected[n];
        if (exp3 && (exp3[0] != null || exp3[1] != null)) {
          slots[n].teams = [exp3[0] || null, exp3[1] || null];
        }
      }
    }

    return slots;
  }

  function winnerOf(slot) {
    return (slot && slot.winner) || null;
  }

  // ---------------------------------------------------------------------
  // MLB: 12 teams with byes (spec §5.1)
  // ---------------------------------------------------------------------

  function buildBracketMlb(data) {
    data = data || {};
    var series = Array.isArray(data.series) ? data.series : [];
    var seeds = data.seeds || { AL: {}, NL: {} };
    var flatSeeds = {};
    ["AL", "NL"].forEach(function (lg) {
      var m = seeds[lg] || {};
      Object.keys(m).forEach(function (abbr) { flatSeeds[abbr] = m[abbr]; });
    });

    function seedTeam(lg, seedNum) {
      var m = seeds[lg] || {};
      for (var abbr in m) {
        if (Object.prototype.hasOwnProperty.call(m, abbr) && m[abbr] === seedNum) return abbr;
      }
      return null;
    }

    function byRound(lg, round) {
      return series.filter(function (s) { return s.round === round && s.league === lg; });
    }

    var sides = {};
    ["AL", "NL"].forEach(function (lg) {
      var seed1 = seedTeam(lg, 1), seed2 = seedTeam(lg, 2), seed3 = seedTeam(lg, 3);
      var seed4 = seedTeam(lg, 4), seed5 = seedTeam(lg, 5), seed6 = seedTeam(lg, 6);

      var wc = [emptySlot(), emptySlot()];
      fillRound(wc, byRound(lg, "F"), {
        expectedTeams: [[seed4, seed5], [seed3, seed6]],
        sortBySeed: true,
        seeds: flatSeeds
      });

      var ds = [emptySlot(), emptySlot()];
      fillRound(ds, byRound(lg, "D"), {
        expectedTeams: [[seed1, winnerOf(wc[0])], [seed2, winnerOf(wc[1])]],
        sortBySeed: true,
        seeds: flatSeeds
      });

      var lcs = [emptySlot()];
      fillRound(lcs, byRound(lg, "L"), {
        expectedTeams: [[winnerOf(ds[0]), winnerOf(ds[1])]],
        sortBySeed: true,
        seeds: flatSeeds
      });

      sides[lg] = { WC: wc, DS: ds, LCS: lcs };
    });

    var ws = [emptySlot()];
    fillRound(ws, series.filter(function (s) { return s.round === "W"; }), {
      expectedTeams: [[winnerOf(sides.AL.LCS[0]), winnerOf(sides.NL.LCS[0])]],
      sortBySeed: false
    });

    var columns = [
      sides.AL.WC, sides.AL.DS, sides.AL.LCS,
      ws,
      sides.NL.LCS, sides.NL.DS, sides.NL.WC
    ];
    var columnLabels = ["WC", "DS", "LCS", "WS", "LCS", "DS", "WC"];

    return {
      sport: "mlb",
      season: data.season || null,
      columns: columns,
      columnLabels: columnLabels,
      sides: sides,
      final: ws[0],
      champion: winnerOf(ws[0]),
      leftLogo: "AL",
      rightLogo: "NL",
      seeds: flatSeeds,
      names: data.names || {}
    };
  }

  // ---------------------------------------------------------------------
  // NHL / NBA: 16 teams (spec §5.2)
  // ---------------------------------------------------------------------

  function buildBracket16(data, sport) {
    data = data || {};
    var series = Array.isArray(data.series) ? data.series : [];
    var seeds = data.seeds || {};

    function byRoundConf(round, conference) {
      return series.filter(function (s) {
        return s.round === round && (conference == null ? !s.conference : s.conference === conference);
      });
    }

    var sides = {};
    ["west", "east"].forEach(function (conf) {
      var r1 = [emptySlot(), emptySlot(), emptySlot(), emptySlot()];
      fillRound(r1, byRoundConf(1, conf), { byPosition: true, sortBySeed: false });

      var r2 = [emptySlot(), emptySlot()];
      fillRound(r2, byRoundConf(2, conf), {
        byPosition: true,
        expectedTeams: [
          [winnerOf(r1[0]), winnerOf(r1[1])],
          [winnerOf(r1[2]), winnerOf(r1[3])]
        ]
      });

      var r3 = [emptySlot()];
      fillRound(r3, byRoundConf(3, conf), {
        byPosition: true,
        expectedTeams: [[winnerOf(r2[0]), winnerOf(r2[1])]]
      });

      sides[conf] = { 1: r1, 2: r2, 3: r3 };
    });

    var final = [emptySlot()];
    fillRound(final, byRoundConf(4, null), {
      byPosition: true,
      expectedTeams: [[winnerOf(sides.west[3][0]), winnerOf(sides.east[3][0])]]
    });

    var labels = ROUND16_COLUMN_LABELS[sport] || ROUND16_COLUMN_LABELS.nhl;
    var columns = [
      sides.west[1], sides.west[2], sides.west[3],
      final,
      sides.east[3], sides.east[2], sides.east[1]
    ];
    var columnLabels = [labels[1], labels[2], labels[3], labels[4], labels[3], labels[2], labels[1]];

    return {
      sport: sport,
      season: data.season || null,
      columns: columns,
      columnLabels: columnLabels,
      sides: sides,
      final: final[0],
      champion: winnerOf(final[0]),
      leftLogo: sport === "nhl" ? "WC" : null,
      rightLogo: sport === "nhl" ? "EC" : null,
      leftLabel: "WEST",
      rightLabel: "EAST",
      seeds: seeds,
      names: data.names || {}
    };
  }

  // ---------------------------------------------------------------------
  // Current round + series list (spec §5, "Current round" / "Series list slots")
  // ---------------------------------------------------------------------

  function realSeriesIn(slots) {
    return slots
      .map(function (s) { return s.series; })
      .filter(function (s) { return s && !s.projected; });
  }

  function pickCurrentRoundMlb(bracket) {
    var slotsByRound = {
      F: bracket.sides.AL.WC.concat(bracket.sides.NL.WC),
      D: bracket.sides.AL.DS.concat(bracket.sides.NL.DS),
      L: bracket.sides.AL.LCS.concat(bracket.sides.NL.LCS),
      W: [bracket.final]
    };

    var anyReal = false;
    for (var i = 0; i < MLB_ROUND_ORDER.length; i++) {
      var round = MLB_ROUND_ORDER[i];
      var real = realSeriesIn(slotsByRound[round]);
      if (real.length === 0) continue;
      anyReal = true;
      if (real.some(function (s) { return !s.winner; })) {
        return { round: round, projected: false, slots: slotsByRound[round] };
      }
    }
    if (anyReal) {
      for (var j = MLB_ROUND_ORDER.length - 1; j >= 0; j--) {
        var r2 = MLB_ROUND_ORDER[j];
        if (realSeriesIn(slotsByRound[r2]).length > 0) {
          return { round: r2, projected: false, slots: slotsByRound[r2] };
        }
      }
    }
    return { round: "F", projected: true, slots: slotsByRound.F };
  }

  function pickCurrentRound16(bracket) {
    var slotsByRound = {
      1: bracket.sides.west[1].concat(bracket.sides.east[1]),
      2: bracket.sides.west[2].concat(bracket.sides.east[2]),
      3: bracket.sides.west[3].concat(bracket.sides.east[3]),
      4: [bracket.final]
    };

    var anyReal = false;
    for (var i = 0; i < ROUND16_ORDER.length; i++) {
      var round = ROUND16_ORDER[i];
      var real = realSeriesIn(slotsByRound[round]);
      if (real.length === 0) continue;
      anyReal = true;
      if (real.some(function (s) { return !s.winner; })) {
        return { round: round, projected: false, slots: slotsByRound[round] };
      }
    }
    if (anyReal) {
      for (var j = ROUND16_ORDER.length - 1; j >= 0; j--) {
        var r2 = ROUND16_ORDER[j];
        if (realSeriesIn(slotsByRound[r2]).length > 0) {
          return { round: r2, projected: false, slots: slotsByRound[r2] };
        }
      }
    }
    return { round: 1, projected: true, slots: slotsByRound[1] };
  }

  function seriesListForMlb(bracket, round) {
    if (round === "W") return [bracket.final];
    return bracket.sides.AL[round === "F" ? "WC" : round === "D" ? "DS" : "LCS"]
      .concat(bracket.sides.NL[round === "F" ? "WC" : round === "D" ? "DS" : "LCS"]);
  }

  function seriesListFor16(bracket, round) {
    if (round === 4) return [bracket.final];
    return bracket.sides.west[round].concat(bracket.sides.east[round]);
  }

  function roundHeading(sport, round, projected, bestOfOverride) {
    var name = sport === "mlb" ? MLB_ROUND_NAMES[round] : roundNamesFor(sport)[round];
    if (projected) return "Projected " + name;
    var bestOf = bestOfOverride || (sport === "mlb" ? MLB_ROUND_BEST_OF_DEFAULT[round] : 7);
    return name + " · Best of " + bestOf;
  }

  // Public entry point: build the bracket + pick the current round + build
  // the series-list slots + heading, all in one call.
  function buildPlayoffView(sport, data) {
    var bracket, current, list, bestOf;

    if (sport === "mlb") {
      bracket = buildBracketMlb(data);
      current = pickCurrentRoundMlb(bracket);
      list = seriesListForMlb(bracket, current.round);
      bestOf = current.slots.reduce(function (acc, s) {
        return (s.series && s.series.best_of) ? s.series.best_of : acc;
      }, MLB_ROUND_BEST_OF_DEFAULT[current.round]);
    } else {
      bracket = buildBracket16(data, sport);
      current = pickCurrentRound16(bracket);
      list = seriesListFor16(bracket, current.round);
      bestOf = 7;
    }

    list = list.filter(function (slot) { return slot.teams[0] != null || slot.teams[1] != null; });

    var heading = roundHeading(sport, current.round, current.projected, bestOf);

    return {
      bracket: bracket,
      currentRound: current.round,
      projected: current.projected,
      heading: heading,
      seriesList: list
    };
  }

  // ---------------------------------------------------------------------
  // Status line text (spec §6)
  // ---------------------------------------------------------------------

  function teamName(names, code) {
    if (names && names[code]) return names[code];
    return code;
  }

  function formatGameWhen(isoUtc, timeZone, timeTbd) {
    var date = new Date(isoUtc);
    if (isNaN(date.getTime())) return "";

    var tz = timeZone || "America/Chicago";
    var now = new Date();

    var dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    var partsFor = function (d) {
      var parts = dayFmt.formatToParts(d);
      var out = {};
      parts.forEach(function (p) { out[p.type] = p.value; });
      return out;
    };
    var target = partsFor(date);
    var today = partsFor(now);

    var targetYmd = target.year + "-" + target.month + "-" + target.day;
    var todayYmd = today.year + "-" + today.month + "-" + today.day;

    var tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    var tomorrowYmd = (function () {
      var p = partsFor(tomorrow);
      return p.year + "-" + p.month + "-" + p.day;
    })();

    var dayLabel;
    if (targetYmd === todayYmd) {
      var hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false });
      var hour24 = parseInt(hourFmt.format(date), 10);
      dayLabel = hour24 >= 17 ? "Tonight" : "Today";
    } else if (targetYmd === tomorrowYmd) {
      dayLabel = "Tomorrow";
    } else {
      var diffDays = Math.round((date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      if (diffDays >= 0 && diffDays < 7) {
        dayLabel = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(date);
      } else {
        var shortFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "numeric", day: "numeric" });
        var sparts = shortFmt.formatToParts(date);
        var wd = "", md = "";
        sparts.forEach(function (p) {
          if (p.type === "weekday") wd = p.value;
          if (p.type === "month") md += p.value;
          if (p.type === "day") md += "/" + p.value;
        });
        dayLabel = wd + " " + md;
      }
    }

    if (timeTbd) return dayLabel;

    var timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true });
    var timeStr = timeFmt.format(date).replace(/^0/, "");
    timeStr = timeStr.replace(":00 ", " ");

    return dayLabel + " " + timeStr;
  }

  function seriesStatus(series, names, timeZone) {
    if (!series || series.projected) {
      return { text: "Projected", cls: "dim" };
    }

    if (series.winner) {
      var loser = series.teams.filter(function (t) { return t !== series.winner; })[0];
      var winWins = (series.wins || {})[series.winner] || 0;
      var loseWins = loser != null ? ((series.wins || {})[loser] || 0) : 0;
      return { text: teamName(names, series.winner) + " win " + winWins + "-" + loseWins, cls: "win" };
    }

    if (series.live) {
      var totalWins = 0;
      (series.teams || []).forEach(function (t) { totalWins += (series.wins || {})[t] || 0; });
      return { text: "Game " + (totalWins + 1) + " · LIVE", cls: "live" };
    }

    if (series.next_start) {
      var when = formatGameWhen(series.next_start, timeZone, !!series.next_time_tbd);
      var text = series.next_game != null ? ("Game " + series.next_game + " · " + when) : when;
      return { text: text, cls: "normal" };
    }

    var teams = series.teams || [];
    var winsMap = series.wins || {};
    var winsA = winsMap[teams[0]] || 0;
    var winsB = winsMap[teams[1]] || 0;
    if (winsA === winsB) {
      return { text: "Series tied " + winsA + "-" + winsB, cls: "normal" };
    }

    var leader = winsA > winsB ? teams[0] : teams[1];
    var leaderWins = Math.max(winsA, winsB);
    var trailWins = Math.min(winsA, winsB);
    return { text: leader + " leads " + leaderWins + "-" + trailWins, cls: "normal" };
  }

  // ---------------------------------------------------------------------
  // Layout geometry, expressed in row-height (`row_h`) units (spec §7.2).
  // Consumers multiply these by an actual pixel row height.
  // ---------------------------------------------------------------------

  // MLB "byes" mode: returns { bodyHeightUnits, tops: { WC:[t0,t1], DS:[t0,t1], LCS:[t0], WS:[t0] } }
  function mlbColumnTopsUnits() {
    var dsTops = [0, 3];
    var wcTops = [0 + 0.5, 3 + 0.5];
    var midTop = 1.5;
    return {
      bodyHeightUnits: 5.5,
      WC: wcTops,
      DS: dsTops,
      LCS: [midTop],
      WS: [midTop]
    };
  }

  // NHL/NBA "pairs" mode: recursively centers each round on the midpoint of
  // its two feeders (spec §7.2). Returns an array of arrays of tops in
  // row_h units, tops[0] = round 1 (4 slots), tops[1] = round 2 (2 slots),
  // tops[2] = round 3 / conference final (1 slot).
  function pairsColumnTopsUnits() {
    var slotH = 2; // 2 * row_h, in row_h units
    var round1 = [];
    for (var i = 0; i < 4; i++) round1.push(i * (slotH + 0.5));

    var tops = [round1];
    var current = round1;
    while (current.length > 1) {
      var next = [];
      for (var j = 0; j < current.length; j += 2) {
        var centerA = current[j] + 1; // + row_h (slot center offset)
        var centerB = current[j + 1] + 1;
        var center = (centerA + centerB) / 2;
        next.push(center - 1);
      }
      current = next;
      tops.push(current);
    }
    return { bodyHeightUnits: 9.5, rounds: tops };
  }

  return {
    // bracket building
    emptySlot: emptySlot,
    fillRound: fillRound,
    buildBracketMlb: buildBracketMlb,
    buildBracket16: buildBracket16,
    buildPlayoffView: buildPlayoffView,

    // round metadata
    MLB_ROUND_ORDER: MLB_ROUND_ORDER,
    MLB_ROUND_NAMES: MLB_ROUND_NAMES,
    MLB_COLUMN_LABELS: MLB_COLUMN_LABELS,
    ROUND16_ORDER: ROUND16_ORDER,
    NHL_ROUND_NAMES: NHL_ROUND_NAMES,
    NBA_ROUND_NAMES: NBA_ROUND_NAMES,
    ROUND16_COLUMN_LABELS: ROUND16_COLUMN_LABELS,
    roundHeading: roundHeading,

    // status text
    formatGameWhen: formatGameWhen,
    seriesStatus: seriesStatus,

    // layout geometry
    mlbColumnTopsUnits: mlbColumnTopsUnits,
    pairsColumnTopsUnits: pairsColumnTopsUnits
  };
}));

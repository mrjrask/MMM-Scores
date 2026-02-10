// node_helper.js
const NodeHelper = require("node_helper");
const dns        = require("dns");
const cheerio    = require("cheerio");
const http       = require("http");
const https      = require("https");
const { URL }    = require("url");

function createHttpFetchFallback(maxRedirects = 5) {
  const requestOnce = (url, options, redirectsLeft) => new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }

    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.request(parsed, {
      method: (options && options.method) || "GET",
      headers: (options && options.headers) || {}
    }, (res) => {
      const status = Number(res.statusCode) || 0;
      const location = res.headers && res.headers.location;

      if (status >= 300 && status < 400 && location && redirectsLeft > 0) {
        const redirectUrl = new URL(location, parsed).toString();
        res.resume();
        resolve(requestOnce(redirectUrl, options, redirectsLeft - 1));
        return;
      }

      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const response = {
          ok: status >= 200 && status < 300,
          status,
          statusText: res.statusMessage || "",
          headers: res.headers || {},
          text: async () => body,
          json: async () => JSON.parse(body)
        };
        resolve(response);
      });
    });

    req.on("error", reject);

    const body = options && options.body;
    if (typeof body !== "undefined" && body !== null) req.write(body);
    req.end();
  });

  return (url, options) => requestOnce(url, options, maxRedirects);
}

const fetch = (typeof global.fetch === "function")
  ? global.fetch.bind(global)
  : createHttpFetchFallback();

const SUPPORTED_LEAGUES = ["mlb", "nhl", "nfl", "nba", "olympic_mhockey", "olympic_whockey"];

const DNS_LOOKUP = (dns && dns.promises && typeof dns.promises.lookup === "function")
  ? (host) => dns.promises.lookup(host)
  : (host) => new Promise((resolve, reject) => {
    dns.lookup(host, (err, address, family) => {
      if (err) reject(err);
      else resolve({ address, family });
    });
  });

module.exports = NodeHelper.create({
  start() {
    console.log("🛰️ MMM-Scores helper started");
    this.fetchTimer = null;
    this._nhlStatsDnsStatus = { available: null, checkedAt: 0 };
    this._nhlStatsRestStatus = { available: null, checkedAt: 0, warnedAt: 0 };
    this._providerCache = new Map();
    this._olympicLastGoodByLeague = {};
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "INIT") {
      this.config = payload || {};
      this.leagues = this._resolveConfiguredLeagues();
      if (!Array.isArray(this.leagues) || this.leagues.length === 0) {
        this.leagues = [this._getLeague()];
      }

      if (this.fetchTimer) {
        clearInterval(this.fetchTimer);
        this.fetchTimer = null;
      }

      this._fetchGames();

      const scoreInterval = Math.max(10 * 1000, this.config.updateIntervalScores || (60 * 1000));
      this.fetchTimer = setInterval(() => this._fetchGames(), scoreInterval);
    }
  },

  async _fetchGames() {
    const leagues = Array.isArray(this.leagues) && this.leagues.length > 0
      ? this.leagues
      : [this._getLeague()];

    for (let i = 0; i < leagues.length; i++) {
      const league = leagues[i];
      try {
        if (league === "nhl") {
          await this._fetchNhlGames();
        } else if (league === "olympic_mhockey") {
          await this._fetchOlympicHockeyGames("olympic_mhockey");
        } else if (league === "olympic_whockey") {
          await this._fetchOlympicHockeyGames("olympic_whockey");
        } else if (league === "nfl") {
          await this._fetchNflGames();
        } else if (league === "nba") {
          await this._fetchNbaGames();
        } else {
          await this._fetchMlbGames();
        }
      } catch (err) {
        console.error(`🚨 ${league} fetch loop failed:`, err);
        this._notifyGames(league, []);
      }
    }
  },

  async _fetchMlbGames() {
    try {
      const { dateIso } = this._getTargetDate();
      const url  = `https://statsapi.mlb.com/api/v1/schedule/games?sportId=1&date=${dateIso}&hydrate=linescore`;
      const res  = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const json = await res.json();
      const games = (json.dates && json.dates[0] && json.dates[0].games) || [];

      console.log(`⚾️ Sending ${games.length} MLB games to front-end.`);
      this._notifyGames("mlb", games);
    } catch (e) {
      console.error("🚨 MLB fetchGames failed:", e);
      this._notifyGames("mlb", []);
    }
  },

  async _fetchNhlGames() {
    const { dateIso } = this._getTargetDate();
    const scoreboardDateIso = this._getNhlScoreboardDate();
    const targetDate = scoreboardDateIso || dateIso;

    let delivered = false;
    let sent = false;

    let statsApiAvailable = false;
    try {
      statsApiAvailable = await this._nhlStatsApiAvailable();
    } catch (availabilityError) {
      console.warn("⚠️ Unable to verify NHL stats API availability:", availabilityError);
    }

    if (statsApiAvailable) {
      try {
        const statsGames = await this._fetchNhlStatsGames(targetDate);
        const games = Array.isArray(statsGames) ? statsGames : [];
        const count = games.length;

        this._notifyGames("nhl", games);
        sent = true;

        if (count > 0) {
          console.log(`🏒 Sending ${count} NHL games to front-end (stats API).`);
          delivered = true;
        } else {
          console.info(`ℹ️ NHL stats API returned no games for ${targetDate}; trying scoreboard API.`);
        }
      } catch (statsError) {
        console.error("🚨 NHL stats API fetchGames failed:", statsError);
        console.info(`ℹ️ Attempting NHL scoreboard API for ${targetDate}`);
      }
    } else {
      console.info("ℹ️ NHL stats API appears unreachable; using scoreboard fallback.");
    }

    if (!delivered) {
      try {
        const scoreboardGames = await this._fetchNhlScoreboardGames(targetDate);
        const games = Array.isArray(scoreboardGames) ? scoreboardGames : [];
        const count = games.length;

        this._notifyGames("nhl", games);
        sent = true;

        if (count > 0) {
          console.log(`🏒 Sending ${count} NHL games to front-end (scoreboard API).`);
          delivered = true;
        } else {
          console.info(`ℹ️ NHL scoreboard API returned no games for ${targetDate}; trying stats REST fallback.`);
        }
      } catch (scoreboardError) {
        console.error("🚨 NHL scoreboard API fetchGames failed:", scoreboardError);
        console.info(`ℹ️ Attempting NHL stats REST fallback for ${targetDate}`);
      }
    }

    if (!delivered) {
      try {
        const restGames = await this._fetchNhlStatsRestGames(targetDate);
        if (restGames.length > 0) {
          console.log(`🏒 Sending ${restGames.length} NHL games to front-end (stats REST fallback).`);
          this._notifyGames("nhl", restGames);
          delivered = true;
          sent = true;
        } else {
          console.warn(`⚠️ NHL stats REST fallback returned no games for ${targetDate}.`);
        }
      } catch (restError) {
        console.error("🚨 NHL stats REST fallback failed:", restError);
      }
    }

    if (!delivered && !sent) {
      console.warn(`⚠️ Unable to fetch NHL games for ${targetDate}; sending empty schedule to front-end.`);
      this._notifyGames("nhl", []);
    }
  },

  async _nhlStatsApiAvailable() {
    const status = this._nhlStatsDnsStatus || {};
    const now = Date.now();
    const ttl = 5 * 60 * 1000; // cache DNS reachability for 5 minutes
    if (status.checkedAt && (now - status.checkedAt) < ttl && typeof status.available === "boolean") {
      return status.available;
    }

    const host = "statsapi.web.nhl.com";
    const deadline = now + 4000;
    let available = false;
    let lastError = null;

    while (!available && Date.now() < deadline) {
      try {
        await DNS_LOOKUP(host);
        available = true;
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    if (!available && lastError) {
      console.debug(`🔍 DNS lookup for ${host} failed:`, lastError.message || lastError);
    }

    this._nhlStatsDnsStatus = { available, checkedAt: now };
    return available;
  },

  async _fetchNhlStatsGames(dateIso) {
    const url = `https://statsapi.web.nhl.com/api/v1/schedule?date=${dateIso}&expand=schedule.linescore,schedule.teams`;
    const res  = await fetch(url, { headers: this._nhlRequestHeaders() });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    const dates = Array.isArray(json.dates) ? json.dates : [];
    const games = [];
    for (let i = 0; i < dates.length; i += 1) {
      const bucket = dates[i];
      if (!bucket || !Array.isArray(bucket.games)) continue;
      for (let j = 0; j < bucket.games.length; j += 1) {
        games.push(bucket.games[j]);
      }
    }

    return this._hydrateNhlGames(games);
  },

  async _fetchNhlScoreboardGames(dateIso) {
    const headers = this._nhlRequestHeaders({
      "x-nhl-stats-origin": "https://www.nhl.com",
      "x-nhl-stats-referer": "https://www.nhl.com"
    });

    const urls = [
      `https://api-web.nhle.com/v1/scoreboard/${dateIso}?site=en_nhl`,
      `https://api-web.nhle.com/v1/scoreboard/now?site=en_nhl`
    ];

    for (let u = 0; u < urls.length; u += 1) {
      const fallbackUrl = urls[u];
      try {
        const res = await fetch(fallbackUrl, { headers });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }

        const json = await res.json();
        const rawGames = this._collectNhlScoreboardGames(json, dateIso);
        const normalized = [];

        for (let i = 0; i < rawGames.length; i += 1) {
          const mapped = this._normalizeNhlScoreboardGame(rawGames[i]);
          if (mapped) normalized.push(mapped);
        }

        const hydrated = this._hydrateNhlGames(normalized);
        if (hydrated.length > 0 || u === urls.length - 1) {
          return hydrated;
        }
      } catch (err) {
        if (u === urls.length - 1) throw err;
      }
    }

    return [];
  },

  _collectNhlScoreboardGames(json, dateIso) {
    if (!json) return [];

    const targetDate = (dateIso || "").slice(0, 10);
    const games = [];
    const seen = new Set();

    const normalizeDate = (value) => {
      if (!value) return null;
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
      }
      const str = String(value).trim();
      if (!str) return null;
      if (str.includes("T")) {
        return str.split("T", 1)[0];
      }
      if (str.length >= 10) {
        return str.slice(0, 10);
      }
      return str;
    };

    const pushGame = (game) => {
      if (!game) return;

      if (targetDate) {
        const gameDate = normalizeDate(
          game.gameDate || game.startTimeUTC || game.startTime || game.gameDateTime || game.startTimeLocal
        );
        if (gameDate && gameDate !== targetDate) return;
      }

      const key = game.id || game.gamePk || game.gameId;
      const keyStr = (key != null) ? String(key) : null;
      if (keyStr && seen.has(keyStr)) return;
      if (keyStr) seen.add(keyStr);

      games.push(game);
    };

    const pushGames = (entries) => {
      if (!Array.isArray(entries)) return;
      for (let i = 0; i < entries.length; i += 1) {
        pushGame(entries[i]);
      }
    };

    const processBucket = (bucket, fallbackDate) => {
      if (!bucket) return;

      if (Array.isArray(bucket)) {
        pushGames(bucket);
        return;
      }

      const bucketObj = (typeof bucket === "object") ? bucket : {};
      const bucketDate = normalizeDate(
        fallbackDate
        || bucketObj.date
        || bucketObj.gameDate
        || bucketObj.day
      );
      if (targetDate && bucketDate && bucketDate !== targetDate) return;

      if (Array.isArray(bucketObj.games)) {
        pushGames(bucketObj.games);
        return;
      }

      const possibleLists = ["items", "events", "matchups"];
      for (let i = 0; i < possibleLists.length; i += 1) {
        const list = bucketObj[possibleLists[i]];
        if (Array.isArray(list)) {
          pushGames(list);
        }
      }

      const values = Object.values(bucketObj);
      for (let j = 0; j < values.length; j += 1) {
        if (Array.isArray(values[j])) {
          pushGames(values[j]);
        }
      }
    };

    const processBuckets = (buckets) => {
      if (!buckets) return;

      if (Array.isArray(buckets)) {
        for (let i = 0; i < buckets.length; i += 1) {
          processBucket(buckets[i]);
        }
        return;
      }

      if (typeof buckets === "object") {
        const keys = Object.keys(buckets);
        for (let i = 0; i < keys.length; i += 1) {
          const key = keys[i];
          processBucket(buckets[key], normalizeDate(key));
        }
      }
    };

    if (Array.isArray(json.games)) {
      pushGames(json.games);
    }

    processBuckets(json.gameWeek);
    processBuckets(json.dates);
    processBuckets(json.gamesByDate);
    processBuckets(json.gamesByDay);
    processBuckets(json.gamesByDateV2);

    if (json.scoreboard && typeof json.scoreboard === "object" && json.scoreboard !== json) {
      const nested = this._collectNhlScoreboardGames(json.scoreboard, dateIso);
      pushGames(nested);
    }

    return games;
  },

  _nhlRequestHeaders(extra) {
    const base = {
      "User-Agent": "Mozilla/5.0 (MMM-Scores)",
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://www.nhl.com/",
      Origin: "https://www.nhl.com",
      Pragma: "no-cache",
      "Cache-Control": "no-cache"
    };

    if (!extra) return base;
    return Object.assign({}, base, extra);
  },

  async _fetchNhlStatsRestGames(dateIso) {
    if (!this._nhlStatsRestAvailable()) {
      return [];
    }

    const restUrl = `https://api.nhle.com/stats/rest/en/schedule?cayenneExp=gameDate=%22${dateIso}%22`;
    const res = await fetch(restUrl, { headers: this._nhlRequestHeaders({
      "x-nhl-stats-origin": "https://www.nhl.com",
      "x-nhl-stats-referer": "https://www.nhl.com"
    }) });
    if (!res.ok) {
      if (res.status === 404) {
        this._markNhlStatsRestUnavailable();
      }
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    const rawGames = Array.isArray(json.data) ? json.data : [];
    const normalized = [];

    for (let i = 0; i < rawGames.length; i += 1) {
      const mapped = this._normalizeNhlStatsRestGame(rawGames[i]);
      if (mapped) normalized.push(mapped);
    }

    return this._hydrateNhlGames(normalized);
  },

  _nhlStatsRestAvailable() {
    const status = this._nhlStatsRestStatus || {};
    const now = Date.now();
    const ttl = 24 * 60 * 60 * 1000;
    if (status.checkedAt && (now - status.checkedAt) < ttl && status.available === false) {
      if (!status.warnedAt || (now - status.warnedAt) > ttl) {
        console.info("ℹ️ NHL stats REST endpoint previously returned 404; skipping REST fallback.");
        this._nhlStatsRestStatus.warnedAt = now;
      }
      return false;
    }

    return true;
  },

  _markNhlStatsRestUnavailable() {
    this._nhlStatsRestStatus = {
      available: false,
      checkedAt: Date.now(),
      warnedAt: Date.now()
    };
    console.info("ℹ️ NHL stats REST endpoint returned 404; disabling REST fallback for 24 hours.");
  },

  _hydrateNhlGames(games) {
    if (!Array.isArray(games)) return [];

    const hydrated = [];
    for (let i = 0; i < games.length; i += 1) {
      const game = this._hydrateNhlGame(games[i]);
      if (game) hydrated.push(game);
    }

    hydrated.sort((a, b) => {
      const dateA = this._firstDate(
        a && a.startTimeUTC,
        a && a.gameDate,
        a && a.startTime,
        a && a.gameDateTime,
        a && a.startTimeLocal
      );
      const dateB = this._firstDate(
        b && b.startTimeUTC,
        b && b.gameDate,
        b && b.startTime,
        b && b.gameDateTime,
        b && b.startTimeLocal
      );

      if (dateA && dateB) return dateA - dateB;
      if (dateA) return -1;
      if (dateB) return 1;
      return 0;
    });

    return hydrated;
  },


  _hydrateNhlGame(game) {
    if (!game || typeof game !== "object") return null;

    const normalized = Object.assign({}, game);

    const startDate = this._firstDate(
      normalized && normalized.startTimeUTC,
      normalized && normalized.gameDate,
      normalized && normalized.startTime,
      normalized && normalized.gameDateTime,
      normalized && normalized.startTimeLocal
    );

    if (startDate) {
      const iso = startDate.toISOString();
      if (!normalized.gameDate) normalized.gameDate = iso;
      if (!normalized.startTimeUTC) normalized.startTimeUTC = iso;
    }

    const status = (normalized && typeof normalized.status === "object") ? normalized.status : {};
    normalized.status = Object.assign({
      abstractGameState: "Preview",
      detailedState: (status && status.detailedState) || ""
    }, status);

    const linescore = (normalized && typeof normalized.linescore === "object") ? normalized.linescore : {};
    const lsTeams = (linescore && typeof linescore.teams === "object") ? linescore.teams : {};
    linescore.teams = {
      away: this._hydrateNhlLinescoreTeam(lsTeams.away),
      home: this._hydrateNhlLinescoreTeam(lsTeams.home)
    };

    if (Object.prototype.hasOwnProperty.call(linescore, "currentPeriod")) {
      const cp = this._asNumberOrNull(linescore.currentPeriod);
      if (cp != null) linescore.currentPeriod = cp;
    } else {
      linescore.currentPeriod = null;
    }

    if (typeof linescore.currentPeriodTimeRemaining === "string") {
      linescore.currentPeriodTimeRemaining = linescore.currentPeriodTimeRemaining.trim();
    }

    normalized.linescore = Object.assign({
      currentPeriod: linescore.currentPeriod,
      currentPeriodOrdinal: linescore.currentPeriodOrdinal || "",
      currentPeriodTimeRemaining: linescore.currentPeriodTimeRemaining || "",
      teams: linescore.teams
    }, linescore);

    const teams = (normalized && typeof normalized.teams === "object") ? normalized.teams : {};
    normalized.teams = {
      away: this._hydrateNhlGameTeam(teams.away),
      home: this._hydrateNhlGameTeam(teams.home)
    };

    return normalized;
  },

  _hydrateNhlGameTeam(entry) {
    const teamEntry = Object.assign({}, entry || {});
    const team = Object.assign({}, teamEntry.team || {});

    if (team.abbreviation && typeof team.abbreviation === "string") {
      team.abbreviation = team.abbreviation.toUpperCase();
    }
    if (team.teamAbbreviation && typeof team.teamAbbreviation === "string") {
      team.teamAbbreviation = team.teamAbbreviation.toUpperCase();
    }
    if (!team.teamAbbreviation && team.abbreviation) {
      team.teamAbbreviation = team.abbreviation;
    }

    teamEntry.team = team;

    if (Object.prototype.hasOwnProperty.call(teamEntry, "score")) {
      const score = this._asNumberOrNull(teamEntry.score);
      teamEntry.score = (score != null) ? score : teamEntry.score;
    }

    const shotCandidates = [
      teamEntry.shotsOnGoal,
      teamEntry.sog,
      teamEntry.shots,
      teamEntry.shotsTotal,
      teamEntry.totalShots,
      teamEntry.shotsOnGoalTotal
    ];

    const nestedShotSources = [
      teamEntry.stats,
      teamEntry.teamStats,
      teamEntry.statistics,
      teamEntry.teamSkaterStats,
      teamEntry.skaterStats
    ];

    for (let ns = 0; ns < nestedShotSources.length; ns += 1) {
      const source = nestedShotSources[ns];
      if (source && typeof source === "object") {
        shotCandidates.push(
          source.shotsOnGoal,
          source.sog,
          source.shots,
          source.shotsTotal,
          source.totalShots
        );

        if (source.teamSkaterStats && typeof source.teamSkaterStats === "object") {
          shotCandidates.push(
            source.teamSkaterStats.shotsOnGoal,
            source.teamSkaterStats.sog,
            source.teamSkaterStats.shots
          );
        }
      }
    }
    let shots = null;
    for (let i = 0; i < shotCandidates.length; i += 1) {
      const val = this._asNumberOrNull(shotCandidates[i]);
      if (val != null) {
        shots = val;
        break;
      }
    }
    if (shots != null) teamEntry.shotsOnGoal = shots;
    else if (!Object.prototype.hasOwnProperty.call(teamEntry, "shotsOnGoal")) teamEntry.shotsOnGoal = null;

    return teamEntry;
  },

  _hydrateNhlLinescoreTeam(entry) {
    const team = Object.assign({}, entry || {});
    const shotKeys = [
      "shotsOnGoal",
      "sog",
      "shots",
      "shotsTotal",
      "totalShots",
      "shotsOnGoalTotal"
    ];

    let sog = null;
    for (let i = 0; i < shotKeys.length; i += 1) {
      const key = shotKeys[i];
      if (Object.prototype.hasOwnProperty.call(team, key)) {
        sog = this._asNumberOrNull(team[key]);
        if (sog != null) break;
      }
    }

    if (sog == null) {
      const nestedSources = [team.stats, team.teamStats, team.statistics, team.teamSkaterStats, team.skaterStats];
      for (let j = 0; j < nestedSources.length; j += 1) {
        const src = nestedSources[j];
        if (src && typeof src === "object") {
          const nestedCandidates = [
            src.shotsOnGoal,
            src.sog,
            src.shots,
            src.shotsTotal,
            src.totalShots
          ];
          for (let nk = 0; nk < nestedCandidates.length; nk += 1) {
            const candidate = this._asNumberOrNull(nestedCandidates[nk]);
            if (candidate != null) {
              sog = candidate;
              break;
            }
          }
        }
        if (sog != null) break;
      }
    }

    team.shotsOnGoal = (sog != null) ? sog : null;
    return team;
  },

  _normalizeNhlScoreboardGame(game) {
    if (!game) return null;

    const periodDescriptor = game.periodDescriptor || {};
    const status = this._nhlScoreboardStatus(game, periodDescriptor);

    const awayTeam = this._normalizeNhlScoreboardTeam(game.awayTeam);
    const homeTeam = this._normalizeNhlScoreboardTeam(game.homeTeam);

    const periodRemainingText = this._nhlScoreboardText(periodDescriptor.periodTimeRemaining || "");
    const clockText = this._nhlScoreboardText(game.clock || "");
    const currentPeriodTimeRemaining = periodRemainingText || clockText;

    const linescore = {
      currentPeriod: this._asNumberOrNull(periodDescriptor.number),
      currentPeriodOrdinal: this._nhlScoreboardPeriodOrdinal(periodDescriptor),
      currentPeriodTimeRemaining,
      teams: {
        away: { shotsOnGoal: this._asNumberOrNull(awayTeam.shotsOnGoal) },
        home: { shotsOnGoal: this._asNumberOrNull(homeTeam.shotsOnGoal) }
      }
    };

    return {
      gamePk: game.id || game.gamePk,
      gameDate: game.startTimeUTC || game.gameDate || null,
      startTimeUTC: game.startTimeUTC || null,
      season: game.season,
      status: status,
      linescore: linescore,
      teams: {
        away: { team: awayTeam.team, score: awayTeam.score },
        home: { team: homeTeam.team, score: homeTeam.score }
      }
    };
  },

  _normalizeNhlStatsRestGame(game) {
    if (!game) return null;

    const periodDescriptor = {
      number: this._asNumberOrNull(game.period),
      periodType: game.periodType,
      periodTimeRemaining: game.gameClock
    };

    const status = this._nhlScoreboardStatus({
      gameState: game.gameState,
      gameScheduleState: game.gameScheduleState,
      clock: game.gameClock
    }, periodDescriptor);

    const away = this._normalizeNhlStatsRestTeam(game, "away");
    const home = this._normalizeNhlStatsRestTeam(game, "home");

    const linescore = {
      currentPeriod: this._asNumberOrNull(game.period),
      currentPeriodOrdinal: this._nhlScoreboardPeriodOrdinal(periodDescriptor),
      currentPeriodTimeRemaining: this._nhlScoreboardText(game.gameClock || ""),
      teams: {
        away: { shotsOnGoal: away.shotsOnGoal },
        home: { shotsOnGoal: home.shotsOnGoal }
      }
    };

    const gamePk = this._asNumberOrNull(game.gamePk || game.gameId || game.id);
    const gameDate = game.gameDate || game.startTimeUTC || null;

    return {
      gamePk: gamePk != null ? gamePk : (game.gamePk || game.gameId || game.id),
      gameDate,
      startTimeUTC: game.startTimeUTC || gameDate || null,
      season: game.seasonId || game.season || null,
      status,
      linescore,
      teams: {
        away: { team: away.team, score: away.score },
        home: { team: home.team, score: home.score }
      }
    };
  },

  _normalizeNhlStatsRestTeam(game, side) {
    const prefix = side === "home" ? "home" : "away";

    const abbr = this._nhlScoreboardText(
      game[`${prefix}TeamAbbrev`]
        || game[`${prefix}TeamAbbreviation`]
        || game[`${prefix}TeamTriCode`]
        || game[`${prefix}TeamShortName`]
        || ""
    ).toUpperCase();

    const location = this._nhlScoreboardText(
      game[`${prefix}TeamPlaceName`]
        || game[`${prefix}TeamLocation`]
        || game[`${prefix}TeamCity`]
        || game[`${prefix}TeamMarket`]
        || ""
    );

    const name = this._nhlScoreboardText(
      game[`${prefix}TeamCommonName`]
        || game[`${prefix}TeamName`]
        || game[`${prefix}TeamNickName`]
        || game[`${prefix}TeamFullName`]
        || ""
    );

    const shortName = this._nhlScoreboardText(game[`${prefix}TeamShortName`] || name || abbr || "");

    const display = (location && name) ? `${location} ${name}`.trim() : (name || location || abbr || "");

    const shotKeys = [
      `${prefix}TeamShotsOnGoal`,
      `${prefix}TeamSOG`,
      `${prefix}TeamSoG`,
      `${prefix}TeamShots`,
      `${prefix}ShotsOnGoal`,
      `${prefix}Shots`
    ];
    let shots = null;
    for (let i = 0; i < shotKeys.length; i += 1) {
      shots = this._asNumberOrNull(game[shotKeys[i]]);
      if (shots != null) break;
    }

    const id = this._asNumberOrNull(game[`${prefix}TeamId`] || game[`${prefix}TeamID`] || game[`${prefix}Team`]);

    const scoreKeys = [
      `${prefix}TeamScore`,
      `${prefix}Score`
    ];
    let score = null;
    for (let j = 0; j < scoreKeys.length; j += 1) {
      score = this._asNumberOrNull(game[scoreKeys[j]]);
      if (score != null) break;
    }

    return {
      team: {
        id: id != null ? id : undefined,
        name: display,
        teamName: name || display,
        locationName: location,
        abbreviation: abbr,
        teamAbbreviation: abbr,
        shortName
      },
      score,
      shotsOnGoal: shots
    };
  },

  _normalizeNhlScoreboardTeam(team) {
    if (!team) {
      return {
        team: {},
        score: null,
        shotsOnGoal: null
      };
    }

    const abbrRaw = this._nhlScoreboardText(team.teamAbbrev || team.abbrev || team.triCode || team.teamCode || team.shortName || "");
    const abbr = abbrRaw ? abbrRaw.toUpperCase() : "";
    const place = this._nhlScoreboardText(team.placeName || team.locationName || team.city || team.market || "");
    const name = this._nhlScoreboardText(team.teamName || team.nickName || team.name || "");
    const shortName = this._nhlScoreboardText(team.shortName || name || abbr || "");
    const display = (place && name) ? `${place} ${name}`.trim() : (name || place || abbr || "");

    return {
      team: {
        id: (typeof team.id !== "undefined") ? team.id : undefined,
        name: display,
        teamName: name || display,
        locationName: place,
        abbreviation: abbr,
        teamAbbreviation: abbr,
        shortName: shortName
      },
      score: this._asNumberOrNull((typeof team.score !== "undefined") ? team.score : team.goals),
      shotsOnGoal: this._asNumberOrNull(team.sog != null ? team.sog : team.shotsOnGoal)
    };
  },

  _nhlScoreboardText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        const text = this._nhlScoreboardText(value[i]);
        if (text) return text;
      }
      return "";
    }

    if (typeof value === "object") {
      const preferredKeys = ["default", "en", "en_US", "en-us", "english", "text", "name"]; // scoreboard locales vary
      for (let i = 0; i < preferredKeys.length; i += 1) {
        const key = preferredKeys[i];
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const text = this._nhlScoreboardText(value[key]);
          if (text) return text;
        }
      }

      const keys = Object.keys(value);
      for (let j = 0; j < keys.length; j += 1) {
        const text = this._nhlScoreboardText(value[keys[j]]);
        if (text) return text;
      }
      return "";
    }

    return String(value);
  },

  _nhlScoreboardStatus(game, periodDescriptor) {
    const stateRaw = (game && game.gameState) ? this._nhlScoreboardText(game.gameState) : "";
    const state = stateRaw.toUpperCase();
    const scheduleRaw = (game && game.gameScheduleState) ? this._nhlScoreboardText(game.gameScheduleState) : "";
    const schedule = scheduleRaw.toUpperCase();
    const clockRaw = (game && game.clock) ? this._nhlScoreboardText(game.clock) : "";
    const periodRemainingRaw = (periodDescriptor && periodDescriptor.periodTimeRemaining)
      ? this._nhlScoreboardText(periodDescriptor.periodTimeRemaining)
      : "";
    const timeRemainingRaw = periodRemainingRaw || clockRaw;

    let abstract = "Preview";
    let detailed = "";

    if (state === "LIVE" || state === "CRIT" || state === "CRIT_NONOT") {
      abstract = "Live";
      const ord = this._nhlScoreboardPeriodOrdinal(periodDescriptor);
      const remaining = (timeRemainingRaw || "").trim();
      if (remaining && remaining.toUpperCase() === "END") {
        detailed = ((ord ? ord + " " : "") + "End").trim();
      } else {
        const parts = [];
        if (ord) parts.push(ord);
        if (remaining) parts.push(remaining);
        detailed = parts.join(" ").trim();
      }
      if (!detailed) detailed = "Live";
    } else if (state === "FINAL" || state === "OFF" || state === "COMPLETE" || state === "COMPLETED") {
      abstract = "Final";
      detailed = this._nhlScoreboardFinalDetail(periodDescriptor);
    } else if (state === "POSTPONED" || schedule === "PPD") {
      abstract = "Preview";
      detailed = "Postponed";
    } else if (state === "SUSP" || schedule === "SUSP") {
      abstract = "Preview";
      detailed = "Suspended";
    } else if (state === "FUT" || state === "PRE" || state === "SCHEDULED") {
      abstract = "Preview";
      detailed = "Scheduled";
    } else if (state === "CANCELLED" || state === "CNCL") {
      abstract = "Preview";
      detailed = "Cancelled";
    }

    if (!detailed) {
      if (scheduleRaw) detailed = scheduleRaw;
      else detailed = stateRaw;
    }

    return {
      abstractGameState: abstract,
      detailedState: detailed
    };
  },

  _nhlScoreboardPeriodOrdinal(periodDescriptor) {
    const number = this._asNumberOrNull(periodDescriptor && periodDescriptor.number);
    const type = ((periodDescriptor && periodDescriptor.periodType) || "").toString().toUpperCase();

    if (!Number.isFinite(number)) return "";

    if (type === "SO") return "SO";
    if (type === "OT") {
      if (number <= 4) return "OT";
      return `${number - 3}OT`;
    }

    if (number === 1) return "1st";
    if (number === 2) return "2nd";
    if (number === 3) return "3rd";
    return `${number}th`;
  },

  _nhlScoreboardFinalDetail(periodDescriptor) {
    const type = ((periodDescriptor && periodDescriptor.periodType) || "").toString().toUpperCase();
    const number = this._asNumberOrNull(periodDescriptor && periodDescriptor.number);

    if (type === "SO") return "Final/SO";
    if (type === "OT") {
      if (number && number > 4) {
        return `Final/${number - 3}OT`;
      }
      return "Final/OT";
    }
    return "Final";
  },

  _asNumberOrNull(value) {
    if (value == null) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;

    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;

    const intVal = parseInt(value, 10);
    return Number.isFinite(intVal) ? intVal : null;
  },



  async _fetchOlympicHockeyGames(league) {
    const leagueKey = league === "olympic_whockey" ? "olympic_whockey" : "olympic_mhockey";
    const providerPlans = leagueKey === "olympic_whockey"
      ? [
        { name: "espn_womens_olympics", fetcher: (dateIso, dateCompact) => this.fetchOlympicScoreboardWomen(dateIso, dateCompact) },
        { name: "olympics_com", fetcher: (dateIso) => this._fetchOlympicsComFallback(leagueKey, dateIso) },
        { name: "iihf", fetcher: (dateIso) => this._fetchIihfFallback(leagueKey, dateIso) },
        { name: "thesportsdb", fetcher: (dateIso) => this._fetchTheSportsDbFallback(leagueKey, dateIso) },
        { name: "wikipedia", fetcher: (dateIso) => this._fetchWikipediaFinalsFallback(leagueKey, dateIso) }
      ]
      : [
        { name: "espn_mens_olympics", fetcher: (dateIso, dateCompact) => this.fetchOlympicScoreboardMen(dateIso, dateCompact) },
        { name: "olympics_com", fetcher: (dateIso) => this._fetchOlympicsComFallback(leagueKey, dateIso) },
        { name: "iihf", fetcher: (dateIso) => this._fetchIihfFallback(leagueKey, dateIso) },
        { name: "thesportsdb", fetcher: (dateIso) => this._fetchTheSportsDbFallback(leagueKey, dateIso) },
        { name: "wikipedia", fetcher: (dateIso) => this._fetchWikipediaFinalsFallback(leagueKey, dateIso) }
      ];

    try {
      const { dateIso, dateCompact } = this._getTargetDate();
      let normalizedGames = [];
      let providerUsed = "none";

      for (let i = 0; i < providerPlans.length; i += 1) {
        const provider = providerPlans[i];
        try {
          const cached = this._getProviderCache(provider.name, leagueKey, dateIso);
          if (cached) {
            normalizedGames = cached;
            providerUsed = `${provider.name} (cache)`;
            break;
          }

          const candidate = await provider.fetcher(dateIso, dateCompact);
          const games = Array.isArray(candidate) ? candidate : [];
          if (games.length > 0) {
            normalizedGames = games;
            providerUsed = provider.name;
            this._setProviderCache(provider.name, leagueKey, dateIso, games);
            break;
          }
          console.info(`ℹ️ ${leagueKey} provider ${provider.name} returned 0 games, trying fallback.`);
        } catch (providerError) {
          console.warn(`⚠️ ${leagueKey} provider ${provider.name} failed, trying fallback:`, providerError.message || providerError);
        }
      }

      if (normalizedGames.length === 0) {
        const resultPageEvents = await this._fetchOlympicResultsPageGames(leagueKey, dateIso);
        const resultsFallbackGames = this._normalizedOlympicGamesFromEvents(resultPageEvents, leagueKey, "espn_results_page");
        if (resultsFallbackGames.length > 0) {
          normalizedGames = resultsFallbackGames;
          providerUsed = "espn_results_page";
        }
      }

      if (normalizedGames.length > 0) {
        this._olympicLastGoodByLeague[leagueKey] = normalizedGames;
      } else if (Array.isArray(this._olympicLastGoodByLeague[leagueKey]) && this._olympicLastGoodByLeague[leagueKey].length > 0) {
        normalizedGames = this._olympicLastGoodByLeague[leagueKey];
        providerUsed = "last_good_cache";
      }

      const events = this._normalizedGamesToLegacyEvents(normalizedGames);
      console.log(`🥅 Sending ${events.length} ${leagueKey} games for ${dateIso} to front-end via ${providerUsed}.`);
      this._notifyGames(leagueKey, events, {
        olympicDiagnostics: {
          providerUsed,
          fetchedAtUTC: new Date().toISOString(),
          gameCount: events.length,
          dateIso
        }
      });
    } catch (e) {
      console.error(`🚨 ${leagueKey} fetchGames failed:`, e);
      const fallbackGames = Array.isArray(this._olympicLastGoodByLeague[leagueKey]) ? this._olympicLastGoodByLeague[leagueKey] : [];
      this._notifyGames(leagueKey, this._normalizedGamesToLegacyEvents(fallbackGames));
    }
  },

  async fetchOlympicScoreboardMen(dateIso, dateCompact) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/mens-olympics/scoreboard?dates=${dateCompact || String(dateIso || "").replace(/-/g, "")}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    return this.normalizeEspnOlympicResponse(json, "olympic_mhockey", "espn_mens_olympics");
  },

  async fetchOlympicScoreboardWomen(dateIso, dateCompact) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/womens-olympics/scoreboard?dates=${dateCompact || String(dateIso || "").replace(/-/g, "")}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    return this.normalizeEspnOlympicResponse(json, "olympic_whockey", "espn_womens_olympics");
  },

  normalizeEspnOlympicResponse(json, leagueKey, providerName) {
    const events = this._collectEspnScoreboardEvents(json);
    return this._normalizedOlympicGamesFromEvents(events, leagueKey, providerName);
  },

  _normalizedOlympicGamesFromEvents(events, leagueKey, providerName) {
    const fetchedAtUTC = new Date().toISOString();
    const normalized = [];
    const eventList = Array.isArray(events) ? events : [];
    for (let i = 0; i < eventList.length; i += 1) {
      const event = eventList[i] || {};
      const competition = event && Array.isArray(event.competitions)
        ? event.competitions[0]
        : (event.competition && typeof event.competition === "object" ? event.competition : null);
      const competitors = competition && Array.isArray(competition.competitors) ? competition.competitors : [];
      if (competitors.length < 2) continue;
      const homeCompetitor = competitors.find((item) => item && item.homeAway === "home") || competitors[0] || {};
      const awayCompetitor = competitors.find((item) => item && item.homeAway === "away") || competitors[1] || {};
      const status = this._normalizeOlympicStatus(event.status || (competition && competition.status) || {});

      const homeTeam = this._normalizeOlympicTeam(homeCompetitor);
      const awayTeam = this._normalizeOlympicTeam(awayCompetitor);
      if (!homeTeam || !awayTeam) continue;

      normalized.push({
        leagueKey,
        gameId: String(event.id || (competition && competition.id) || `${leagueKey}-${i}`),
        startTimeUTC: this._firstString(
          event.date,
          event.startDate,
          competition && (competition.date || competition.startDate),
          ""
        ),
        status: status.status,
        period: status.period,
        clock: status.clock,
        home: homeTeam,
        away: awayTeam,
        venue: competition && competition.venue ? (competition.venue.fullName || competition.venue.name || "") : "",
        source: { providerName, fetchedAtUTC }
      });
    }

    normalized.sort((a, b) => {
      const da = this._firstDate(a.startTimeUTC);
      const db = this._firstDate(b.startTimeUTC);
      if (da && db) return da - db;
      if (da) return -1;
      if (db) return 1;
      return 0;
    });

    return normalized;
  },

  _normalizeOlympicStatus(statusObj) {
    const rawType = (((statusObj || {}).type || {}).state || "").toString().toLowerCase();
    const detailed = (((statusObj || {}).type || {}).description || (statusObj || {}).detail || "").toString();
    const period = (((statusObj || {}).type || {}).shortDetail || "").toString();
    const clock = ((statusObj || {}).displayClock || "").toString();

    let status = "pre";
    if (rawType === "in" || rawType === "live") status = "live";
    else if (rawType === "post" || rawType === "final") status = "final";

    return { status, detailed, period, clock };
  },

  _normalizeOlympicTeam(competitor) {
    const team = (competitor && competitor.team) || {};
    const name = team.displayName || team.shortDisplayName || team.name || competitor.displayName || "";
    const code3 = String(team.abbreviation || team.shortDisplayName || "").trim().toUpperCase().slice(0, 3);
    if (!name && !code3) return null;
    return {
      code3,
      name,
      score: competitor && competitor.score != null ? String(competitor.score) : ""
    };
  },

  _normalizedGamesToLegacyEvents(games) {
    const list = Array.isArray(games) ? games : [];
    return list.map((game) => {
      const statusObj = this._legacyStatusFromNormalized(game);
      return {
        id: game.gameId,
        date: game.startTimeUTC,
        competitions: [{
          date: game.startTimeUTC,
          competitors: [
            { homeAway: "away", score: game.away && game.away.score, team: { abbreviation: game.away && game.away.code3, displayName: game.away && game.away.name } },
            { homeAway: "home", score: game.home && game.home.score, team: { abbreviation: game.home && game.home.code3, displayName: game.home && game.home.name } }
          ],
          venue: { fullName: game.venue || "" },
          status: statusObj
        }],
        status: statusObj
      };
    });
  },

  _legacyStatusFromNormalized(game) {
    const state = (game && game.status) || "pre";
    const isLive = state === "live";
    const isFinal = state === "final";
    return {
      abstractGameState: isLive ? "Live" : (isFinal ? "Final" : "Preview"),
      detailedState: isLive
        ? (game.period || game.clock || "In Progress")
        : (isFinal ? "Final" : "Scheduled"),
      displayClock: (game && game.clock) || "",
      period: (game && game.period) || "",
      type: {
        state: isLive ? "in" : (isFinal ? "post" : "pre"),
        description: isLive ? "In Progress" : (isFinal ? "Final" : "Scheduled"),
        shortDetail: (game && game.period) || (isFinal ? "Final" : "Scheduled")
      }
    };
  },

  _getProviderCache(providerName, leagueKey, dateIso) {
    const ttlMs = Math.max(15000, Number(this.config && this.config.providerCacheMs) || 20000);
    const key = `${providerName}|${leagueKey}|${dateIso}`;
    const entry = this._providerCache.get(key);
    if (!entry) return null;
    if ((Date.now() - entry.savedAtMs) > ttlMs) {
      this._providerCache.delete(key);
      return null;
    }
    return Array.isArray(entry.games) ? entry.games : null;
  },

  _setProviderCache(providerName, leagueKey, dateIso, games) {
    const key = `${providerName}|${leagueKey}|${dateIso}`;
    this._providerCache.set(key, {
      savedAtMs: Date.now(),
      games: Array.isArray(games) ? games : []
    });
  },

  async _fetchOlympicsComFallback(_leagueKey, _dateIso) {
    // TODO: olympics.com HTML/JSON discovery provider integration.
    return [];
  },

  async _fetchIihfFallback(_leagueKey, _dateIso) {
    // TODO: IIHF Olympic schedule/results provider integration.
    return [];
  },

  async _fetchTheSportsDbFallback(_leagueKey, _dateIso) {
    // TODO: TheSportsDB free community API provider integration.
    return [];
  },

  async _fetchWikipediaFinalsFallback(_leagueKey, _dateIso) {
    // TODO: Wikipedia/Wikidata completed-game finals fallback integration.
    return [];
  },

  async _fetchOlympicResultsPageGames(league, dateIso) {
    const urls = [
      "https://www.espn.com/olympics/winter/2026/results",
      "https://www.espn.com/olympics/winter/_/year/2026/results"
    ];

    for (let i = 0; i < urls.length; i += 1) {
      const url = urls[i];
      try {
        const res = await fetch(url, {
          headers: {
            "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.9"
          }
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }

        const html = await res.text();
        const roots = this._extractEspnPageStatePayloads(html);
        const rawGames = [];

        for (let r = 0; r < roots.length; r += 1) {
          this._collectOlympicResultsCandidates(roots[r], rawGames);
        }

        const normalized = [];
        for (let g = 0; g < rawGames.length; g += 1) {
          const candidate = rawGames[g] || {};
          if (!this._resultCandidateMatchesLeague(candidate, league)) continue;

          const normalizedGame = this._normalizeOlympicResultsGame(candidate.game);
          if (!normalizedGame) continue;

          const gameDate = this._firstDate(
            normalizedGame.date,
            normalizedGame.competitions && normalizedGame.competitions[0] && normalizedGame.competitions[0].date
          );
          const gameDateIso = gameDate ? gameDate.toISOString().slice(0, 10) : "";
          if (dateIso && gameDateIso && gameDateIso !== dateIso) continue;

          normalized.push(normalizedGame);
        }

        if (normalized.length > 0) {
          return this._dedupeEspnEvents(normalized);
        }
      } catch (err) {
        console.warn(`⚠️ ${league} results-page fallback failed at ${url}:`, err.message || err);
      }
    }

    return [];
  },

  _extractEspnPageStatePayloads(html) {
    if (!html || typeof html !== "string") return [];
    const payloads = [];

    const parseAndPush = (jsonText) => {
      if (!jsonText || typeof jsonText !== "string") return;
      try {
        payloads.push(JSON.parse(jsonText));
      } catch (_err) {
        // ignore malformed payloads
      }
    };

    const nextDataMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch && nextDataMatch[1]) parseAndPush(nextDataMatch[1].trim());

    const fittMatch = html.match(/window\[['"]__espnfitt__['"]\]\s*=\s*([\s\S]*?);\s*<\/script>/i);
    if (fittMatch && fittMatch[1]) parseAndPush(fittMatch[1].trim());

    const initialStateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*([\s\S]*?);\s*(?:window\.|<\/script>)/i);
    if (initialStateMatch && initialStateMatch[1]) parseAndPush(initialStateMatch[1].trim());

    return payloads;
  },

  _collectOlympicResultsCandidates(value, out, depth = 0, seen = null, context = null) {
    if (!value || depth > 14) return;
    if (!seen) seen = new Set();
    if (!context) context = { sport: null, division: null };

    if (typeof value === "object") {
      if (seen.has(value)) return;
      seen.add(value);
    }

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        this._collectOlympicResultsCandidates(value[i], out, depth + 1, seen, context);
      }
      return;
    }

    if (typeof value !== "object") return;

    const label = this._extractOlympicSectionLabel(value);
    const nextContext = {
      sport: context.sport,
      division: context.division
    };

    if (label) {
      if (this._labelMentionsIceHockey(label)) nextContext.sport = "ice_hockey";
      const division = this._extractOlympicDivisionFromText(label);
      if (division) nextContext.division = division;
    }

    const competitors = Array.isArray(value.competitors)
      ? value.competitors
      : (value.competition && Array.isArray(value.competition.competitors) ? value.competition.competitors : null);
    const hasCompetitionShape = competitors && competitors.length >= 2 && (value.date || value.startDate || value.status || value.competition);
    if (hasCompetitionShape) {
      const rawDivision = this._extractOlympicDivisionFromText(JSON.stringify(value));
      const division = rawDivision || nextContext.division;
      const sport = nextContext.sport || (this._labelMentionsIceHockey(JSON.stringify(value)) ? "ice_hockey" : null);

      out.push({
        game: value,
        sport,
        division
      });
    }

    const keys = Object.keys(value);
    for (let k = 0; k < keys.length; k += 1) {
      this._collectOlympicResultsCandidates(value[keys[k]], out, depth + 1, seen, nextContext);
    }
  },

  _extractOlympicSectionLabel(value) {
    if (!value || typeof value !== "object") return "";

    const candidates = [
      value.header,
      value.title,
      value.name,
      value.shortName,
      value.displayName,
      value.description,
      value.text,
      value.label
    ];

    for (let i = 0; i < candidates.length; i += 1) {
      const entry = candidates[i];
      if (typeof entry === "string" && entry.trim()) return entry;
      if (entry && typeof entry === "object") {
        const nested = [entry.text, entry.label, entry.displayName, entry.name, entry.shortText];
        for (let n = 0; n < nested.length; n += 1) {
          if (typeof nested[n] === "string" && nested[n].trim()) return nested[n];
        }
      }
    }

    return "";
  },

  _extractOlympicDivisionFromText(text) {
    if (!text || typeof text !== "string") return null;
    const lower = text.toLowerCase();
    if (/women\b|women's|womens/.test(lower)) return "women";
    if (/men\b|men's|mens/.test(lower)) return "men";
    return null;
  },

  _labelMentionsIceHockey(text) {
    if (!text || typeof text !== "string") return false;
    return text.toLowerCase().includes("ice hockey");
  },

  _resultCandidateMatchesLeague(candidate, league) {
    if (!candidate || typeof candidate !== "object") return false;
    if (candidate.sport !== "ice_hockey") return false;

    if (league === "olympic_whockey") return candidate.division === "women";
    if (league === "olympic_mhockey") return candidate.division === "men";
    return true;
  },

  _normalizeOlympicResultsGame(raw) {
    if (!raw || typeof raw !== "object") return null;
    const source = raw.competition && typeof raw.competition === "object" ? raw.competition : raw;
    const competitors = Array.isArray(source.competitors) ? source.competitors : [];
    if (competitors.length < 2) return null;

    const normalizedCompetitors = [];
    for (let i = 0; i < competitors.length; i += 1) {
      const entry = competitors[i] || {};
      const team = entry.team || entry.athlete || entry.participant || {};
      const name = team.displayName || team.shortDisplayName || team.name || entry.displayName || entry.name;
      const abbr = team.abbreviation || entry.abbreviation || team.shortName || (name ? String(name).slice(0, 3).toUpperCase() : "");
      if (!name && !abbr) continue;

      normalizedCompetitors.push({
        homeAway: entry.homeAway || (i === 0 ? "home" : "away"),
        score: entry.score != null ? String(entry.score) : null,
        winner: !!entry.winner,
        team: {
          abbreviation: abbr,
          displayName: name || abbr,
          shortDisplayName: team.shortDisplayName || name || abbr,
          logo: team.logo || team.logos || null
        }
      });
    }

    if (normalizedCompetitors.length < 2) return null;

    const name = source.name || raw.name || source.shortName || raw.shortName || "Olympic Ice Hockey";
    const status = source.status || raw.status || {};

    return {
      id: source.id || raw.id || raw.uid || null,
      uid: source.uid || raw.uid || null,
      name,
      shortName: source.shortName || raw.shortName || name,
      date: source.date || source.startDate || raw.date || raw.startDate || null,
      status,
      competitions: [
        {
          id: source.id || raw.id || null,
          date: source.date || source.startDate || raw.date || raw.startDate || null,
          status,
          competitors: normalizedCompetitors
        }
      ]
    };
  },

  _dedupeEspnEvents(events) {
    const map = new Map();
    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];
      if (!event) continue;
      const key = event.id || event.uid || `${event.shortName || "evt"}-${event.date || i}`;
      if (!map.has(key)) map.set(key, event);
    }
    return Array.from(map.values());
  },

  async _fetchNbaGames() {
    try {
      const { dateIso, dateCompact } = this._getTargetDate();
      const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateCompact}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const json = await res.json();
      const events = this._collectEspnScoreboardEvents(json);

      events.sort((a, b) => {
        const dateA = this._firstDate(
          a && a.date,
          a && a.startDate,
          a && a.startTimeUTC,
          a && a.competitions && a.competitions[0] && (a.competitions[0].date || a.competitions[0].startDate || a.competitions[0].startTimeUTC)
        );
        const dateB = this._firstDate(
          b && b.date,
          b && b.startDate,
          b && b.startTimeUTC,
          b && b.competitions && b.competitions[0] && (b.competitions[0].date || b.competitions[0].startDate || b.competitions[0].startTimeUTC)
        );

        if (dateA && dateB) return dateA - dateB;
        if (dateA) return -1;
        if (dateB) return 1;
        return 0;
      });

      console.log(`🏀 Sending ${events.length} NBA games for ${dateIso} to front-end.`);
      this._notifyGames("nba", events);
    } catch (e) {
      console.error("🚨 NBA fetchGames failed:", e);
      this._notifyGames("nba", []);
    }
  },

  _collectEspnScoreboardEvents(json) {
    if (!json || typeof json !== "object") return [];
    const collected = [];

    const pushEvents = (value) => {
      if (!Array.isArray(value)) return;
      for (let i = 0; i < value.length; i += 1) {
        if (value[i]) collected.push(value[i]);
      }
    };

    pushEvents(json.events);
    pushEvents(json.games);

    if (json.content && typeof json.content === "object") {
      pushEvents(json.content.events);
      if (json.content.schedule && typeof json.content.schedule === "object") {
        pushEvents(json.content.schedule.events);
        pushEvents(json.content.schedule.items);
      }
    }

    if (json.scoreboard && typeof json.scoreboard === "object") {
      pushEvents(json.scoreboard.events);
    }

    return collected;
  },

  async _fetchNflGames() {
    try {
      const weekRange = this._getNflWeekDateRange();
      let results = await this._fetchNflWeekGames(weekRange.dateIsos);

      if (results.games.length === 0) {
        const fallbackResults = await this._fetchNflDefaultWeekGames();
        if (fallbackResults.games.length > 0) {
          console.info("ℹ️ NFL date-range fetch returned no games; using default scoreboard feed.");
          results = fallbackResults;
        }
      }

      if (this._shouldAdvanceNflPlayoffWeek(results.games)) {
        const nextWeekRange = this._getNflWeekDateRange(1);
        results = await this._fetchNflWeekGames(nextWeekRange.dateIsos);
        results.range = nextWeekRange;
      }

      const games = results.games;
      games.sort((a, b) => {
        const dateA = this._firstDate(
          a && a.date,
          a && a.startDate,
          a && a.startTimeUTC,
          a && a.competitions && a.competitions[0] && (a.competitions[0].date || a.competitions[0].startDate || a.competitions[0].startTimeUTC)
        );
        const dateB = this._firstDate(
          b && b.date,
          b && b.startDate,
          b && b.startTimeUTC,
          b && b.competitions && b.competitions[0] && (b.competitions[0].date || b.competitions[0].startDate || b.competitions[0].startTimeUTC)
        );

        if (dateA && dateB) return dateA - dateB;
        if (dateA) return -1;
        if (dateB) return 1;
        return 0;
      });

      const byeList = results.byes;
      const range = results.range || weekRange;

      const extras = { teamsOnBye: byeList };

      console.log(`🏈 Sending ${games.length} NFL games (${range.startIso} → ${range.endIso}) to front-end.${byeList.length ? ` ${byeList.length} teams on bye.` : ""}`);
      this._notifyGames("nfl", games, extras);
    } catch (e) {
      console.error("🚨 NFL fetchGames failed:", e);
      this._notifyGames("nfl", [], { teamsOnBye: [] });
    }
  },

  async _fetchNflWeekGames(dateIsos) {
    const aggregated = new Map();
    const byeTeams = new Map();

    for (let i = 0; i < dateIsos.length; i += 1) {
      const dateIso = dateIsos[i];
      const dateCompact = dateIso.replace(/-/g, "");
      const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dateCompact}`;

      try {
        const res = await fetch(url);
        const json = await res.json();
        this._mergeNflScoreboardResponse(json, aggregated, byeTeams, dateIso);
      } catch (err) {
        console.error(`🚨 NFL fetchGames failed for ${dateIso}:`, err);
      }
    }

    return this._finalizeNflWeekResults(aggregated, byeTeams);
  },

  async _fetchNflDefaultWeekGames() {
    const aggregated = new Map();
    const byeTeams = new Map();
    const url = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

    try {
      const res = await fetch(url);
      const json = await res.json();
      this._mergeNflScoreboardResponse(json, aggregated, byeTeams, "current");
    } catch (err) {
      console.error("🚨 NFL fallback scoreboard fetch failed:", err);
    }

    return this._finalizeNflWeekResults(aggregated, byeTeams);
  },

  _mergeNflScoreboardResponse(json, aggregated, byeTeams, keyPrefix) {
    if (!json || typeof json !== "object") return;
    const events = this._collectNflScoreboardEvents(json);
    const teamsOnBye = this._collectNflScoreboardByes(json);

    for (let j = 0; j < events.length; j += 1) {
      const event = events[j];
      if (!event) continue;
      const key = event.id || event.uid || `${keyPrefix || "event"}-${j}`;
      if (!aggregated.has(key)) aggregated.set(key, event);
    }

    for (let b = 0; b < teamsOnBye.length; b += 1) {
      const bye = this._normalizeNflByeTeam(teamsOnBye[b]);
      if (bye) byeTeams.set(bye.abbreviation, bye);
    }
  },

  _finalizeNflWeekResults(aggregated, byeTeams) {
    const games = Array.from(aggregated.values()).filter((game) => !this._isNflProBowl(game));
    const byeList = Array.from(byeTeams.values());
    byeList.sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));

    return {
      games,
      byes: byeList
    };
  },

  _isNflProBowl(game) {
    if (!game || typeof game !== "object") return false;
    const tokens = [];
    const pushToken = (val) => {
      if (val == null) return;
      if (typeof val === "string" || typeof val === "number") {
        const str = String(val).toLowerCase().trim();
        if (str) tokens.push(str);
      }
    };

    pushToken(game.name);
    pushToken(game.shortName);
    pushToken(game.description);
    pushToken(game.headline);

    const competitions = Array.isArray(game.competitions) ? game.competitions : [];
    for (let i = 0; i < competitions.length; i += 1) {
      const comp = competitions[i];
      if (!comp) continue;
      pushToken(comp.name);
      pushToken(comp.shortName);
      pushToken(comp.description);
      pushToken(comp.headline);

      const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
      for (let j = 0; j < competitors.length; j += 1) {
        const entry = competitors[j] || {};
        const team = entry.team || {};
        pushToken(entry.displayName);
        pushToken(entry.shortDisplayName);
        pushToken(team.displayName);
        pushToken(team.shortDisplayName);
        pushToken(team.name);
        pushToken(team.abbreviation);
      }
    }

    if (tokens.length === 0) return false;
    const combined = tokens.join(" ");
    if (combined.includes("pro bowl")) return true;
    if (combined.includes("pro-bowl")) return true;
    if (combined.includes("nfc vs afc")) return true;
    if (combined.includes("afc vs nfc")) return true;
    return false;
  },

  _shouldAdvanceNflPlayoffWeek(games) {
    if (!Array.isArray(games) || games.length === 0) return false;
    const tz = this.config && this.config.timeZone ? this.config.timeZone : "America/Chicago";
    const { dateIso, dayOfWeek, minutes, now } = this._getLocalDateParts(tz);

    if (!this._nflPlayoffRulesActive(dateIso)) return false;

    const threshold = this._nflWeekCutoffThreshold(games.length);
    if (!threshold) return false;

    const hasUpcomingGame = games.some((game) => {
      const gameDate = this._firstDate(
        game && game.date,
        game && game.startDate,
        game && game.startTimeUTC,
        game && game.competitions && game.competitions[0] && (
          game.competitions[0].date || game.competitions[0].startDate || game.competitions[0].startTimeUTC
        )
      );
      return gameDate && gameDate.getTime() > now.getTime();
    });

    if (hasUpcomingGame) return false;

    if (dayOfWeek > threshold.dayOfWeek) return true;
    return dayOfWeek === threshold.dayOfWeek && minutes >= threshold.minutes;
  },


  _firstDate(...values) {
    for (let i = 0; i < values.length; i += 1) {
      const value = values[i];
      if (!value) continue;
      const dt = new Date(value);
      if (!Number.isNaN(dt.getTime())) return dt;
    }
    return null;
  },

  _firstString(...values) {
    for (let i = 0; i < values.length; i += 1) {
      const value = values[i];
      if (value == null) continue;
      const text = String(value).trim();
      if (text) return text;
    }
    return "";
  },

  _getLeague() {
    if (Array.isArray(this.leagues) && this.leagues.length > 0) {
      return this.leagues[0];
    }
    const cfg = this.config || {};
    const source = (typeof cfg.leagues !== "undefined") ? cfg.leagues : cfg.league;
    const leagues = this._coerceLeagueArray(source);
    if (leagues.length > 0) return leagues[0];
    return "mlb";
  },

  _normalizeNflByeTeam(team) {
    if (!team) return null;

    const abbreviationSource =
      team.abbreviation || team.shortDisplayName || team.name || team.location || "";
    const abbreviation = String(abbreviationSource).trim();
    if (!abbreviation) return null;

    const normalizedAbbr = abbreviation.toUpperCase();
    const nameSource =
      team.displayName || team.name || team.shortDisplayName || team.location || normalizedAbbr;
    const displayName = String(nameSource).trim() || normalizedAbbr;

    return {
      id: team.id || team.uid || normalizedAbbr,
      abbreviation: normalizedAbbr,
      displayName,
      shortDisplayName: team.shortDisplayName || null
    };
  },

  _collectNflScoreboardEvents(json) {
    if (!json || typeof json !== "object") return [];
    const collected = [];

    const pushEvents = (value) => {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
          if (value[i]) collected.push(value[i]);
        }
      }
    };

    pushEvents(json.events);
    pushEvents(json.games);

    if (json.content && typeof json.content === "object") {
      pushEvents(json.content.events);
      if (json.content.schedule && typeof json.content.schedule === "object") {
        pushEvents(json.content.schedule.events);
        pushEvents(json.content.schedule.items);
      }
    }

    if (json.scoreboard && typeof json.scoreboard === "object") {
      pushEvents(json.scoreboard.events);
    }

    return collected;
  },

  _collectNflScoreboardByes(json) {
    if (!json || typeof json !== "object") return [];
    const candidates = [];

    const pushByes = (value) => {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
          if (value[i]) candidates.push(value[i]);
        }
      }
    };

    if (json.week && typeof json.week === "object") {
      pushByes(json.week.teamsOnBye);
    }

    if (json.content && typeof json.content === "object") {
      if (json.content.week && typeof json.content.week === "object") {
        pushByes(json.content.week.teamsOnBye);
      }
      if (json.content.schedule && typeof json.content.schedule === "object") {
        if (json.content.schedule.week && typeof json.content.schedule.week === "object") {
          pushByes(json.content.schedule.week.teamsOnBye);
        }
      }
    }

    return candidates;
  },

  _notifyGames(league, games, extras = null) {
    const normalizedLeague = this._normalizeLeagueKey(league) || this._getLeague();
    let normalizedGames;
    if (Array.isArray(games)) normalizedGames = games;
    else if (games && typeof games === "object" && Array.isArray(games.games)) {
      normalizedGames = games.games;
    } else {
      normalizedGames = [];
    }

    const payload = { league: normalizedLeague, games: normalizedGames };

    if (extras && typeof extras === "object") {
      Object.keys(extras).forEach((key) => {
        payload[key] = extras[key];
      });
    }

    this.sendSocketNotification("GAMES", payload);
  },

  _normalizeLeagueKey(value) {
    if (value == null) return null;
    const str = String(value).trim().toLowerCase();
    return SUPPORTED_LEAGUES.includes(str) ? str : null;
  },

  _coerceLeagueArray(input) {
    const tokens = [];
    const collect = (entry) => {
      if (entry == null) return;
      if (Array.isArray(entry)) {
        for (let i = 0; i < entry.length; i += 1) collect(entry[i]);
        return;
      }
      const str = String(entry).trim();
      if (!str) return;
      const parts = str.split(/[\s,]+/);
      for (let j = 0; j < parts.length; j += 1) {
        const part = parts[j].trim();
        if (part) tokens.push(part);
      }
    };

    collect(input);

    const normalized = [];
    const seen = new Set();
    for (let k = 0; k < tokens.length; k += 1) {
      const token = tokens[k];
      const lower = token.toLowerCase();
      if (lower === "all") {
        return SUPPORTED_LEAGUES.slice();
      }
      if (SUPPORTED_LEAGUES.includes(lower) && !seen.has(lower)) {
        normalized.push(lower);
        seen.add(lower);
      }
    }
    return normalized;
  },

  _resolveConfiguredLeagues() {
    const cfg = this.config || {};
    const source = (typeof cfg.leagues !== "undefined") ? cfg.leagues : cfg.league;
    const leagues = this._coerceLeagueArray(source);
    return Array.isArray(leagues) ? leagues : [];
  },

  _getTargetDate(options) {
    const opts = options && typeof options === "object" ? options : {};
    const usePreviousDayEarly = opts.usePreviousDayEarly !== false;
    const tz = this.config && this.config.timeZone ? this.config.timeZone : "America/Chicago";
    const now = new Date();
    let dateIso = now.toLocaleDateString("en-CA", { timeZone: tz });
    const timeCT  = now.toLocaleTimeString("en-GB", {
      timeZone: tz,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit"
    });
    const [hStr, mStr] = timeCT.split(":");
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);

    // Before 9:30 AM local time, show yesterday's schedule (catch late finishes)
    if (usePreviousDayEarly && (h < 9 || (h === 9 && m < 30))) {
      const dt = new Date(dateIso);
      dt.setDate(dt.getDate() - 1);
      dateIso = dt.toISOString().slice(0, 10);
    }

    return {
      dateIso,
      dateCompact: dateIso.replace(/-/g, "")
    };
  },

  _getNhlScoreboardDate() {
    const tz = this.config && this.config.timeZone ? this.config.timeZone : "America/Chicago";
    const now = new Date();
    let dateIso = now.toLocaleDateString("en-CA", { timeZone: tz });
    const timeStr = now.toLocaleTimeString("en-GB", {
      timeZone: tz,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit"
    });
    const [hStr, mStr] = timeStr.split(":");
    const hour = parseInt(hStr, 10);
    const minute = parseInt(mStr, 10);

    if (hour < 9 || (hour === 9 && minute < 30)) {
      const dt = new Date(dateIso);
      dt.setDate(dt.getDate() - 1);
      dateIso = dt.toISOString().slice(0, 10);
    }

    return dateIso;
  },

  _getLocalDateParts(tz) {
    const now = new Date();
    const dateIso = now.toLocaleDateString("en-CA", { timeZone: tz });
    const timeStr = now.toLocaleTimeString("en-GB", {
      timeZone: tz,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit"
    });
    const [hStr, mStr] = timeStr.split(":");
    const hour = parseInt(hStr, 10);
    const minute = parseInt(mStr, 10);
    const minutes = (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
    const localMidnight = new Date(`${dateIso}T00:00:00Z`);
    const dayOfWeek = localMidnight.getUTCDay();

    return {
      now,
      dateIso,
      dayOfWeek,
      minutes
    };
  },

  _nflWeekStartForDate(dateIso) {
    const localMidnight = new Date(`${dateIso}T00:00:00Z`);
    const dayOfWeek = localMidnight.getUTCDay();
    const offset = (dayOfWeek - 4 + 7) % 7; // 4 === Thursday
    const weekStart = new Date(localMidnight);
    weekStart.setUTCDate(weekStart.getUTCDate() - offset);
    return weekStart;
  },

  _nflWeekDatesFromStart(weekStart) {
    const dateIsos = [];
    const cursor = new Date(weekStart);
    for (let i = 0; i < 5; i += 1) {
      dateIsos.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dateIsos;
  },

  _nflRegularWeekStart(dateIso, dayOfWeek, minutes) {
    const weekStart = this._nflWeekStartForDate(dateIso);
    if (dayOfWeek === 3 && minutes >= (9 * 60)) {
      weekStart.setUTCDate(weekStart.getUTCDate() + 7);
    }
    return weekStart;
  },

  _nflPlayoffRulesActive(dateIso) {
    const [, monthStr] = String(dateIso || "").split("-");
    const month = parseInt(monthStr, 10);
    return month === 1 || month === 2;
  },

  _nflWeekCutoffThreshold(gameCount) {
    if (gameCount === 6) {
      return { dayOfWeek: 2, minutes: 15 * 60 }; // Tuesday 3:00 PM
    }
    if (gameCount === 4 || gameCount === 2) {
      return { dayOfWeek: 1, minutes: (15 * 60) + 15 }; // Monday 3:15 PM
    }
    return null;
  },

  _getNflWeekDateRange(weekOffset = 0) {
    const tz = this.config && this.config.timeZone ? this.config.timeZone : "America/Chicago";
    const { dateIso, dayOfWeek, minutes } = this._getLocalDateParts(tz);
    let weekStart = this._nflRegularWeekStart(dateIso, dayOfWeek, minutes);

    if (Number.isFinite(weekOffset) && weekOffset !== 0) {
      weekStart.setUTCDate(weekStart.getUTCDate() + (weekOffset * 7));
    }

    const dateIsos = this._nflWeekDatesFromStart(weekStart);

    return {
      startIso: weekStart.toISOString().slice(0, 10),
      endIso: dateIsos[dateIsos.length - 1],
      dateIsos
    };
  }
});

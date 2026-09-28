const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// node_helper.js binds `fetch` to global.fetch at require time, so the stub
// must be installed before requiring it (see test/mlb-partial-feed-failure.test.js).
let currentFetchImpl = () => {
  throw new Error('no fetch impl installed for this test');
};
global.fetch = (...args) => currentFetchImpl(...args);

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'node_helper') {
    return { create(definition) { return definition; } };
  }
  return originalLoad.apply(this, arguments);
};

let helperDefinition;
try {
  helperDefinition = require('../node_helper');
} finally {
  Module._load = originalLoad;
}

function jsonResponse(body) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body, text: async () => JSON.stringify(body) };
}

function createHelper() {
  return Object.assign(Object.create(helperDefinition), {
    config: { timeZone: 'America/Chicago' },
    sent: [],
    sendSocketNotification(notification, payload) {
      this.sent.push({ notification, payload });
    }
  });
}

test('_fetchLeagueGames routes each *_playoffs league to its own fetcher', async () => {
  const helper = createHelper();

  currentFetchImpl = async (url) => {
    if (url.includes('/schedule?') || url.includes('/schedule/postseason/series')) return jsonResponse({ dates: [] });
    if (url.includes('standings')) return jsonResponse({ records: [] });
    throw new Error('unexpected url: ' + url);
  };
  await helper._fetchMlbPlayoffs();
  assert.equal(helper.sent[helper.sent.length - 1].payload.league, 'mlb_playoffs');
  assert.equal(helper.sent[helper.sent.length - 1].payload.errorMessage, 'MLB postseason fetch failed: no data');

  currentFetchImpl = async () => { throw new Error('nhl down'); };
  await helper._fetchNhlPlayoffsScreen();
  const nhlPayload = helper.sent[helper.sent.length - 1].payload;
  assert.equal(nhlPayload.league, 'nhl_playoffs');
  assert.ok(nhlPayload.errorMessage);

  currentFetchImpl = async () => { throw new Error('nba down'); };
  await helper._fetchNbaPlayoffsScreen();
  const nbaPayload = helper.sent[helper.sent.length - 1].payload;
  assert.equal(nbaPayload.league, 'nba_playoffs');
  assert.ok(nbaPayload.errorMessage);
});

test('a successful playoff fetch is delivered as extras.playoffs with an empty games array', async () => {
  const helper = createHelper();
  const game = (gamePk, seriesGameNumber, gameDate, homeWins) => ({
    gamePk, gameType: 'F', seriesGameNumber, gamesInSeries: 3, gameDate,
    status: { abstractGameState: 'Final', detailedState: 'Final' },
    teams: {
      home: { team: { id: 110, name: 'Baltimore Orioles', abbreviation: 'BAL', league: { id: 103 } }, isWinner: homeWins, score: homeWins ? 5 : 1 },
      away: { team: { id: 118, name: 'Kansas City Royals', abbreviation: 'KC', league: { id: 103 } }, isWinner: !homeWins, score: homeWins ? 1 : 5 }
    }
  });
  currentFetchImpl = async (url) => {
    if (url.includes('/schedule?')) {
      return jsonResponse({ dates: [{ games: [
        game(1, 1, '2024-10-01T23:00:00Z', false),
        game(2, 2, '2024-10-02T23:00:00Z', false)
      ] }] });
    }
    return jsonResponse({ records: [] });
  };

  await helper._fetchMlbPlayoffs();
  const payload = helper.sent[helper.sent.length - 1].payload;
  assert.equal(payload.league, 'mlb_playoffs');
  assert.deepEqual(payload.games, []);
  assert.ok(payload.playoffs);
  assert.equal(payload.playoffs.series.length, 1);
  assert.equal(payload.playoffs.series[0].winner, 'KC');
});

test('_getCachedPlayoffData reuses cached data within the TTL instead of refetching', async () => {
  const helper = createHelper();
  let calls = 0;
  const fetchFn = async () => { calls += 1; return { series: [{ live: false }] }; };

  const first = await helper._getCachedPlayoffData('mlb_playoffs', fetchFn);
  const second = await helper._getCachedPlayoffData('mlb_playoffs', fetchFn);

  assert.equal(calls, 1);
  assert.strictEqual(first, second);
});

test('_getCachedPlayoffData refetches sooner (30s) while any series is live', async () => {
  const helper = createHelper();
  helper._playoffCache = {
    mlb_playoffs: { data: { series: [{ live: true }] }, fetchedAt: Date.now() - 45 * 1000 }
  };
  let calls = 0;
  const fetchFn = async () => { calls += 1; return { series: [{ live: false }] }; };

  await helper._getCachedPlayoffData('mlb_playoffs', fetchFn);
  assert.equal(calls, 1, 'a 45s-old live-series cache entry should be treated as stale (30s TTL)');
});

test('_getCachedPlayoffData keeps a non-live cache entry for up to 120s', async () => {
  const helper = createHelper();
  helper._playoffCache = {
    mlb_playoffs: { data: { series: [{ live: false }] }, fetchedAt: Date.now() - 60 * 1000 }
  };
  let calls = 0;
  const fetchFn = async () => { calls += 1; return { series: [] }; };

  await helper._getCachedPlayoffData('mlb_playoffs', fetchFn);
  assert.equal(calls, 0, 'a 60s-old non-live cache entry is still within the 120s TTL');
});

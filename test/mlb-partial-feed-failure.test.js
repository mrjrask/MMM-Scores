const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// node_helper.js binds `fetch` to global.fetch at require time, so the stub
// must be installed before requiring it, and stay in place for the life of
// the process (tests swap the delegate, not global.fetch itself).
let currentFetchImpl = () => {
  throw new Error('no fetch impl installed for this test');
};
global.fetch = (...args) => currentFetchImpl(...args);

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'node_helper') {
    return {
      create(definition) {
        return definition;
      }
    };
  }
  return originalLoad.apply(this, arguments);
};

let helperDefinition;
try {
  helperDefinition = require('../node_helper');
} finally {
  Module._load = originalLoad;
}

function createHelper() {
  return Object.assign(Object.create(helperDefinition), {
    config: { timeZone: 'America/Chicago' },
    sent: [],
    _lastGoodByLeague: {},
    sendSocketNotification(notification, payload) {
      this.sent.push({ notification, payload });
    }
  });
}

const sampleFinalGame = {
  gamePk: 111111,
  gameDate: '2026-07-29T23:10:00Z',
  status: { abstractGameState: 'Final', detailedState: 'Final', codedGameState: 'F' },
  teams: {
    away: { score: 3, team: { id: 112, name: 'Chicago Cubs' } },
    home: { score: 5, team: { id: 158, name: 'Milwaukee Brewers' } }
  },
  linescore: {
    currentInning: 9,
    currentInningOrdinal: '9th',
    inningState: 'Top',
    scheduledInnings: 9,
    innings: [],
    teams: { away: { runs: 3, hits: 7, errors: 1 }, home: { runs: 5, hits: 9, errors: 0 } }
  }
};

test('a failing international/WBC sportId does not wipe out a successful primary MLB fetch', async () => {
  const helper = createHelper();

  currentFetchImpl = async (url) => {
    if (url.includes('sportId=51')) {
      return { ok: false, status: 503, statusText: 'Service Unavailable', headers: {}, text: async () => '', json: async () => ({}) };
    }
    const body = JSON.stringify({ dates: [{ date: '2026-07-30', games: [sampleFinalGame] }] });
    return { ok: true, status: 200, statusText: 'OK', headers: {}, text: async () => body, json: async () => JSON.parse(body) };
  };

  await helper._fetchMlbGames();

  const mlbNotification = helper.sent.find((s) => s.payload.league === 'mlb');
  assert.ok(mlbNotification, 'expected an mlb GAMES notification');
  assert.equal(mlbNotification.payload.games.length, 1);
  assert.equal(mlbNotification.payload.games[0].gamePk, 111111);
  assert.equal(mlbNotification.payload.isStale, undefined);
  assert.equal(mlbNotification.payload.errorMessage, undefined);
});

test('a failing primary MLB sportId still surfaces as an error/fallback', async () => {
  const helper = createHelper();

  currentFetchImpl = async (url) => {
    if (url.includes('sportId=1&')) {
      return { ok: false, status: 500, statusText: 'Internal Server Error', headers: {}, text: async () => '', json: async () => ({}) };
    }
    const body = JSON.stringify({ dates: [] });
    return { ok: true, status: 200, statusText: 'OK', headers: {}, text: async () => body, json: async () => JSON.parse(body) };
  };

  await helper._fetchMlbGames();

  const mlbNotification = helper.sent.find((s) => s.payload.league === 'mlb');
  assert.ok(mlbNotification, 'expected an mlb GAMES notification');
  assert.equal(mlbNotification.payload.games.length, 0);
  assert.match(mlbNotification.payload.errorMessage, /sportId=1/);
});

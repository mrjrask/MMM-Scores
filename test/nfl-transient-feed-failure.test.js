const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'node_helper') {
    return { create: (definition) => definition };
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
    config: { lastGoodCacheMs: 60_000 },
    sent: [],
    _lastGoodByLeague: {},
    _getScoreboardDateContext: () => ({ beforeUpdateCutoff: false }),
    _getNflWeekDateRange: () => ({
      startIso: '2026-09-03',
      endIso: '2026-09-07',
      dateIsos: ['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07']
    }),
    _shouldAdvanceNflPlayoffWeek: () => false,
    sendSocketNotification(notification, payload) {
      this.sent.push({ notification, payload });
    }
  });
}

test('NFL transient request failures reuse the last complete scoreboard', async () => {
  const helper = createHelper();
  const game = { id: 'nfl-game-1', date: '2026-09-06T17:00:00Z' };

  helper._fetchJson = async (url) => url.includes('dates=20260906') ? { events: [game] } : { events: [] };
  await helper._fetchNflGames();
  assert.deepEqual(helper.sent[0].payload.games, [game]);
  assert.equal(helper.sent[0].payload.isStale, undefined);

  helper._fetchJson = async () => { throw new Error('temporary ESPN outage'); };
  await helper._fetchNflGames();

  assert.equal(helper.sent.length, 2);
  assert.deepEqual(helper.sent[1].payload.games, [game]);
  assert.equal(helper.sent[1].payload.isStale, true);
  assert.equal(helper.sent[1].payload.fallbackUsed, true);
  assert.match(helper.sent[1].payload.staleReason, /temporary ESPN outage/);
});

test('NFL partial date results are replaced by a successful whole-week response', async () => {
  const helper = createHelper();
  const partialGame = { id: 'partial-game', date: '2026-09-03T17:00:00Z' };
  const completeGames = [
    partialGame,
    { id: 'sunday-game', date: '2026-09-06T17:00:00Z' }
  ];

  helper._fetchJson = async (url) => {
    if (!url.includes('dates=')) return { events: completeGames };
    if (url.includes('dates=20260904')) throw new Error('one date failed');
    return url.includes('dates=20260903') ? { events: [partialGame] } : { events: [] };
  };

  await helper._fetchNflGames();

  assert.deepEqual(helper.sent[0].payload.games, completeGames);
  assert.equal(helper.sent[0].payload.isStale, undefined);
});

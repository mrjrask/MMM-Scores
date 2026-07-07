const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
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
    config: {},
    sent: [],
    sendSocketNotification(notification, payload) {
      this.sent.push({ notification, payload });
    }
  });
}

test('_notifyGames does not save error payloads as last good cache entries', () => {
  const helper = createHelper();

  helper._notifyGames('nfl', [], { errorMessage: 'provider unavailable' });

  assert.equal(helper.sent.length, 1);
  assert.equal(helper.sent[0].notification, 'GAMES');
  assert.deepEqual(helper.sent[0].payload.games, []);
  assert.equal(helper.sent[0].payload.errorMessage, 'provider unavailable');
  assert.equal(helper._lastGoodByLeague, undefined);
});

test('_notifyGamesWithFallback without usable cache emits error without creating fallback cache', () => {
  const helper = createHelper();
  helper.config = { lastGoodCacheMs: 60_000 };

  helper._notifyGamesWithFallback('nfl', [], { errorMessage: 'provider unavailable' });
  helper._notifyGamesWithFallback('nfl', [], { errorMessage: 'still unavailable' });

  assert.equal(helper.sent.length, 2);
  assert.equal(helper.sent[0].payload.isStale, undefined);
  assert.equal(helper.sent[0].payload.fallbackUsed, undefined);
  assert.equal(helper.sent[1].payload.isStale, undefined);
  assert.equal(helper.sent[1].payload.fallbackUsed, undefined);
  assert.equal(helper._lastGoodByLeague, undefined);
});

test('_notifyGames caches successful responses for subsequent fallback use', () => {
  const helper = createHelper();
  helper.config = { lastGoodCacheMs: 60_000 };

  helper._notifyGames('nfl', [{ id: 'game-1' }]);
  helper._notifyGamesWithFallback('nfl', [], { errorMessage: 'provider unavailable' });

  assert.equal(helper.sent.length, 2);
  assert.deepEqual(helper.sent[1].payload.games, [{ id: 'game-1' }]);
  assert.equal(helper.sent[1].payload.isStale, true);
  assert.equal(helper.sent[1].payload.fallbackUsed, true);
  assert.equal(helper.sent[1].payload.staleReason, 'provider unavailable');
});

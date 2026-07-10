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
  return Object.assign(Object.create(helperDefinition), { config: {} });
}

function event(id, date, state = 'pre', name) {
  const completed = state === 'post';
  return {
    id,
    name: name || id,
    date,
    competitions: [{ date }],
    status: {
      abstractGameState: completed ? 'Final' : (state === 'in' ? 'Live' : 'Preview'),
      type: { state, completed }
    }
  };
}

test('World Cup quarterfinal round puts the next unfinished game first and finals last', () => {
  const helper = createHelper();
  const ordered = helper._orderWorldCupFinalRoundEvents([
    event('completed-early', '2026-07-08T19:00:00Z', 'post'),
    event('next', '2026-07-10T19:00:00Z', 'pre'),
    event('later', '2026-07-11T19:00:00Z', 'pre'),
    event('completed-late', '2026-07-09T19:00:00Z', 'post')
  ], { key: 'quarterfinals' });

  assert.deepEqual(ordered.map((game) => game.id), [
    'next',
    'later',
    'completed-early',
    'completed-late'
  ]);
});

test('World Cup finals round orders third-place and championship games by schedule until completed', () => {
  const helper = createHelper();
  const ordered = helper._orderWorldCupFinalRoundEvents([
    event('championship', '2026-07-19T19:00:00Z', 'pre'),
    event('third-place', '2026-07-18T19:00:00Z', 'pre')
  ], { key: 'finals' });

  assert.deepEqual(ordered.map((game) => game.id), ['third-place', 'championship']);
});

test('World Cup completed finals keep championship above third-place game', () => {
  const helper = createHelper();
  const ordered = helper._orderWorldCupFinalRoundEvents([
    event('third-place', '2026-07-18T19:00:00Z', 'post', 'Third Place'),
    event('championship', '2026-07-19T19:00:00Z', 'post', 'Final')
  ], { key: 'finals' });

  assert.deepEqual(ordered.map((game) => game.id), ['championship', 'third-place']);
});

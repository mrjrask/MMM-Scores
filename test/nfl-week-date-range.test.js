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

function createHelper(dateIso, dayOfWeek, minutes) {
  return Object.assign(Object.create(helperDefinition), {
    config: { timeZone: 'America/Chicago' },
    _getLocalDateParts: () => ({ dateIso, dayOfWeek, minutes })
  });
}

test('NFL week fetches every date from Wednesday through Monday', () => {
  const helper = createHelper('2026-09-10', 4, 12 * 60);

  assert.deepEqual(helper._getNflWeekDateRange(), {
    startIso: '2026-09-09',
    endIso: '2026-09-14',
    dateIsos: [
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14'
    ]
  });
});

test('NFL week rolls over at 09:00 Wednesday', () => {
  const beforeRollover = createHelper('2026-09-09', 3, (8 * 60) + 59);
  const atRollover = createHelper('2026-09-09', 3, 9 * 60);

  assert.equal(beforeRollover._getNflWeekDateRange().startIso, '2026-09-02');
  assert.equal(beforeRollover._getNflWeekDateRange().endIso, '2026-09-07');
  assert.equal(atRollover._getNflWeekDateRange().startIso, '2026-09-09');
  assert.equal(atRollover._getNflWeekDateRange().endIso, '2026-09-14');
});

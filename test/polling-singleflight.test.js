const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('score fetches do not overlap when a provider is slow', async () => {
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'node_helper') return { create: (definition) => definition };
    if (request === 'cheerio') return {};
    return originalLoad.call(this, request, parent, isMain);
  };
  let helper;
  try {
    helper = require('../node_helper.js');
  } finally {
    Module._load = originalLoad;
  }
  helper.leagues = ['mlb'];
  let calls = 0;
  let finish;
  helper._fetchLeagueGames = () => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  };
  const first = helper._fetchGames();
  await helper._fetchGames();
  assert.equal(calls, 1);
  finish();
  await first;
  const next = helper._fetchGames();
  assert.equal(calls, 2);
  finish();
  await next;
});

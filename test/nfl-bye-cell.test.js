const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dom = require('./helpers/simple-dom');

function loadDefinition() {
  let definition;
  const source = fs.readFileSync(path.join(__dirname, '..', 'MMM-Scores.js'), 'utf8');
  const sandbox = {
    Module: { register(_n, d) { definition = d; } },
    document: { createElement: dom.createElement, createElementNS: dom.createElementNS },
    window: {},
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'MMM-Scores.js' });
  return definition;
}

test('NFL bye teams become one extra cell after the games', () => {
  const def = loadDefinition();
  const inst = Object.assign(Object.create(def), {
    games: [{ id: 1 }],
    currentExtras: { teamsOnBye: [{ abbreviation: 'kc' }, { abbreviation: 'DAL' }, { abbreviation: 'KC' }] },
    _getLeague() { return 'nfl'; }
  });
  const games = inst._scoreboardGames();
  assert.equal(games.length, 2);
  assert.equal(games[1].nflByeCell, true);
  assert.deepEqual(games[1].teams, ['DAL', 'KC']);

  inst.currentExtras = { teamsOnBye: [] };
  assert.equal(inst._scoreboardGames().length, 1);
});

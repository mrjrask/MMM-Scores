const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dom = require('./helpers/simple-dom');

function loadModuleDefinition() {
  let definition;
  const source = fs.readFileSync(path.join(__dirname, '..', 'MMM-Scores.js'), 'utf8');
  const sandbox = {
    Module: { register(_name, moduleDefinition) { definition = moduleDefinition; } },
    document: { createElement: dom.createElement, createElementNS: dom.createElementNS },
    window: {},
    console
  };
  sandbox.window.MmmScoresPlayoffBracket = require('../playoff-bracket-shared');
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'MMM-Scores.js' });
  return definition;
}

function createInstance(definition, overrides) {
  return Object.assign(Object.create(definition), {
    config: { timeZone: 'America/Chicago' },
    file(p) { return p; }
  }, overrides);
}

function findAllExact(root, className) {
  return dom.findAll(root, (n) => n.className === className);
}

const mlbFixture = {
  season: 2024,
  seeds: { AL: { NYY: 1, CLE: 2, HOU: 3, BAL: 4, KC: 5, DET: 6 }, NL: { PHI: 1, LAD: 2, MIL: 3, SD: 4, ATL: 5, NYM: 6 } },
  names: { NYY: 'Yankees', KC: 'Royals', BAL: 'Orioles' },
  series: [
    { round: 'F', league: 'AL', best_of: 3, teams: ['BAL', 'KC'], wins: { BAL: 0, KC: 2 }, live: false, next_start: null, winner: 'KC' },
    { round: 'F', league: 'AL', best_of: 3, teams: ['HOU', 'DET'], wins: { HOU: 1, DET: 1 }, live: true, next_start: null, winner: null }
  ]
};

test('a playoff league produces a header, bracket, and series list with the right slot/row counts', () => {
  const definition = loadModuleDefinition();
  const instance = createInstance(definition, { currentExtras: { playoffs: mlbFixture } });

  const screen = instance._buildPlayoffScreen('mlb_playoffs');
  assert.equal(screen.className, 'playoff-screen playoff-screen-mlb');
  // .playoff-screen is a CSS size container (no intrinsic width), so it needs an
  // explicit width or it collapses to 0px in MagicMirror's content-sized regions.
  assert.equal(screen.style.width, 'min(800px, 100vw)');
  assert.deepEqual(screen.children.map((c) => c.className), ['playoff-header', 'playoff-bracket', 'playoff-series-list']);

  // 2 WC + 2 DS + 1 LCS + 1 WS + 1 LCS + 2 DS + 2 WC = 11 slot boxes.
  assert.equal(findAllExact(screen, 'playoff-slot').length, 11);
  // 2 real AL series + 2 seed-derived NL placeholders.
  assert.equal(findAllExact(screen, 'playoff-series-row').length, 4);
});

test('no playoff data yields just the header plus a "No postseason data" message', () => {
  const definition = loadModuleDefinition();
  const instance = createInstance(definition, { currentExtras: null });

  const screen = instance._buildPlayoffScreen('nhl_playoffs');
  assert.deepEqual(screen.children.map((c) => c.className), ['playoff-header', 'playoff-no-data']);
  assert.equal(screen.children[1].innerText, 'No postseason data');
});

function baseClasses(node) {
  // Strips modifier classes (e.g. "playoff-dim-logo") so structural order
  // assertions aren't coupled to win/loss dimming.
  return node.className.split(' ')[0];
}

test('series list team layout: seed sits outermost, wins sit against the dash (spec §7.3)', () => {
  const definition = loadModuleDefinition();
  const instance = createInstance(definition, { currentExtras: { playoffs: mlbFixture } });

  const screen = instance._buildPlayoffScreen('mlb_playoffs');
  const seriesRows = findAllExact(screen, 'playoff-series-row');
  const decidedRow = seriesRows[0]; // BAL(4) 0 - 2 KC(5), KC won; BAL is the loser

  const topTeam = decidedRow.children[0].children[0]; // playoff-series-team-top
  const bottomTeam = decidedRow.children[0].children[2]; // playoff-series-team-bottom

  // Top (left) team: seed, logo, wins - wins sits against the dash.
  assert.deepEqual(topTeam.children.map(baseClasses), ['playoff-seed', 'playoff-series-logo', 'playoff-series-wins']);
  assert.equal(topTeam.children[0].innerText, '(4)');
  assert.equal(topTeam.children[2].innerText, 0);
  assert.ok(topTeam.children[1].className.includes('playoff-dim-logo'), 'BAL lost, so its logo should be dimmed');

  // Bottom (right) team: wins, logo, seed - the mirror image.
  assert.deepEqual(bottomTeam.children.map(baseClasses), ['playoff-series-wins', 'playoff-series-logo', 'playoff-seed']);
  assert.equal(bottomTeam.children[2].innerText, '(5)');
  assert.equal(bottomTeam.children[0].innerText, 2);
  assert.ok(!bottomTeam.children[1].className.includes('playoff-dim-logo'), 'KC won, so its logo should not be dimmed');
});

test('bracket slot rows order seed, logo, then right-aligned wins', () => {
  const definition = loadModuleDefinition();
  const instance = createInstance(definition, { currentExtras: { playoffs: mlbFixture } });

  const screen = instance._buildPlayoffScreen('mlb_playoffs');
  const slotRows = dom.findAll(screen, (n) => baseClasses(n) === 'playoff-slot-row');
  const balKcRow = slotRows.find((r) => r.children.some((c) => c.innerText === '(4)'));

  assert.deepEqual(balKcRow.children.map(baseClasses), ['playoff-seed', 'playoff-slot-logo', 'playoff-slot-wins']);
});

test('a decided slot dims the loser’s row and logo', () => {
  const definition = loadModuleDefinition();
  const decidedFixture = {
    seeds: { AL: {}, NL: {} },
    names: {},
    series: [{ round: 'F', league: 'AL', best_of: 3, teams: ['BAL', 'KC'], wins: { BAL: 0, KC: 2 }, live: false, winner: 'KC' }]
  };
  const instance = createInstance(definition, { currentExtras: { playoffs: decidedFixture } });

  const screen = instance._buildPlayoffScreen('mlb_playoffs');
  const dimmedRows = dom.findAll(screen, (n) => n.className.split(' ').includes('playoff-dim') && n.className.includes('playoff-slot-row'));
  assert.equal(dimmedRows.length, 1);
  const dimmedLogo = dimmedRows[0].children.find((c) => c.className && c.className.includes('playoff-slot-logo'));
  assert.ok(dimmedLogo.className.includes('playoff-dim-logo'));
});

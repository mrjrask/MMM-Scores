const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createModuleDefinition() {
  let definition;
  const source = fs.readFileSync(path.join(__dirname, '..', 'MMM-Scores.js'), 'utf8');
  const context = {
    Module: {
      register(_name, moduleDefinition) {
        definition = moduleDefinition;
      }
    }
  };

  vm.runInNewContext(source, context, { filename: 'MMM-Scores.js' });
  return definition;
}

function createModuleInstance(overrides = {}) {
  const definition = createModuleDefinition();
  return Object.assign(Object.create(definition), {
    config: Object.assign({}, definition.defaults, overrides.config || {}),
    gamesByLeague: overrides.gamesByLeague || {},
    scheduleGamesByLeague: overrides.scheduleGamesByLeague || {},
    loadedLeagues: { nba: true },
    extrasByLeague: {},
    _leagueRotation: ['nba'],
    _activeLeagueIndex: 0,
    currentScreen: overrides.currentScreen || 0,
    totalGamePages: 1,
    _scoreboardPageCount: 0,
    _layoutScale: 1
  });
}

test('next-day schedule games are counted across all scoreboard pages', () => {
  const scheduleGames = Array.from({ length: 17 }, (_, index) => ({ id: `schedule-${index}` }));
  const instance = createModuleInstance({
    config: { scoreboardColumns: 4, gamesPerColumn: 4 },
    gamesByLeague: { nba: [] },
    scheduleGamesByLeague: { nba: scheduleGames }
  });

  instance._applyActiveLeagueState();

  assert.equal(instance._gamesPerPage, 16);
  assert.equal(instance._scoreboardPageCount, 0);
  assert.equal(instance.totalGamePages, 2);
});

test('schedule pagination is added after current scoreboard pages', () => {
  const scoreGames = Array.from({ length: 17 }, (_, index) => ({ id: `score-${index}` }));
  const scheduleGames = Array.from({ length: 33 }, (_, index) => ({ id: `schedule-${index}` }));
  const instance = createModuleInstance({
    config: { scoreboardColumns: 4, gamesPerColumn: 4 },
    gamesByLeague: { nba: scoreGames },
    scheduleGamesByLeague: { nba: scheduleGames }
  });

  instance._applyActiveLeagueState();

  assert.equal(instance._gamesPerPage, 16);
  assert.equal(instance._scoreboardPageCount, 2);
  assert.equal(instance.totalGamePages, 5);
});

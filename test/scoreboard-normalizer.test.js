const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeEspnNbaEvent, normalizeEspnNbaEvents } = require('../scoreboard-normalizer');

function espnEvent(overrides = {}) {
  const status = overrides.status || { type: { state: 'in', completed: false, shortDetail: '5:32 - 2nd' }, period: 2, displayClock: '5:32' };
  return {
    id: '401',
    date: '2026-10-20T00:30Z',
    season: { type: 2, slug: 'regular-season' },
    competitions: [{
      id: '401',
      date: '2026-10-20T00:30Z',
      status,
      competitors: [
        { homeAway: 'home', score: '55', team: { id: '4', abbreviation: 'chi', location: 'Chicago', name: 'Bulls' } },
        { homeAway: 'away', score: '60', team: { id: '2', abbreviation: 'bos', displayName: 'Boston Celtics' } }
      ]
    }]
  };
}

test('live ESPN NBA event maps to the desk_display game contract', () => {
  const game = normalizeEspnNbaEvent(espnEvent());
  assert.equal(game.gamePk, '401');
  assert.equal(game.gameDate, '2026-10-20T00:30Z');
  assert.deepEqual(game.status, { statusCode: '2', detailedState: '5:32 - 2nd', abstractGameState: 'live' });
  assert.equal(game.teams.home.team.abbreviation, 'CHI');
  assert.equal(game.teams.home.team.name, 'Chicago Bulls');
  assert.equal(game.teams.away.team.name, 'Boston Celtics');
  assert.equal(game.teams.away.score, '60');
  assert.equal(game.linescore.currentPeriod, 2);
  assert.equal(game.linescore.currentPeriodTimeRemaining, '5:32');
  assert.equal(game.seasonStage, 'regular-season');
});

test('final and preview events get final/preview abstract states', () => {
  const final = normalizeEspnNbaEvent(espnEvent({ status: { type: { state: 'post', completed: true, shortDetail: 'Final/OT' }, period: 5 } }));
  assert.equal(final.status.abstractGameState, 'final');
  assert.equal(final.status.statusCode, '3');
  assert.equal(final.status.detailedState, 'Final/OT');

  const preview = normalizeEspnNbaEvent(espnEvent({ status: { type: { state: 'pre', completed: false, shortDetail: '7:30 PM' } } }));
  assert.equal(preview.status.abstractGameState, 'preview');
  assert.equal(preview.status.statusCode, '1');
  assert.equal(preview.linescore, undefined);
});

test('missing score falls back to the sum of linescores', () => {
  const event = espnEvent();
  const home = event.competitions[0].competitors[0];
  delete home.score;
  home.linescores = [{ value: 25 }, { value: 30 }];
  assert.equal(normalizeEspnNbaEvent(event).teams.home.score, 55);
});

test('non-object events are dropped', () => {
  assert.deepEqual(normalizeEspnNbaEvents([null, espnEvent()]).length, 1);
  assert.deepEqual(normalizeEspnNbaEvents(undefined), []);
});

test('NBA card renders from the normalized contract', () => {
  let definition;
  const source = fs.readFileSync(path.join(__dirname, '..', 'MMM-Scores.js'), 'utf8');
  vm.runInNewContext(source, { Module: { register(_n, d) { definition = d; } } }, { filename: 'MMM-Scores.js' });
  let card;
  const inst = Object.assign(Object.create(definition), {
    config: Object.assign({}, definition.defaults),
    _createScoreboardCard(opts) { card = opts; return opts; }
  });
  inst._isHighlighted = () => false;
  inst._createNbaGameCard(normalizeEspnNbaEvent(espnEvent()));
  assert.equal(card.live, true);
  assert.equal(card.statusText, 'Q2 5:32');
  assert.equal(JSON.stringify(card.rows.map((r) => [r.abbr, r.total])), JSON.stringify([['BOS', 60], ['CHI', 55]]));

  inst._createNbaGameCard(normalizeEspnNbaEvent(espnEvent({ status: { type: { state: 'post', completed: true, shortDetail: 'Final' }, period: 4 } })));
  assert.equal(card.statusText, 'Final');
  assert.equal(card.rows[0].isLoser, false);
  assert.equal(card.rows[1].isLoser, true);
});

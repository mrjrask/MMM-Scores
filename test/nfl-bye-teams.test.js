const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'node_helper') return { create: (definition) => definition };
  return originalLoad.apply(this, arguments);
};
let helper;
try {
  helper = require('../node_helper');
} finally {
  Module._load = originalLoad;
}

const ALL = ['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC',
  'LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WSH'];

function week(teams, seasonType) {
  const games = [];
  for (let i = 0; i < teams.length; i += 2) {
    games.push({
      season: seasonType ? { type: seasonType } : undefined,
      competitions: [{ competitors: teams.slice(i, i + 2).map((abbreviation) => ({ team: { abbreviation } })) }]
    });
  }
  return games;
}

const abbrs = (list) => list.map((t) => t.abbreviation);

test('bye teams are the teams missing from the week schedule', () => {
  const playing = ALL.filter((t) => !['DAL', 'KC', 'WSH'].includes(t));
  assert.deepEqual(abbrs(helper._computeNflByeTeams(week(playing, 2))), ['DAL', 'KC', 'WSH']);
  // ESPN's WAS alias counts as WSH playing.
  const aliased = ALL.filter((t) => t !== 'DAL').map((t) => (t === 'WSH' ? 'WAS' : t));
  assert.deepEqual(abbrs(helper._computeNflByeTeams(week(aliased))), ['DAL']);
  assert.deepEqual(helper._computeNflByeTeams(week(ALL)), []);
});

test('no bye teams in the playoffs, preseason, or for a partial week', () => {
  const playing = ALL.filter((t) => !['DAL', 'KC'].includes(t));
  assert.deepEqual(helper._computeNflByeTeams(week(playing, 3)), []);
  assert.deepEqual(helper._computeNflByeTeams(week(playing, 1)), []);
  assert.deepEqual(helper._computeNflByeTeams(week(playing.slice(0, 12))), []);
  assert.deepEqual(helper._computeNflByeTeams([]), []);
});

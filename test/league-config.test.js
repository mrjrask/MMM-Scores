const test = require('node:test');
const assert = require('node:assert/strict');
const leagueConfig = require('../shared-league-config');

test('coerceLeagueArray handles all, arrays, commas, whitespace, and duplicates', () => {
  assert.deepEqual(leagueConfig.coerceLeagueArray('mlb, nba nhl nba'), ['mlb', 'nba', 'nhl']);
  assert.deepEqual(leagueConfig.coerceLeagueArray(['MLB', 'bad', ['nfl', 'nba']]), ['mlb', 'nfl', 'nba']);
  assert.deepEqual(leagueConfig.coerceLeagueArray('all'), leagueConfig.SUPPORTED_LEAGUES);
});

test('seasonal filtering is configurable', () => {
  assert.equal(leagueConfig.isNhlBreakWindow('2026-02-10', {}), true);
  assert.equal(leagueConfig.isNhlBreakWindow('2026-02-10', { seasonalFiltering: false }), false);
  assert.equal(leagueConfig.hideOlympicScoreboards('2026-02-25', {}), true);
  assert.equal(leagueConfig.hideOlympicScoreboards('2026-02-25', { hideOlympicsAfterEnd: false }), false);
});

test('resolveConfiguredLeagues filters seasonal league windows', () => {
  const cfg = { league: 'all', timeZone: 'UTC' };
  assert.ok(!leagueConfig.resolveConfiguredLeagues(cfg, '2026-02-10').includes('nhl'));
  assert.ok(!leagueConfig.resolveConfiguredLeagues(cfg, '2026-02-25').includes('olympic_mhockey'));
  assert.ok(leagueConfig.resolveConfiguredLeagues({ league: 'all', seasonalFiltering: false }, '2026-02-25').includes('olympic_mhockey'));
});

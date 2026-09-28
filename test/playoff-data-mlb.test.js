const test = require('node:test');
const assert = require('node:assert/strict');
const MlbPlayoffs = require('../playoff-data-mlb');

function game(overrides) {
  return Object.assign({
    gamePk: 1,
    gameType: 'F',
    seriesGameNumber: 1,
    gamesInSeries: 3,
    gameDate: '2024-10-01T23:00:00Z',
    status: { abstractGameState: 'Final', detailedState: 'Final' },
    teams: {
      home: { team: { id: 110, name: 'Baltimore Orioles', abbreviation: 'BAL', league: { id: 103 } }, isWinner: false, score: 1 },
      away: { team: { id: 118, name: 'Kansas City Royals', abbreviation: 'KC', league: { id: 103 } }, isWinner: true, score: 2 }
    }
  }, overrides);
}

test('toLogoCode maps CHC/CWS/WSH to this project’s logo file codes and rejects placeholders', () => {
  assert.equal(MlbPlayoffs.toLogoCode('CHC'), 'CUBS');
  assert.equal(MlbPlayoffs.toLogoCode('CWS'), 'SOX');
  assert.equal(MlbPlayoffs.toLogoCode('WSH'), 'WAS');
  assert.equal(MlbPlayoffs.toLogoCode('NYY'), 'NYY');
  assert.equal(MlbPlayoffs.toLogoCode('TBD'), null);
  assert.equal(MlbPlayoffs.toLogoCode(''), null);
});

test('resolveSeason uses the current year from March onward, otherwise the previous year', () => {
  assert.equal(MlbPlayoffs.resolveSeason(new Date('2024-10-15T00:00:00Z')), 2024);
  assert.equal(MlbPlayoffs.resolveSeason(new Date('2025-01-15T00:00:00Z')), 2024);
  assert.equal(MlbPlayoffs.resolveSeason(new Date('2025-03-01T12:00:00Z')), 2025);
});

test('seriesFromGames groups games into a decided series with the right winner and best-of', () => {
  const payload = {
    dates: [{
      games: [
        game({ gamePk: 1, seriesGameNumber: 1, gameDate: '2024-10-01T23:00:00Z' }),
        game({
          gamePk: 2, seriesGameNumber: 2, gameDate: '2024-10-02T23:00:00Z',
          teams: {
            home: { team: { id: 118, name: 'Kansas City Royals', abbreviation: 'KC', league: { id: 103 } }, isWinner: true, score: 5 },
            away: { team: { id: 110, name: 'Baltimore Orioles', abbreviation: 'BAL', league: { id: 103 } }, isWinner: false, score: 2 }
          }
        })
      ]
    }]
  };

  const series = MlbPlayoffs.seriesFromGames(payload);
  assert.equal(series.length, 1);
  const s = series[0];
  assert.equal(s.round, 'F');
  assert.equal(s.league, 'AL');
  assert.equal(s.best_of, 3);
  // Game 1's home team (BAL) is the higher seed and stays teams[0].
  assert.deepEqual(s.teams, ['BAL', 'KC']);
  assert.deepEqual(s.wins, { BAL: 0, KC: 2 });
  assert.equal(s.winner, 'KC');
  assert.equal(s.live, false);
  assert.equal(s.next_start, null);
});

test('seriesFromGames dedupes by gamePk and skips postponed games', () => {
  const dupGame = game({ gamePk: 1 });
  const postponed = game({
    gamePk: 3, seriesGameNumber: 2, status: { abstractGameState: 'Final', detailedState: 'Postponed' }
  });
  const payload = { dates: [{ games: [dupGame, dupGame, postponed] }] };

  const series = MlbPlayoffs.seriesFromGames(payload);
  assert.equal(series.length, 1);
  assert.deepEqual(series[0].wins, { BAL: 0, KC: 1 });
});

test('seriesFromGames identifies a live game and a next scheduled game', () => {
  const payload = {
    dates: [{
      games: [
        game({ gamePk: 1, status: { abstractGameState: 'Live', detailedState: 'In Progress' } }),
        game({
          gamePk: 2, seriesGameNumber: 2, gameDate: '2024-10-03T23:00:00Z',
          status: { abstractGameState: 'Preview', detailedState: 'Scheduled', startTimeTBD: false }
        })
      ]
    }]
  };

  const series = MlbPlayoffs.seriesFromGames(payload);
  assert.equal(series.length, 1);
  assert.equal(series[0].live, true);
  assert.equal(series[0].next_start, '2024-10-03T23:00:00Z');
  assert.equal(series[0].next_game, 2);
});

test('seriesFromGames walks nested payload shapes (e.g. the postseason/series endpoint)', () => {
  const payload = { someWrapper: { series: [{ nested: { games: [game({ gamePk: 42 })] } }] } };
  const series = MlbPlayoffs.seriesFromGames(payload);
  assert.equal(series.length, 1);
  assert.deepEqual(series[0].teams, ['BAL', 'KC']);
  assert.deepEqual(series[0].wins, { BAL: 0, KC: 1 });
});

test('seedsFromStandings reproduces the spec’s worked example (3 division leaders + 3 wild cards)', () => {
  const standingsPayload = {
    records: [
      { league: { id: 103 }, teamRecords: [
        { team: { abbreviation: 'NYY' }, divisionRank: '1', leagueRank: '1', winningPercentage: '.600' },
        { team: { abbreviation: 'CLE' }, divisionRank: '1', leagueRank: '3', winningPercentage: '.550' },
        { team: { abbreviation: 'HOU' }, divisionRank: '1', leagueRank: '5', winningPercentage: '.520' },
        { team: { abbreviation: 'BAL' }, divisionRank: '2', leagueRank: '2', wildCardRank: '1', winningPercentage: '.580' },
        { team: { abbreviation: 'KC' }, divisionRank: '3', leagueRank: '4', wildCardRank: '2', winningPercentage: '.530' },
        { team: { abbreviation: 'DET' }, divisionRank: '2', leagueRank: '6', wildCardRank: '3', winningPercentage: '.500' }
      ] }
    ]
  };

  const seeds = MlbPlayoffs.seedsFromStandings(standingsPayload);
  assert.deepEqual(seeds.AL, { NYY: 1, CLE: 2, HOU: 3, BAL: 4, KC: 5, DET: 6 });
  assert.deepEqual(seeds.NL, {});
});

test('seedsFromStandings gives no seeds for a league without three division leaders', () => {
  const standingsPayload = {
    records: [{ league: { id: 103 }, teamRecords: [
      { team: { abbreviation: 'NYY' }, divisionRank: '1', leagueRank: '1', winningPercentage: '.600' }
    ] }]
  };
  const seeds = MlbPlayoffs.seedsFromStandings(standingsPayload);
  assert.deepEqual(seeds.AL, {});
});

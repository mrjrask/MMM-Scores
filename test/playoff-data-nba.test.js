const test = require('node:test');
const assert = require('node:assert/strict');
const NbaPlayoffs = require('../playoff-data-nba');

test('toLogoCode maps NBA tricodes that differ from this project’s logo file names', () => {
  assert.equal(NbaPlayoffs.toLogoCode('BKN'), 'BRK');
  assert.equal(NbaPlayoffs.toLogoCode('GSW'), 'GS');
  assert.equal(NbaPlayoffs.toLogoCode('NOP'), 'NO');
  assert.equal(NbaPlayoffs.toLogoCode('NYK'), 'NY');
  assert.equal(NbaPlayoffs.toLogoCode('PHO'), 'PHX');
  assert.equal(NbaPlayoffs.toLogoCode('SAS'), 'SA');
  assert.equal(NbaPlayoffs.toLogoCode('WAS'), 'WSH');
  assert.equal(NbaPlayoffs.toLogoCode('OKC'), 'OKC');
});

test('seriesFromBracket derives round-1 position from the higher seed (1v8,4v5,3v6,2v7)', () => {
  const makeSeries = (highSeedRank, lowSeedRank) => ({
    roundNumber: 1, seriesConference: 'West',
    highSeedTricode: 'A' + highSeedRank, lowSeedTricode: 'B' + lowSeedRank,
    highSeedRank, lowSeedRank,
    highSeedSeriesWins: 0, lowSeedSeriesWins: 0,
    highSeedId: 1, lowSeedId: 2, nextGameStatus: 1
  });

  const payload = { playoffBracketSeries: [makeSeries(1, 8), makeSeries(4, 5), makeSeries(3, 6), makeSeries(2, 7)] };
  const series = NbaPlayoffs.seriesFromBracket(payload);
  const positionBySeed = Object.fromEntries(series.map((s) => [s.teams[0], s.position]));
  assert.equal(positionBySeed.A1, 0);
  assert.equal(positionBySeed.A4, 1);
  assert.equal(positionBySeed.A3, 2);
  assert.equal(positionBySeed.A2, 3);
});

test('seriesFromBracket reads live/next-game status from nextGameStatus', () => {
  const payload = {
    playoffBracketSeries: [
      {
        roundNumber: 1, seriesConference: 'West', highSeedTricode: 'DEN', lowSeedTricode: 'LAC',
        highSeedRank: 2, lowSeedRank: 7, highSeedSeriesWins: 2, lowSeedSeriesWins: 1,
        highSeedId: 3, lowSeedId: 4, nextGameStatus: 2
      },
      {
        roundNumber: 1, seriesConference: 'West', highSeedTricode: 'OKC', lowSeedTricode: 'NOP',
        highSeedRank: 1, lowSeedRank: 8, highSeedSeriesWins: 0, lowSeedSeriesWins: 0,
        highSeedId: 1, lowSeedId: 2, nextGameStatus: 1, nextGameDateTimeUTC: '2024-04-27T20:00:00Z', nextGameNumber: 1
      }
    ]
  };

  const series = NbaPlayoffs.seriesFromBracket(payload);
  const live = series.find((s) => s.teams[0] === 'DEN');
  assert.equal(live.live, true);
  assert.equal(live.next_start, null);

  const scheduled = series.find((s) => s.teams[0] === 'OKC');
  assert.equal(scheduled.live, false);
  assert.equal(scheduled.next_start, '2024-04-27T20:00:00Z');
  assert.equal(scheduled.next_game, 1);
});

test('seriesFromBracket ignores non-bracket rounds (e.g. the play-in) and reads winner from seriesWinner', () => {
  const payload = {
    playoffBracketSeries: [
      { roundNumber: 0, seriesConference: 'West', highSeedTricode: 'X', lowSeedTricode: 'Y' },
      {
        roundNumber: 1, seriesConference: 'East', highSeedTricode: 'BOS', lowSeedTricode: 'MIA',
        highSeedRank: 1, lowSeedRank: 8, highSeedSeriesWins: 4, lowSeedSeriesWins: 0,
        highSeedId: 10, lowSeedId: 20, seriesWinner: 10, nextGameStatus: 3
      }
    ]
  };
  const series = NbaPlayoffs.seriesFromBracket(payload);
  assert.equal(series.length, 1);
  assert.equal(series[0].winner, 'BOS');
});

test('seriesFromBracket also accepts a top-level playoffBracketSeries or bracket.playoffBracketSeries shape', () => {
  const oneSeries = {
    roundNumber: 4, seriesConference: 'West', highSeedTricode: 'BOS', lowSeedTricode: 'DEN',
    highSeedRank: null, lowSeedRank: null, highSeedSeriesWins: 4, lowSeedSeriesWins: 3,
    highSeedId: 1, lowSeedId: 2, seriesWinner: 1, nextGameStatus: 3
  };
  assert.equal(NbaPlayoffs.seriesFromBracket({ bracket: { playoffBracketSeries: [oneSeries] } }).length, 1);
  assert.equal(NbaPlayoffs.seriesFromBracket({ series: [oneSeries] }).length, 1);
});

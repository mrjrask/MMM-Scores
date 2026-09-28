const test = require('node:test');
const assert = require('node:assert/strict');
const NhlPlayoffs = require('../playoff-data-nhl');

test('resolveSeasonEndYear rolls to next year starting in September', () => {
  assert.equal(NhlPlayoffs.resolveSeasonEndYear(new Date('2024-10-15T00:00:00Z')), 2025);
  assert.equal(NhlPlayoffs.resolveSeasonEndYear(new Date('2024-05-15T00:00:00Z')), 2024);
  assert.equal(NhlPlayoffs.resolveSeasonEndYear(new Date('2024-09-01T00:00:00Z')), 2025);
});

test('seriesFromBracket maps seriesLetter to round/conference/position per spec table', () => {
  const payload = {
    series: [
      {
        seriesLetter: 'E',
        topSeedTeam: { id: 1, abbrev: 'DAL', commonName: { default: 'Stars' } },
        bottomSeedTeam: { id: 2, abbrev: 'VGK', commonName: { default: 'Golden Knights' } },
        topSeedWins: 4, bottomSeedWins: 3, winningTeamId: 1,
        topSeedRankAbbrev: 'D1', bottomSeedRankAbbrev: 'WC1'
      },
      {
        seriesLetter: 'O',
        topSeedTeam: { id: 5, abbrev: 'FLA', commonName: { default: 'Panthers' } },
        bottomSeedTeam: { id: 6, abbrev: 'EDM', commonName: { default: 'Oilers' } },
        topSeedWins: 0, bottomSeedWins: 0, winningTeamId: null
      }
    ]
  };

  const series = NhlPlayoffs.seriesFromBracket(payload);
  assert.equal(series.length, 2);

  const west1 = series.find((s) => s.letter === 'E');
  assert.equal(west1.round, 1);
  assert.equal(west1.conference, 'west');
  assert.equal(west1.position, 0);
  assert.deepEqual(west1.teams, ['DAL', 'VGK']);
  assert.equal(west1.winner, 'DAL');
  assert.deepEqual(west1._seeds, { DAL: 'D1', VGK: 'WC1' });

  const final = series.find((s) => s.letter === 'O');
  assert.equal(final.round, 4);
  assert.equal(final.conference, '');
  assert.equal(final.winner, null);
});

test('seriesFromBracket skips series missing either team (future rounds not yet set)', () => {
  const payload = { series: [{ seriesLetter: 'I', topSeedTeam: null, bottomSeedTeam: null }] };
  assert.deepEqual(NhlPlayoffs.seriesFromBracket(payload), []);
});

test('seriesFromBracket falls back to 4 wins when winningTeamId is absent', () => {
  const payload = {
    series: [{
      seriesLetter: 'A',
      topSeedTeam: { id: 1, abbrev: 'BOS' },
      bottomSeedTeam: { id: 2, abbrev: 'TOR' },
      topSeedWins: 4, bottomSeedWins: 2
    }]
  };
  const series = NhlPlayoffs.seriesFromBracket(payload);
  assert.equal(series[0].winner, 'BOS');
});

test('projectFirstRoundFromStandings pairs the higher-points division winner against WC2', () => {
  function team(abbrev, conf, div, points, gp, regWins, regOtWins, wins, gd) {
    return {
      teamAbbrev: { default: abbrev }, teamCommonName: { default: abbrev + 'Team' },
      conferenceAbbrev: conf, divisionAbbrev: div,
      points, gamesPlayed: gp, regulationWins: regWins, regulationPlusOtWins: regOtWins, wins, goalDifferential: gd
    };
  }

  const standings = {
    standings: [
      team('A1', 'E', 'A', 100, 82, 40, 45, 48, 50),
      team('A2', 'E', 'A', 95, 82, 38, 42, 45, 40),
      team('A3', 'E', 'A', 90, 82, 36, 40, 42, 30),
      team('A4', 'E', 'A', 70, 82, 30, 32, 34, 10),
      team('M1', 'E', 'M', 98, 82, 39, 44, 47, 48),
      team('M2', 'E', 'M', 92, 82, 37, 41, 43, 35),
      team('M3', 'E', 'M', 88, 82, 35, 39, 41, 25),
      team('M4', 'E', 'M', 65, 82, 28, 30, 32, 5)
    ]
  };

  const series = NhlPlayoffs.projectFirstRoundFromStandings(standings);
  const byLetter = Object.fromEntries(series.map((s) => [s.letter, s]));

  // A1 (100 pts) is the conference's higher-points division winner, so it
  // plays WC2 (the worse-ranked wild card, M4 at 65 pts).
  assert.deepEqual(byLetter.A.teams, ['A1', 'M4']);
  assert.deepEqual(byLetter.B.teams, ['A2', 'A3']);
  assert.deepEqual(byLetter.C.teams, ['M1', 'A4']);
  assert.deepEqual(byLetter.D.teams, ['M2', 'M3']);
  series.forEach((s) => assert.equal(s.projected, true));
});

test('projectFirstRoundFromStandings returns nothing before any games are played', () => {
  const standings = { standings: [{ teamAbbrev: { default: 'A1' }, conferenceAbbrev: 'E', divisionAbbrev: 'A', gamesPlayed: 0 }] };
  assert.deepEqual(NhlPlayoffs.projectFirstRoundFromStandings(standings), []);
});

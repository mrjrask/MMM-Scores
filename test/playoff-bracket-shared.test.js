const test = require('node:test');
const assert = require('node:assert/strict');
const Bracket = require('../playoff-bracket-shared');

test('MLB: seeds pair Wild Card slots and unfilled rounds show seed-derived matchups', () => {
  const data = {
    season: 2024,
    seeds: { AL: { NYY: 1, CLE: 2, HOU: 3, BAL: 4, KC: 5, DET: 6 }, NL: { PHI: 1, LAD: 2, MIL: 3, SD: 4, ATL: 5, NYM: 6 } },
    names: { KC: 'Royals', BAL: 'Orioles' },
    series: [
      { round: 'F', league: 'AL', best_of: 3, teams: ['BAL', 'KC'], wins: { BAL: 0, KC: 2 }, live: false, winner: 'KC' },
      { round: 'F', league: 'AL', best_of: 3, teams: ['HOU', 'DET'], wins: { HOU: 1, DET: 1 }, live: true, winner: null }
    ]
  };

  const view = Bracket.buildPlayoffView('mlb', data);

  assert.equal(view.currentRound, 'F');
  assert.equal(view.projected, false);
  assert.equal(view.heading, 'Wild Card Series · Best of 3');
  // AL slots first, then NL (spec: "the round's AL slots, then its NL slots")
  assert.deepEqual(view.seriesList.map((s) => s.teams), [
    ['BAL', 'KC'], ['HOU', 'DET'], ['SD', 'ATL'], ['MIL', 'NYM']
  ]);

  // The winner of WC slot 0 (KC) becomes the bottom team of DS slot 0, since
  // seed 1 (NYY) is the fixed bye occupying the top row.
  assert.deepEqual(view.bracket.sides.AL.DS[0].teams, ['NYY', 'KC']);
  assert.equal(view.bracket.sides.AL.DS[0].series, null);
});

test('MLB: World Series always lists the AL team on top, even if the API lists NL first', () => {
  const data = {
    seeds: { AL: {}, NL: {} },
    series: [
      { round: 'L', league: 'AL', best_of: 7, teams: ['NYY', 'HOU'], wins: { NYY: 4, HOU: 2 }, winner: 'NYY' },
      { round: 'L', league: 'NL', best_of: 7, teams: ['LAD', 'ATL'], wins: { LAD: 4, ATL: 1 }, winner: 'LAD' },
      { round: 'W', league: '', best_of: 7, teams: ['LAD', 'NYY'], wins: { LAD: 2, NYY: 1 }, winner: null }
    ]
  };

  const view = Bracket.buildPlayoffView('mlb', data);
  assert.equal(view.currentRound, 'W');
  assert.deepEqual(view.bracket.final.teams, ['NYY', 'LAD']);
  assert.deepEqual(view.bracket.final.wins, [1, 2]);
});

test('MLB: with no series at all, the bracket is projected from seeds', () => {
  const data = {
    seeds: { AL: { NYY: 1, CLE: 2, HOU: 3, BAL: 4, KC: 5, DET: 6 }, NL: {} },
    series: []
  };

  const view = Bracket.buildPlayoffView('mlb', data);
  assert.equal(view.projected, true);
  assert.equal(view.currentRound, 'F');
  assert.equal(view.heading, 'Projected Wild Card Series');
  assert.deepEqual(view.seriesList[0].teams, ['BAL', 'KC']);
  assert.equal(view.seriesList[0].series, null);
});

test('MLB: once every round is finished, the current round is the World Series', () => {
  const decided = (teams, winner) => ({ round: 'W', league: '', best_of: 7, teams, wins: { [teams[0]]: 4, [teams[1]]: 1 }, winner });
  const data = {
    seeds: { AL: {}, NL: {} },
    series: [
      { round: 'F', league: 'AL', best_of: 3, teams: ['A', 'B'], wins: { A: 2, B: 0 }, winner: 'A' },
      { round: 'D', league: 'AL', best_of: 5, teams: ['A', 'C'], wins: { A: 3, C: 0 }, winner: 'A' },
      { round: 'L', league: 'AL', best_of: 7, teams: ['A', 'D'], wins: { A: 4, D: 0 }, winner: 'A' },
      decided(['A', 'E'], 'A')
    ]
  };
  const view = Bracket.buildPlayoffView('mlb', data);
  assert.equal(view.currentRound, 'W');
  assert.equal(view.projected, false);
  assert.equal(view.bracket.champion, 'A');
});

test('NHL/NBA: 16-team bracket places round-1 series by position and mirrors both conferences', () => {
  const data = {
    season: 2024,
    names: { DAL: 'Stars', VGK: 'Golden Knights' },
    seeds: { DAL: 'D1', VGK: 'WC1' },
    series: [
      { round: 1, conference: 'west', position: 0, teams: ['DAL', 'VGK'], wins: { DAL: 4, VGK: 3 }, winner: 'DAL', live: false },
      { round: 1, conference: 'west', position: 1, teams: ['EDM', 'LAK'], wins: { EDM: 2, LAK: 1 }, winner: null, live: true }
    ]
  };

  const view = Bracket.buildPlayoffView('nhl', data);
  assert.equal(view.currentRound, 1);
  assert.equal(view.heading, 'First Round · Best of 7');
  // Empty round-1 slots (positions 2 and 3) are left out of the series list.
  assert.deepEqual(view.seriesList.map((s) => s.teams), [['DAL', 'VGK'], ['EDM', 'LAK']]);
  // Round 2's expected teams come from round 1's winners; an undecided
  // feeder leaves that side of the expected matchup as TBD (null).
  assert.deepEqual(view.bracket.sides.west[2][0].teams, ['DAL', null]);
});

test('NHL/NBA: with only projected series, round 1 is flagged projected', () => {
  const data = {
    series: [
      { round: 1, conference: 'east', position: 0, teams: ['A', 'B'], wins: {}, winner: null, live: false, projected: true }
    ]
  };
  const view = Bracket.buildPlayoffView('nhl', data);
  assert.equal(view.projected, true);
  assert.equal(view.heading, 'Projected First Round');
});

test('NHL/NBA: the final lists the West conference champion first, even if the feed lists it second', () => {
  const data = {
    series: [
      { round: 3, conference: 'west', position: 0, teams: ['WEST_TEAM', 'X'], wins: { WEST_TEAM: 4, X: 1 }, winner: 'WEST_TEAM', live: false },
      { round: 3, conference: 'east', position: 0, teams: ['Y', 'EAST_TEAM'], wins: { Y: 0, EAST_TEAM: 4 }, winner: 'EAST_TEAM', live: false },
      // The raw series object lists the East team first; the bracket must
      // still put the West champion on top to match the left-hand side.
      { round: 4, conference: '', position: 0, teams: ['EAST_TEAM', 'WEST_TEAM'], wins: { EAST_TEAM: 1, WEST_TEAM: 2 }, winner: null, live: false }
    ]
  };
  const view = Bracket.buildPlayoffView('nba', data);
  assert.deepEqual(view.bracket.final.teams, ['WEST_TEAM', 'EAST_TEAM']);
  assert.deepEqual(view.bracket.final.wins, [2, 1]);
});

test('seriesStatus: decided series report the winner in green', () => {
  const status = Bracket.seriesStatus(
    { teams: ['BAL', 'KC'], wins: { BAL: 0, KC: 2 }, winner: 'KC' },
    { KC: 'Royals' },
    'America/Chicago'
  );
  assert.deepEqual(status, { text: 'Royals win 2-0', cls: 'win' });
});

test('seriesStatus: live series report the next game number in yellow', () => {
  const status = Bracket.seriesStatus(
    { teams: ['HOU', 'DET'], wins: { HOU: 1, DET: 1 }, live: true, winner: null },
    {},
    'America/Chicago'
  );
  assert.deepEqual(status, { text: 'Game 3 · LIVE', cls: 'live' });
});

test('seriesStatus: tied and leading series use plain white text with the team code', () => {
  const tied = Bracket.seriesStatus({ teams: ['A', 'B'], wins: { A: 1, B: 1 }, winner: null }, {}, 'UTC');
  assert.deepEqual(tied, { text: 'Series tied 1-1', cls: 'normal' });

  const leading = Bracket.seriesStatus({ teams: ['A', 'B'], wins: { A: 2, B: 1 }, winner: null }, {}, 'UTC');
  assert.deepEqual(leading, { text: 'A leads 2-1', cls: 'normal' });
});

test('seriesStatus: a null or projected series reads "Projected" and dim', () => {
  assert.deepEqual(Bracket.seriesStatus(null, {}, 'UTC'), { text: 'Projected', cls: 'dim' });
  assert.deepEqual(
    Bracket.seriesStatus({ projected: true, teams: ['A', 'B'], wins: {} }, {}, 'UTC'),
    { text: 'Projected', cls: 'dim' }
  );
});

// formatGameWhen compares its target time against `new Date()` (actual wall
// clock) internally, so these build target times relative to "right now"
// rather than a hardcoded date, keeping the "same day" / "tomorrow" / "within
// a week" branches exercised regardless of when the suite runs.
function isoHoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

test('formatGameWhen: a game a few hours from now on the same UTC day is "Today"/"Tonight"', () => {
  const soon = Bracket.formatGameWhen(isoHoursFromNow(1), 'UTC', false);
  assert.match(soon, /^(Today|Tonight) /);
});

test('formatGameWhen: a game about a day out reads "Tomorrow"', () => {
  const tomorrow = Bracket.formatGameWhen(isoHoursFromNow(26), 'UTC', false);
  assert.match(tomorrow, /^Tomorrow /);
});

test('formatGameWhen: a game several days out (but within a week) uses the weekday name', () => {
  const withinWeek = Bracket.formatGameWhen(isoHoursFromNow(4 * 24), 'UTC', false);
  assert.doesNotMatch(withinWeek, /^(Today|Tonight|Tomorrow)/);
  assert.match(withinWeek, /^[A-Z][a-z]+day /);
});

test('formatGameWhen: TBD start times omit the clock time', () => {
  const when = Bracket.formatGameWhen(isoHoursFromNow(1), 'UTC', true);
  assert.doesNotMatch(when, /\d+:\d+/);
});

test('layout geometry matches the spec’s worked 320-wide example (row_h units)', () => {
  const mlb = Bracket.mlbColumnTopsUnits();
  assert.equal(mlb.bodyHeightUnits, 5.5);
  assert.deepEqual(mlb.DS, [0, 3]);
  assert.deepEqual(mlb.WC, [0.5, 3.5]);
  assert.deepEqual(mlb.LCS, [1.5]);

  const pairs = Bracket.pairsColumnTopsUnits();
  assert.equal(pairs.bodyHeightUnits, 9.5);
  assert.deepEqual(pairs.rounds[0], [0, 2.5, 5, 7.5]);
  assert.deepEqual(pairs.rounds[1], [1.25, 6.25]);
  assert.deepEqual(pairs.rounds[2], [3.75]);
});

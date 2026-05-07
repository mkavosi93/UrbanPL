/**
 * Tests for the auto-score calculation logic used in RefereeScreen.
 *
 * When the referee ends the second half, the app sums goals per team
 * from the recorded stats to pre-fill the final score.
 */

// Inline the auto-score logic as it appears in handleEndHalf
function calcAutoScore(players, teams, goals, present) {
  const presentPlayers = players.filter(gp => present[gp.player_id]);
  const scoreA = presentPlayers
    .filter(gp => teams[gp.player_id] === 'A')
    .reduce((sum, gp) => sum + (goals[gp.player_id] || 0), 0);
  const scoreB = presentPlayers
    .filter(gp => teams[gp.player_id] === 'B')
    .reduce((sum, gp) => sum + (goals[gp.player_id] || 0), 0);
  return { scoreA, scoreB };
}

const mockPlayers = [
  { player_id: 'p1' }, // Team A
  { player_id: 'p2' }, // Team A
  { player_id: 'p3' }, // Team B
  { player_id: 'p4' }, // Team B
  { player_id: 'p5' }, // Team B (absent)
];

const teams = { p1: 'A', p2: 'A', p3: 'B', p4: 'B', p5: 'B' };
const allPresent = { p1: true, p2: true, p3: true, p4: true, p5: true };
const p5Absent  = { p1: true, p2: true, p3: true, p4: true, p5: false };

test('0-0 draw when no goals recorded', () => {
  const goals = {};
  expect(calcAutoScore(mockPlayers, teams, goals, allPresent)).toEqual({ scoreA: 0, scoreB: 0 });
});

test('2-1 result from recorded goals', () => {
  const goals = { p1: 1, p2: 1, p3: 1 };
  expect(calcAutoScore(mockPlayers, teams, goals, allPresent)).toEqual({ scoreA: 2, scoreB: 1 });
});

test('absent player goals are excluded', () => {
  // p5 scored but is marked absent — should not count
  const goals = { p1: 1, p5: 2 };
  expect(calcAutoScore(mockPlayers, teams, goals, p5Absent)).toEqual({ scoreA: 1, scoreB: 0 });
});

test('hat-trick player gives correct team total', () => {
  const goals = { p2: 3, p3: 1, p4: 1 };
  expect(calcAutoScore(mockPlayers, teams, goals, allPresent)).toEqual({ scoreA: 3, scoreB: 2 });
});

test('all goals on one side', () => {
  const goals = { p3: 2, p4: 1 };
  expect(calcAutoScore(mockPlayers, teams, goals, allPresent)).toEqual({ scoreA: 0, scoreB: 3 });
});

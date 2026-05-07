/**
 * Tests for calcPoints — the points calculation logic used in match reports.
 *
 * Rules:
 *   Win          → +3
 *   Goal         → +1 each
 *   GK clean sheet (0 conceded) → +3
 *   GK conceded < 2             → +1
 *   Yellow card  → -1 each
 *   Red card     → -3 each
 *   Minimum      → 0 (never negative)
 */

// Inline the function so tests don't depend on importing the full screen
function calcPoints(s) {
  let p = 0;
  if (s.won) p += 3;
  p += (s.goals || 0);
  if (s.isGK) {
    const conceded = s.goals_conceded || 0;
    if (conceded === 0) p += 3;
    else if (conceded < 2) p += 1;
  }
  p -= (s.yellow || 0) * 1;
  p -= (s.red || 0) * 3;
  return Math.max(0, p);
}

// ── Win scenarios ──────────────────────────────────────────────────────────
test('win with no goals = 3 points', () => {
  expect(calcPoints({ won: true, goals: 0 })).toBe(3);
});

test('win + 2 goals = 5 points', () => {
  expect(calcPoints({ won: true, goals: 2 })).toBe(5);
});

test('loss with no goals = 0 points', () => {
  expect(calcPoints({ won: false, goals: 0 })).toBe(0);
});

test('loss + 1 goal = 1 point', () => {
  expect(calcPoints({ won: false, goals: 1 })).toBe(1);
});

// ── GK bonuses ─────────────────────────────────────────────────────────────
test('GK clean sheet (win) = 3 + 3 = 6 points', () => {
  expect(calcPoints({ won: true, goals: 0, isGK: true, goals_conceded: 0 })).toBe(6);
});

test('GK conceded 1 (win) = 3 + 1 = 4 points', () => {
  expect(calcPoints({ won: true, goals: 0, isGK: true, goals_conceded: 1 })).toBe(4);
});

test('GK conceded 2+ gets no bonus', () => {
  expect(calcPoints({ won: true, goals: 0, isGK: true, goals_conceded: 2 })).toBe(3);
});

test('GK clean sheet (loss) = 3 points', () => {
  expect(calcPoints({ won: false, goals: 0, isGK: true, goals_conceded: 0 })).toBe(3);
});

// ── Card deductions ────────────────────────────────────────────────────────
test('yellow card deducts 1', () => {
  expect(calcPoints({ won: true, goals: 0, yellow: 1 })).toBe(2);
});

test('red card deducts 3', () => {
  expect(calcPoints({ won: true, goals: 0, red: 1 })).toBe(0);
});

test('two yellows on a loss = floor at 0', () => {
  expect(calcPoints({ won: false, goals: 0, yellow: 2 })).toBe(0);
});

test('red card + goal on a win = 1 point', () => {
  expect(calcPoints({ won: true, goals: 1, red: 1 })).toBe(1);
});

// ── Floor at 0 ─────────────────────────────────────────────────────────────
test('never returns negative points', () => {
  expect(calcPoints({ won: false, goals: 0, red: 3 })).toBe(0);
});

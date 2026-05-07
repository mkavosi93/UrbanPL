/**
 * Live integration tests for the create-payment-intent Supabase Edge Function.
 *
 * These call the real deployed function — requires internet access.
 * Uses the Supabase anon key (safe: the function has --no-verify-jwt).
 */

const FUNCTION_URL = 'https://zprtghdcmiavtoaltlld.supabase.co/functions/v1/create-payment-intent';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpwcnRnaGRjbWlhdnRvYWx0bGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMxMTA5NTMsImV4cCI6MjA1ODY4Njk1M30.yRiHVGfHTOSECsXGBQbsLVIJiZHnOHFHFKonOLsXrCE';

async function callFunction(body) {
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

// ── Happy path ─────────────────────────────────────────────────────────────
test('returns a clientSecret for a valid amount', async () => {
  const { status, data } = await callFunction({
    amount: 5,
    gameId: 'test-game-id',
    playerId: 'test-player-id',
    gameTitle: 'Test Game',
  });

  expect(status).toBe(200);
  expect(data.clientSecret).toBeDefined();
  expect(typeof data.clientSecret).toBe('string');
  // Stripe client secrets follow the pattern pi_xxx_secret_xxx
  expect(data.clientSecret).toMatch(/^pi_/);
}, 10000);

test('clientSecret contains _secret_ segment', async () => {
  const { data } = await callFunction({ amount: 10 });
  expect(data.clientSecret).toContain('_secret_');
}, 10000);

// ── Validation ─────────────────────────────────────────────────────────────
test('returns 400 for missing amount', async () => {
  const { status, data } = await callFunction({ gameId: 'x' });
  expect(status).toBe(400);
  expect(data.error).toBe('Invalid amount');
}, 10000);

test('returns 400 for zero amount', async () => {
  const { status, data } = await callFunction({ amount: 0 });
  expect(status).toBe(400);
  expect(data.error).toBe('Invalid amount');
}, 10000);

test('returns 400 for negative amount', async () => {
  const { status, data } = await callFunction({ amount: -5 });
  expect(status).toBe(400);
  expect(data.error).toBe('Invalid amount');
}, 10000);

// ── CORS ───────────────────────────────────────────────────────────────────
test('responds to OPTIONS preflight', async () => {
  const res = await fetch(FUNCTION_URL, {
    method: 'OPTIONS',
    headers: { 'Authorization': `Bearer ${ANON_KEY}` },
  });
  expect(res.status).toBe(200);
}, 10000);

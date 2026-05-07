/**
 * send-sms Edge Function
 * Sends SMS via Twilio. Called internally by other Edge Functions or directly.
 *
 * POST body:
 *   { to: "+1xxxxxxxxxx", message: "Your text here" }
 *
 * Supported notification types (pass as `type`):
 *   - "game_reminder"   → sent 2h before kickoff
 *   - "teams_assigned"  → when lineup is published
 *   - "match_started"   → when referee starts the match
 *   - "match_result"    → when match is completed
 *   - "custom"          → free-form message field required
 */

const TWILIO_ACCOUNT_SID      = Deno.env.get('TWILIO_ACCOUNT_SID')!;
const TWILIO_AUTH_TOKEN       = Deno.env.get('TWILIO_AUTH_TOKEN')!;
const TWILIO_MESSAGING_SID    = Deno.env.get('TWILIO_MESSAGING_SID')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function sendSMS(to: string, body: string): Promise<{ sid: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

  const params = new URLSearchParams();
  params.append('To',              to);
  params.append('MessagingServiceSid', TWILIO_MESSAGING_SID);
  params.append('Body',            body);

  const credentials = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message ?? 'Twilio error');
  }

  return { sid: data.sid };
}

function buildMessage(type: string, payload: Record<string, string>): string {
  switch (type) {
    case 'game_reminder':
      return `⚽ Urban PL Reminder: Your game "${payload.title}" kicks off in 2 hours at ${payload.venue}. See you there!`;
    case 'teams_assigned':
      return `⚽ Urban PL: Teams are set for "${payload.title}"! Open the app to see your team and lineup.`;
    case 'match_started':
      return `🟢 Urban PL: "${payload.title}" has kicked off! Follow live in the app.`;
    case 'match_result':
      return `🏁 Urban PL: "${payload.title}" is done. Final score: 🖤 Dark ${payload.scoreA} – ${payload.scoreB} White 🤍. Check your stats in the app!`;
    case 'custom':
      return payload.message ?? 'Message from Urban PL';
    default:
      return payload.message ?? 'Message from Urban PL';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { to, type = 'custom', payload = {}, message } = await req.json();

    if (!to) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: to' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Allow direct message override
    const body = message ?? buildMessage(type, payload);
    const result = await sendSMS(to, body);

    return new Response(
      JSON.stringify({ success: true, sid: result.sid }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('send-sms error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

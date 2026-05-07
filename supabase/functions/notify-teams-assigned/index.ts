/**
 * notify-teams-assigned Edge Function
 *
 * Runs on a schedule (every 15 minutes via Supabase cron).
 * Finds games kicking off in 105–135 minutes (i.e. ~2 hours away),
 * checks if teams have been assigned, and SMS each opted-in player
 * their team (Dark or White) and a reminder.
 *
 * Cron schedule: every 15 minutes  (set in Supabase dashboard)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SMS_FUNCTION_URL  = `${SUPABASE_URL}/functions/v1/send-sms`;
const ANON_KEY          = Deno.env.get('SUPABASE_ANON_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function sendSMS(to: string, message: string) {
  await fetch(SMS_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({ to, message }),
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() + 105 * 60 * 1000); // 1h 45m from now
    const windowEnd   = new Date(now.getTime() + 135 * 60 * 1000); // 2h 15m from now

    // Find active/open games kicking off in the 2h window
    const { data: games, error } = await supabase
      .from('games')
      .select(`
        id, location, format, kickoff_time,
        game_players(
          player_id, team,
          players(id, name, phone, sms_consent)
        )
      `)
      .in('status', ['open', 'active'])
      .gte('kickoff_time', windowStart.toISOString())
      .lte('kickoff_time', windowEnd.toISOString());

    if (error) throw error;

    if (!games || games.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No games in notification window', checked_at: now.toISOString() }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let totalSent = 0;

    for (const game of games) {
      const venue = game.location?.split(',')[0] || 'the venue';
      const kickoff = new Date(game.kickoff_time);
      const timeStr = kickoff.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York'
      });

      for (const gp of (game.game_players || [])) {
        const player = gp.players;
        if (!player?.phone || !player?.sms_consent) continue;

        const teamName = gp.team === 'A' ? 'Dark' : gp.team === 'B' ? 'White' : null;

        let message: string;
        if (teamName) {
          message = `Urban PL: Teams are set for your ${game.format} game at ${venue} (${timeStr}). You are on team ${teamName}. See you there!`;
        } else {
          // Team not yet assigned — just send reminder
          message = `Urban PL: Reminder - your ${game.format} game at ${venue} kicks off at ${timeStr}. Check the app for your team!`;
        }

        await sendSMS(player.phone, message);
        totalSent++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, games_processed: games.length, sms_sent: totalSent }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('notify-teams-assigned error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

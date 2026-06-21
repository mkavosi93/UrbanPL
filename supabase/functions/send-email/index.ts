import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM = 'Urban PL <admin@theurbanpl.com>';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Email templates ────────────────────────────────────────────────────────────

function baseLayout(content: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Urban PL</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#111118;border-radius:16px;border:1px solid rgba(245,197,24,0.2);overflow:hidden;max-width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0d0d1a 0%,#1a1a2e 100%);padding:28px 32px;border-bottom:2px solid #F5C518;text-align:center;">
            <span style="font-size:28px;font-weight:900;color:#F5C518;letter-spacing:-1px;">URBAN</span>
            <span style="font-size:28px;font-weight:900;color:#ffffff;letter-spacing:-1px;"> PL</span>
            <p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:3px;text-transform:uppercase;">South Florida Pickup League</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            ${content}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0d0d1a;padding:20px 32px;border-top:1px solid rgba(255,255,255,0.07);text-align:center;">
            <p style="margin:0 0 4px;font-size:11px;color:rgba(255,255,255,0.3);">Urban PL · South Florida</p>
            <p style="margin:0;font-size:10px;color:rgba(255,255,255,0.2);">
              <a href="https://www.theurbanpl.com" style="color:#F5C518;text-decoration:none;">theurbanpl.com</a>
              &nbsp;·&nbsp;
              <a href="mailto:admin@theurbanpl.com" style="color:rgba(255,255,255,0.3);text-decoration:none;">admin@theurbanpl.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function welcomeEmail(firstName: string) {
  return baseLayout(`
    <h1 style="margin:0 0 8px;font-size:26px;font-weight:900;color:#ffffff;">Welcome to the pitch, ${firstName}! ⚽</h1>
    <p style="margin:0 0 24px;font-size:15px;color:rgba(255,255,255,0.6);line-height:1.6;">
      You're officially part of Urban PL — South Florida's premier pickup soccer league.
      Time to lace up and get on the field.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      ${[
        ['⚽', 'Browse Games', 'Find and join pickup games near you'],
        ['🏆', 'Enter Tournaments', 'Compete in cups and win cash prizes'],
        ['📊', 'Track Your Stats', 'Goals, assists, and your player rating'],
        ['🧑‍⚖️', 'Pro Referees', 'Every game officiated by certified refs'],
      ].map(([icon, title, desc]) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
            <span style="font-size:20px;margin-right:12px;">${icon}</span>
            <strong style="color:#ffffff;font-size:14px;">${title}</strong>
            <p style="margin:2px 0 0 34px;font-size:12px;color:rgba(255,255,255,0.45);">${desc}</p>
          </td>
        </tr>
      `).join('')}
    </table>

    <div style="text-align:center;">
      <a href="https://www.theurbanpl.com" style="display:inline-block;background:#F5C518;color:#07080a;font-weight:800;font-size:14px;letter-spacing:2px;text-transform:uppercase;padding:14px 32px;border-radius:8px;text-decoration:none;">
        FIND A GAME
      </a>
    </div>

    <p style="margin:24px 0 0;font-size:12px;color:rgba(255,255,255,0.3);text-align:center;">
      Follow us: <a href="https://instagram.com/urbanpleague" style="color:#F5C518;text-decoration:none;">@urbanpleague</a>
    </p>
  `);
}

function gameBookingEmail(firstName: string, game: any) {
  const kickoff = new Date(game.kickoff_time);
  const dateStr = kickoff.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = kickoff.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return baseLayout(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:rgba(245,197,24,0.1);border:1px solid rgba(245,197,24,0.4);border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;text-align:center;">⚽</div>
    </div>
    <h1 style="margin:0 0 4px;font-size:24px;font-weight:900;color:#ffffff;text-align:center;">You're in, ${firstName}!</h1>
    <p style="margin:0 0 28px;font-size:14px;color:rgba(255,255,255,0.5);text-align:center;">Game booking confirmed</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.04);border-radius:12px;border:1px solid rgba(245,197,24,0.15);margin-bottom:24px;">
      ${[
        ['📅', 'Date & Time', `${dateStr} at ${timeStr}`],
        ['📍', 'Location', game.location || 'TBC'],
        ['⚽', 'Format', game.format || '7v7'],
        ['💰', 'Entry Fee', game.entry_fee > 0 ? `$${game.entry_fee}` : 'Free'],
        ['👥', 'Spots', `${game.total_spots} total`],
      ].map(([icon, label, value]) => `
        <tr>
          <td style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05);">
            <span style="font-size:16px;margin-right:10px;">${icon}</span>
            <span style="font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;">${label}</span>
            <p style="margin:2px 0 0 28px;font-size:14px;color:#ffffff;font-weight:600;">${value}</p>
          </td>
        </tr>
      `).join('')}
    </table>

    <div style="background:rgba(245,197,24,0.06);border-left:3px solid #F5C518;border-radius:4px;padding:12px 16px;margin-bottom:24px;">
      <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.6);line-height:1.6;">
        ⏰ <strong style="color:#F5C518;">Arrive 10 minutes early.</strong> Kickoff waits for no one — late arrivals may forfeit their spot.
      </p>
    </div>

    <div style="background:rgba(255,165,0,0.06);border-left:3px solid #FFA500;border-radius:4px;padding:12px 16px;margin-bottom:24px;">
      <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.6);line-height:1.6;">
        ⚠️ This game is subject to reaching a minimum number of players and a confirmed referee before it's officially confirmed. You will be notified if the game is cancelled.
      </p>
    </div>

    <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.3);text-align:center;">
      Need to withdraw? Open the Urban PL app → My Upcoming → Withdraw (6hr+ before kickoff for refund).
    </p>
  `);
}

function tournamentBookingEmail(firstName: string, tournament: any, teamName: string) {
  const kickoff = new Date(tournament.kickoff_date);
  const dateStr = kickoff.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return baseLayout(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:rgba(245,197,24,0.1);border:1px solid rgba(245,197,24,0.4);border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;text-align:center;">🏆</div>
    </div>
    <h1 style="margin:0 0 4px;font-size:24px;font-weight:900;color:#ffffff;text-align:center;">Tournament Confirmed!</h1>
    <p style="margin:0 0 28px;font-size:14px;color:rgba(255,255,255,0.5);text-align:center;">You're registered for ${tournament.name}</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.04);border-radius:12px;border:1px solid rgba(245,197,24,0.15);margin-bottom:24px;">
      ${[
        ['🏆', 'Tournament', tournament.name],
        ['👕', 'Your Team', teamName],
        ['📅', 'Date', dateStr],
        ['📍', 'Venue', tournament.venue || 'TBC'],
        ['⚽', 'Format', tournament.format || '7v7'],
        ['💰', 'Entry Fee', tournament.entry_fee > 0 ? `$${tournament.entry_fee}` : 'Free'],
      ].map(([icon, label, value]) => `
        <tr>
          <td style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05);">
            <span style="font-size:16px;margin-right:10px;">${icon}</span>
            <span style="font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;">${label}</span>
            <p style="margin:2px 0 0 28px;font-size:14px;color:#ffffff;font-weight:600;">${value}</p>
          </td>
        </tr>
      `).join('')}
    </table>

    <div style="background:rgba(245,197,24,0.06);border-left:3px solid #F5C518;border-radius:4px;padding:12px 16px;margin-bottom:24px;">
      <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.6);line-height:1.6;">
        🏅 <strong style="color:#F5C518;">Good luck!</strong> Only registered team members may play. Brackets will be announced before the event.
      </p>
    </div>

    <div style="background:rgba(255,165,0,0.06);border-left:3px solid #FFA500;border-radius:4px;padding:12px 16px;margin-bottom:24px;">
      <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.6);line-height:1.6;">
        ⚠️ This tournament is subject to reaching the minimum number of registered teams and a confirmed referee before it's officially confirmed. You will be notified if the event is cancelled.
      </p>
    </div>

    <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.3);text-align:center;">
      Withdraw 48+ hours before the event for a full refund via the Urban PL app.
    </p>
  `);
}

function refereeApplicationReceivedEmail(firstName: string) {
  return baseLayout(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:rgba(245,197,24,0.1);border:1px solid rgba(245,197,24,0.4);border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;text-align:center;">⏳</div>
    </div>
    <h1 style="margin:0 0 4px;font-size:24px;font-weight:900;color:#ffffff;text-align:center;">Application Received, ${firstName}!</h1>
    <p style="margin:0 0 28px;font-size:14px;color:rgba(255,255,255,0.5);text-align:center;">Your referee application is under review</p>

    <div style="background:rgba(245,197,24,0.06);border-left:3px solid #F5C518;border-radius:4px;padding:16px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.7);line-height:1.7;">
        Our team is reviewing your government ID and selfie to verify your identity. This typically takes <strong style="color:#F5C518;">1–2 business days</strong>.<br/><br/>
        You will receive another email once your account has been approved and you can start accepting games.
      </p>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      ${[
        ['📋', 'Application submitted', 'We have your details on file'],
        ['🪪', 'ID under review', 'Admin is verifying your identity'],
        ['✅', 'Approval notification', 'You\'ll be emailed once approved'],
        ['⚽', 'Start officiating', 'Accept your first game assignment'],
      ].map(([icon, title, desc]) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
            <span style="font-size:20px;margin-right:12px;">${icon}</span>
            <strong style="color:#ffffff;font-size:14px;">${title}</strong>
            <p style="margin:2px 0 0 34px;font-size:12px;color:rgba(255,255,255,0.45);">${desc}</p>
          </td>
        </tr>
      `).join('')}
    </table>

    <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.3);text-align:center;">
      Questions? Contact us at <a href="mailto:urbanpl.app@gmail.com" style="color:#F5C518;text-decoration:none;">urbanpl.app@gmail.com</a>
    </p>
  `);
}

function refereeApplicationEmail(firstName: string, lastName: string, refereeEmail: string, certLevel: string, experience: string, formats: string[]) {
  return baseLayout(`
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;color:#ffffff;">New Referee Application 🧑‍⚖️</h1>
    <p style="margin:0 0 24px;font-size:15px;color:rgba(255,255,255,0.6);line-height:1.6;">
      A new referee has submitted their application and is pending your review.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.04);border-radius:12px;border:1px solid rgba(245,197,24,0.15);margin-bottom:24px;">
      ${[
        ['👤', 'Name', `${firstName} ${lastName}`],
        ['📧', 'Email', refereeEmail],
        ['🏅', 'Certification', certLevel || 'Not specified'],
        ['⏱️', 'Experience', experience || 'Not specified'],
        ['⚽', 'Formats', (formats || []).join(', ') || 'Not specified'],
      ].map(([icon, label, value]) => `
        <tr>
          <td style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05);">
            <span style="font-size:16px;margin-right:10px;">${icon}</span>
            <span style="font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;">${label}</span>
            <p style="margin:2px 0 0 28px;font-size:14px;color:#ffffff;font-weight:600;">${value}</p>
          </td>
        </tr>
      `).join('')}
    </table>

    <div style="background:rgba(245,197,24,0.06);border-left:3px solid #F5C518;border-radius:4px;padding:12px 16px;margin-bottom:24px;">
      <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.7);line-height:1.6;">
        🪪 <strong style="color:#F5C518;">Action required:</strong> Log in to the Admin panel → <strong>Referees tab</strong> → find them under <strong>Pending Review</strong> → tap <strong>View ID</strong> to check their government ID and selfie, then tap <strong>Approve</strong>.
      </p>
    </div>

    <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.3);text-align:center;">
      Urban PL Admin · Automated notification
    </p>
  `);
}

function refereeApprovedEmail(firstName: string) {
  return baseLayout(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:rgba(0,200,100,0.1);border:1px solid rgba(0,200,100,0.4);border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;text-align:center;">✅</div>
    </div>
    <h1 style="margin:0 0 4px;font-size:24px;font-weight:900;color:#ffffff;text-align:center;">You're Approved, ${firstName}!</h1>
    <p style="margin:0 0 28px;font-size:14px;color:rgba(255,255,255,0.5);text-align:center;">Your referee account is now active</p>

    <div style="background:rgba(0,200,100,0.06);border-left:3px solid #00c864;border-radius:4px;padding:16px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.7);line-height:1.7;">
        Welcome to the Urban PL referee team! Your identity has been verified and your account is fully active.<br/><br/>
        Open the app and log in — you'll now have access to the <strong style="color:#F5C518;">Referee Panel</strong> where you can view upcoming fixture assignments and manage live matches.
      </p>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      ${[
        ['📱', 'Open the app', 'Log in with your registered email'],
        ['🗓️', 'Check fixtures', 'View your upcoming game assignments'],
        ['⚽', 'Manage live matches', 'Track attendance, stats & final score'],
        ['💰', 'Get paid', 'Referee pay is tracked automatically'],
      ].map(([icon, title, desc]) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
            <span style="font-size:20px;margin-right:12px;">${icon}</span>
            <strong style="color:#ffffff;font-size:14px;">${title}</strong>
            <p style="margin:2px 0 0 34px;font-size:12px;color:rgba(255,255,255,0.45);">${desc}</p>
          </td>
        </tr>
      `).join('')}
    </table>

    <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.3);text-align:center;">
      Questions? Contact us at <a href="mailto:urbanpl.app@gmail.com" style="color:#F5C518;text-decoration:none;">urbanpl.app@gmail.com</a>
    </p>
  `);
}

function promoEmail(subject: string, body: string) {
  return baseLayout(`
    <div style="white-space:pre-wrap;font-size:15px;color:rgba(255,255,255,0.8);line-height:1.7;">${body}</div>
    <div style="text-align:center;margin-top:28px;">
      <a href="https://www.theurbanpl.com" style="display:inline-block;background:#F5C518;color:#07080a;font-weight:800;font-size:14px;letter-spacing:2px;text-transform:uppercase;padding:14px 32px;border-radius:8px;text-decoration:none;">
        OPEN APP
      </a>
    </div>
  `);
}

// ── Send via Resend ────────────────────────────────────────────────────────────

async function sendEmail(to: string | string[], subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Resend error');
  return data;
}

// ── Handler ────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { type, to, firstName, lastName, refereeEmail, certLevel, experience, formats, game, tournament, teamName, subject, body, recipients } = await req.json();

    let result;

    switch (type) {
      case 'welcome':
        result = await sendEmail(to, 'Welcome to Urban PL ⚽', welcomeEmail(firstName));
        break;

      case 'game_booking':
        result = await sendEmail(to, `✅ Game Booking Confirmed — ${game?.location?.split(',')[0] || 'Pickup Game'}`, gameBookingEmail(firstName, game));
        break;

      case 'tournament_booking':
        result = await sendEmail(to, `🏆 Tournament Registered — ${tournament?.name}`, tournamentBookingEmail(firstName, tournament, teamName));
        break;

      case 'referee_application_received':
        result = await sendEmail(to, '⏳ Application Received — Urban PL Referee', refereeApplicationReceivedEmail(firstName));
        break;

      case 'referee_application':
        result = await sendEmail(
          'urbanpleague@gmail.com',
          `🧑‍⚖️ New Referee Application — ${firstName} ${lastName}`,
          refereeApplicationEmail(firstName, lastName, refereeEmail, certLevel, experience, formats),
        );
        break;

      case 'referee_approved':
        result = await sendEmail(to, '✅ You\'re Approved — Urban PL Referee', refereeApprovedEmail(firstName));
        break;

      case 'promo_blast': {
        // Admin blast — send to all recipients in batches of 50
        const emails: string[] = recipients || [];
        const batchSize = 50;
        let sent = 0;
        for (let i = 0; i < emails.length; i += batchSize) {
          const batch = emails.slice(i, i + batchSize);
          await sendEmail(batch, subject, promoEmail(subject, body));
          sent += batch.length;
        }
        result = { sent };
        break;
      }

      default:
        throw new Error(`Unknown email type: ${type}`);
    }

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('send-email error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

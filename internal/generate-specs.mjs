import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle,
  ShadingType, convertInchesToTwip, TableLayoutType,
} from 'docx';
import { writeFileSync } from 'fs';

const GOLD  = 'C9A84C';
const DARK  = '1A1A1A';
const GRAY  = '555555';
const WHITE = 'FFFFFF';
const GREEN = '4CAF50';
const RED   = 'F44336';

function h1(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD } },
    children: [new TextRun({ text, bold: true, size: 36, color: GOLD, font: 'Calibri' })],
  });
}

function h2(text) {
  return new Paragraph({
    spacing: { before: 320, after: 120 },
    children: [new TextRun({ text, bold: true, size: 26, color: DARK, font: 'Calibri' })],
  });
}

function h3(text) {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, bold: true, size: 22, color: GRAY, font: 'Calibri' })],
  });
}

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text, size: 20, font: 'Calibri', ...opts })],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    bullet: { level },
    spacing: { after: 60 },
    children: [new TextRun({ text, size: 20, font: 'Calibri' })],
  });
}

function code(text) {
  return new Paragraph({
    spacing: { after: 60 },
    shading: { type: ShadingType.SOLID, color: 'F4F4F4' },
    children: [new TextRun({ text, size: 18, font: 'Courier New', color: '333333' })],
  });
}

function spacer() {
  return new Paragraph({ text: '', spacing: { after: 120 } });
}

function makeTable(headers, rows, colWidths) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) =>
      new TableCell({
        shading: { type: ShadingType.SOLID, color: DARK },
        width: { size: colWidths[i], type: WidthType.PERCENTAGE },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({
          children: [new TextRun({ text: h, bold: true, color: GOLD, size: 18, font: 'Calibri' })],
        })],
      })
    ),
  });

  const dataRows = rows.map((row, ri) =>
    new TableRow({
      children: row.map((cell, ci) => {
        const isStatus = typeof cell === 'string' && (cell.startsWith('✅') || cell.startsWith('⏳') || cell.startsWith('⚠️'));
        const color = cell?.startsWith?.('✅') ? '1E5C1E' : cell?.startsWith?.('⏳') ? '5C3D1E' : DARK;
        return new TableCell({
          shading: { type: ShadingType.SOLID, color: ri % 2 === 0 ? 'FAFAFA' : 'F0F0F0' },
          width: { size: colWidths[ci], type: WidthType.PERCENTAGE },
          margins: { top: 60, bottom: 60, left: 120, right: 120 },
          children: [new Paragraph({
            children: [new TextRun({ text: String(cell ?? ''), size: 18, font: 'Calibri' })],
          })],
        });
      }),
    })
  );

  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });
}

// ── Build Document ────────────────────────────────────────────────────────────
const doc = new Document({
  creator: 'Urban PL',
  title: 'Urban PL — Technical Specification v1.0',
  description: 'Full technical specification for the Urban PL app',
  sections: [{
    properties: {
      page: {
        margin: {
          top: convertInchesToTwip(1),
          bottom: convertInchesToTwip(1),
          left: convertInchesToTwip(1.1),
          right: convertInchesToTwip(1.1),
        },
      },
    },
    children: [

      // ── Title Page ──
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 800, after: 200 },
        children: [new TextRun({ text: 'URBAN PL', bold: true, size: 64, color: GOLD, font: 'Calibri' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [new TextRun({ text: 'Technical Specification', size: 32, color: DARK, font: 'Calibri' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [new TextRun({ text: 'Version 1.0  ·  May 2026', size: 22, color: GRAY, font: 'Calibri' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 },
        children: [new TextRun({ text: 'theurbanpl.com', size: 22, color: GOLD, font: 'Calibri' })],
      }),
      spacer(),

      // ── Overview ──
      h1('1. Overview'),
      p('Urban PL is a pickup soccer league mobile app that turns casual games into a structured league experience — with verified referees, live match management, real-time stats, smart team balancing, and city rankings. Built for iOS with React Native and Expo, powered by Supabase as the backend.'),
      spacer(),

      // ── Tech Stack ──
      h1('2. Tech Stack'),
      makeTable(
        ['Layer', 'Technology', 'Version'],
        [
          ['Frontend', 'React Native + Expo (managed workflow)', 'Expo 54'],
          ['Backend', 'Supabase (PostgreSQL + Auth + Storage + Realtime)', 'Latest'],
          ['State Management', 'React Query (@tanstack/react-query)', 'v5'],
          ['Payments', 'Stripe (@stripe/stripe-react-native)', 'Latest'],
          ['Navigation', 'React Navigation (bottom tabs)', 'v6'],
          ['Maps', 'react-native-maps (native) / OpenStreetMap static (web)', '—'],
          ['Push Notifications', 'expo-notifications', 'v0.32'],
          ['Image Picker', 'expo-image-picker', 'v17'],
          ['Share Card', 'react-native-view-shot + expo-sharing', 'v5 / v55'],
          ['Build & Deploy', 'EAS (Expo Application Services)', '—'],
          ['Website', 'HTML/CSS static site on Netlify', '—'],
          ['Business Email', 'Zoho Mail (admin@theurbanpl.com)', 'Free tier'],
        ],
        [30, 50, 20]
      ),
      spacer(),

      // ── Credentials ──
      h1('3. Key Credentials & Endpoints'),
      makeTable(
        ['Item', 'Value'],
        [
          ['Supabase Project ID', 'zprtghdcmiavtoaltlld'],
          ['Supabase URL', 'https://zprtghdcmiavtoaltlld.supabase.co'],
          ['Edge Functions URL', 'https://zprtghdcmiavtoaltlld.supabase.co/functions/v1'],
          ['EAS Project ID', '6a6f69d9-82bf-4834-9704-0b3a087502fe'],
          ['iOS Bundle ID', 'com.urbanpl.app'],
          ['Apple Merchant ID', 'merchant.com.urbanpl.app'],
          ['GitHub Repo', 'https://github.com/mkavosi93/UrbanPL'],
          ['Website', 'https://www.theurbanpl.com'],
          ['Netlify URL', 'https://candid-platypus-4730b0.netlify.app'],
          ['Contact Email', 'admin@theurbanpl.com'],
          ['Stripe Mode', 'LIVE (pk_live_...)'],
          ['Domain Registrar', 'Namecheap → Netlify DNS'],
        ],
        [35, 65]
      ),
      spacer(),

      // ── Database ──
      h1('4. Database Schema (Supabase)'),
      makeTable(
        ['Table', 'Key Columns', 'Purpose'],
        [
          ['players', 'id, first_name, last_name, email, role, is_admin, rating, points, games_played, avatar_url, referee_id_url, referee_selfie_url, referee_approved', 'All users — players and referees'],
          ['games', 'id, location, format, kickoff_time, status, entry_fee, score_a, score_b, teams_balanced, latitude, longitude, completed_at', 'Pickup games'],
          ['game_players', 'game_id, player_id, team (A/B)', 'Player ↔ game junction'],
          ['game_player_stats', 'game_id, player_id, goals, yellow_cards, red_cards, won, is_goalkeeper, goals_conceded, verified', 'Per-player per-game stats'],
          ['game_referees', 'game_id, referee_id, status (accepted/pending), checked_in, checked_in_at', 'Referee assignments'],
          ['referee_ratings', 'game_id, referee_id, player_id, rating (1–5)', 'Player ratings of referees'],
          ['messages', 'id, game_id, player_id, text, created_at', 'Real-time per-game chat'],
          ['tournaments', 'id, name, format, status, kickoff_date, venue', 'Cups and tournaments'],
          ['tournament_teams', 'tournament_id, team_name, players', 'Cup team registrations'],
          ['payments', 'player_id, game_id, amount, stripe_pi_id, status', 'Stripe payment records'],
          ['referee_payouts', 'referee_id, game_id, amount, paid, paid_at', 'Referee payout tracking'],
          ['app_config', 'key, value', 'App configuration (e.g. referee bonus threshold)'],
        ],
        [20, 50, 30]
      ),
      spacer(),

      // ── Project Structure ──
      h1('5. Project Structure'),
      code('UrbanPL/'),
      code('├── App.js                          # Root — providers, navigation'),
      code('├── app.json                        # Expo config, Apple Merchant ID, plugins'),
      code('├── src/'),
      code('│   ├── screens/'),
      code('│   │   ├── FeedScreen.js           # Game feed, join, match reports, share card'),
      code('│   │   ├── AdminScreen.js          # Admin panel'),
      code('│   │   ├── ProfileScreen.js        # Player profile + stats'),
      code('│   │   ├── RankingsScreen.js       # City leaderboard'),
      code('│   │   ├── CupsScreen.js           # Tournaments'),
      code('│   │   ├── RefereeScreen.js        # Referee portal'),
      code('│   │   └── auth/'),
      code('│   │       ├── SignInScreen.js'),
      code('│   │       ├── SignUpScreen.js'),
      code('│   │       └── RefereeSignUpScreen.js'),
      code('│   ├── components/'),
      code('│   │   ├── GameChat.js             # Real-time per-game chat'),
      code('│   │   ├── GameMap.js              # Web map (OpenStreetMap)'),
      code('│   │   ├── GameMap.native.js       # Native map (Apple Maps)'),
      code('│   │   ├── StripeWrapper.native.js # Live Stripe provider'),
      code('│   │   └── StripeWrapper.js        # Web no-op'),
      code('│   ├── context/'),
      code('│   │   ├── AuthContext.js'),
      code('│   │   └── LanguageContext.js      # i18n (EN/ES)'),
      code('│   └── lib/'),
      code('│       ├── supabase.js'),
      code('│       └── notifications.js'),
      code('├── supabase/functions/'),
      code('│   └── create-payment-intent/      # Stripe Edge Function (live)'),
      code('└── docs/'),
      code('    ├── index.html                  # Marketing website'),
      code('    └── privacy-policy.html'),
      spacer(),

      // ── Features ──
      h1('6. Feature Inventory'),

      h2('6.1 Player App'),
      makeTable(
        ['Feature', 'Status'],
        [
          ['Sign up / Sign in (Supabase Auth)', '✅ Complete'],
          ['Game feed with filters (format, free, today)', '✅ Complete'],
          ['Join games — free (instant) or paid (Stripe)', '✅ Complete'],
          ['Apple Pay in payment sheet', '✅ Code ready — needs Apple Dev cert'],
          ['Real map on game cards (OpenStreetMap / Apple Maps)', '✅ Complete'],
          ['Get Directions (Apple Maps / Google Maps)', '✅ Complete'],
          ['Upcoming fixtures with team lineup + ratings', '✅ Complete'],
          ['Player ratings shown in lineups', '✅ Complete'],
          ['Per-game real-time chat (Supabase Realtime)', '✅ Complete'],
          ['Match reports (score, goals, cards, points)', '✅ Complete'],
          ['Strava-style match share card (photo bg, image share)', '✅ Complete'],
          ['Referee rating (1–5 stars post-match)', '✅ Complete'],
          ['Verify match stats', '✅ Complete'],
          ['City rankings leaderboard', '✅ Complete'],
          ['Cups & tournaments', '✅ Complete'],
          ['Push notifications (game reminders)', '✅ Complete'],
          ['Share games / cups (native share sheet)', '✅ Complete'],
          ['English / Spanish i18n', '✅ Complete'],
          ['Onboarding screen', '✅ Complete'],
          ['Player profile with stats + avatar', '✅ Complete'],
        ],
        [75, 25]
      ),
      spacer(),

      h2('6.2 Referee Portal'),
      makeTable(
        ['Feature', 'Status'],
        [
          ['Referee signup (ID photo + front-camera selfie verification)', '✅ Complete'],
          ['Feed tab — browse & accept/decline games', '✅ Complete'],
          ['Upcoming Fixtures tab (renamed from Bookings)', '✅ Complete'],
          ['Fixture Detail Modal — lineup with ratings + live countdown', '✅ Complete'],
          ['Attendance taking (unlocks 15 minutes before kickoff)', '✅ Complete'],
          ['Hit Start Match — launches live match dashboard', '✅ Complete'],
          ['Live match: 25 + 5 + 25 min timer (pause/resume)', '✅ Complete'],
          ['Live goals + yellow/red cards per player', '✅ Complete'],
          ['Half-time break screen', '✅ Complete'],
          ['Final score entry + stats save + game close', '✅ Complete'],
          ['Check-in button (within 1 hour of kickoff)', '✅ Complete'],
          ['$50 bonus tracker (after 5 completed games)', '✅ Complete'],
          ['Referee rankings leaderboard', '✅ Complete'],
          ['Game history + player ratings received', '✅ Complete'],
        ],
        [75, 25]
      ),
      spacer(),

      h2('6.3 Admin Panel'),
      makeTable(
        ['Feature', 'Status'],
        [
          ['Dashboard — recent games + referee status pills', '✅ Complete'],
          ['Create games (auto-geocoded via Nominatim API)', '✅ Complete'],
          ['Create cups / tournaments', '✅ Complete'],
          ['Payments tab — income list', '✅ Complete'],
          ['Referee payouts + Mark Paid', '✅ Complete'],
          ['View referee ID photo (60-min signed Supabase URL)', '✅ Complete'],
          ['View referee selfie photo', '✅ Complete'],
          ['Approve / reject referee applications', '✅ Complete'],
          ['Admin visible in all game chats', '✅ Complete'],
          ['Smart team balancing (snake draft by rating)', '✅ Complete'],
          ['Auto team balance 2 hours before kickoff (SQL DEFINER function)', '✅ Complete'],
        ],
        [75, 25]
      ),
      spacer(),

      h2('6.4 Infrastructure & Integrations'),
      makeTable(
        ['Item', 'Status'],
        [
          ['Stripe live payments (create-payment-intent Edge Function)', '✅ Live'],
          ['Apple Pay configured in payment sheet', '✅ Code ready — pending Apple cert'],
          ['Private Supabase storage bucket (referee IDs/selfies)', '✅ Complete'],
          ['Marketing website (theurbanpl.com on Netlify)', '✅ Live'],
          ['Business email (admin@theurbanpl.com via Zoho Mail)', '✅ Live'],
          ['Domain DNS (Namecheap → Netlify nameservers)', '✅ Live'],
          ['OG tags + canonical URL on website', '✅ Complete'],
        ],
        [75, 25]
      ),
      spacer(),

      // ── Points System ──
      h1('7. Points System'),
      makeTable(
        ['Event', 'Points'],
        [
          ['Win', '+3'],
          ['Each goal scored', '+1'],
          ['Goalkeeper — clean sheet', '+3'],
          ['Goalkeeper — 1 goal conceded', '+1'],
          ['Yellow card', '−1'],
          ['Red card', '−3'],
          ['Minimum total', '0 (never negative)'],
        ],
        [70, 30]
      ),
      spacer(),

      // ── Security ──
      h1('8. Security & Privacy'),
      bullet('Referee ID photos stored in private Supabase Storage bucket (admin-read only via signed URLs)'),
      bullet('Referee selfie taken with front camera only — no gallery upload (fraud prevention)'),
      bullet('Admin approval gate before referees can be assigned to games'),
      bullet('Stripe secret key stored as Supabase Edge Function secret (never in client code)'),
      bullet('RLS (Row Level Security) policies on all Supabase tables'),
      bullet('Privacy Policy hosted at theurbanpl.com/privacy-policy.html'),
      spacer(),

      // ── Pending ──
      h1('9. Pending — Before App Store Launch'),
      makeTable(
        ['Task', 'Notes'],
        [
          ['Apple Developer Program enrollment ($99/yr)', 'Locked out — try again after 24hr reset'],
          ['Apple Merchant ID certificate → upload to Stripe', 'Needed to activate Apple Pay'],
          ['EAS iOS build', 'Run: eas build --platform ios --profile preview'],
          ['Test end-to-end on real iPhone', 'Payments, chat, push notifications, full flow'],
          ['App Store Connect listing', 'Screenshots, description, keywords, category'],
          ['App Store screenshots', '6.5" and 5.5" formats required by Apple'],
          ['Submit for Apple review', 'Typically 1–3 business days'],
        ],
        [40, 60]
      ),
      spacer(),

      // ── Run Commands ──
      h1('10. Developer Commands'),
      h3('Start Development Server'),
      code('cd "C:\\Users\\mamad\\OneDrive\\UrbanPL\\UrbanPL Code"'),
      code('npx expo start --clear          # Browser (press w)'),
      code('npx expo start --lan --clear    # Phone on same WiFi (scan QR)'),
      spacer(),
      h3('Deploy Edge Function'),
      code('npx supabase login'),
      code('npx supabase functions deploy create-payment-intent --no-verify-jwt'),
      spacer(),
      h3('iOS Build'),
      code('eas build --platform ios --profile preview'),
      spacer(),
      h3('Push to GitHub'),
      code('git add -A && git commit -m "message" && git push origin master'),
      spacer(),

      // ── Footer ──
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 600 },
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: GOLD } },
        children: [
          new TextRun({ text: 'Urban PL  ·  theurbanpl.com  ·  admin@theurbanpl.com', size: 18, color: GRAY, font: 'Calibri' }),
        ],
      }),
    ],
  }],
});

Packer.toBuffer(doc).then(buffer => {
  writeFileSync('Urban_PL_Technical_Specs.docx', buffer);
  console.log('✅ Word document created: Urban_PL_Technical_Specs.docx');
});

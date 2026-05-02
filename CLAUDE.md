# Urban PL — Claude Context File

## What This App Is
Urban PL is a **pickup soccer league mobile app** built with React Native (Expo) + Supabase.
Players join games, referees manage matches, admins create games/cups.
Target platform: **iOS first** (App Store submission planned).

---

## Tech Stack
| Layer | Technology |
|---|---|
| Frontend | React Native + Expo (managed workflow) |
| Backend | Supabase (PostgreSQL + Auth + Storage + Edge Functions) |
| State | React Query (`@tanstack/react-query`) |
| Payments | Stripe (`@stripe/stripe-react-native`) |
| Navigation | React Navigation (bottom tabs) |
| Maps | `react-native-maps` (native) / OpenStreetMap static image (web) |
| Notifications | `expo-notifications` |
| Build/Deploy | EAS (Expo Application Services) |

---

## Key Credentials & IDs
- **Supabase Project ID:** `zprtghdcmiavtoaltlld`
- **Supabase URL:** `https://zprtghdcmiavtoaltlld.supabase.co`
- **Supabase Functions URL:** `https://zprtghdcmiavtoaltlld.supabase.co/functions/v1`
- **EAS Project ID:** `6a6f69d9-82bf-4834-9704-0b3a087502fe`
- **iOS Bundle ID:** `com.urbanpl.app`
- **GitHub Repo:** `https://github.com/mkavosi93/UrbanPL`
- **Website:** `https://www.theurbanpl.com` (Netlify — docs/ folder)
- **Netlify URL:** `https://candid-platypus-4730b0.netlify.app`
- **Privacy Policy URL:** `https://www.theurbanpl.com/privacy-policy.html`
- **Contact Email:** `urbanpl.app@gmail.com`
- **Stripe keys:** stored in `APP_STORE_NOTES.txt` (never commit secret key)
- **Stripe secret key:** stored as Supabase secret `STRIPE_SECRET_KEY`

---

## Project Structure
```
UrbanPL/
├── App.js                          # Root — wraps app in providers
├── app.json                        # Expo config (bundle ID, plugins)
├── metro.config.js                 # Mocks Stripe on web
├── src/
│   ├── screens/
│   │   ├── FeedScreen.js           # Game feed, join, match reports
│   │   ├── AdminScreen.js          # Admin panel (games, cups, payments)
│   │   ├── ProfileScreen.js        # Player profile + stats
│   │   ├── RankingsScreen.js       # Leaderboard (excludes referees)
│   │   ├── CupsScreen.js           # Tournaments/cups
│   │   ├── RefereeScreen.js        # Referee platform (fixtures, live match)
│   │   └── auth/
│   │       ├── SignInScreen.js
│   │       ├── SignUpScreen.js      # Player signup
│   │       └── RefereeSignUpScreen.js
│   ├── components/
│   │   ├── GameMap.js              # Web map (OpenStreetMap static image)
│   │   ├── GameMap.native.js       # Native map (react-native-maps)
│   │   ├── StripeWrapper.js        # Web no-op wrapper
│   │   └── StripeWrapper.native.js # Native StripeProvider
│   ├── mocks/
│   │   └── stripe-mock.js          # Web mock for @stripe/stripe-react-native
│   ├── context/
│   │   ├── AuthContext.js          # Auth state, player data, signOut
│   │   └── LanguageContext.js      # i18n
│   ├── lib/
│   │   ├── supabase.js             # Supabase client
│   │   └── notifications.js        # Push notification helpers
│   └── navigation/                 # Tab + stack navigation
├── supabase/
│   └── functions/
│       └── create-payment-intent/  # Stripe Edge Function
├── docs/
│   └── privacy-policy.html         # Privacy policy (also on Netlify)
└── APP_STORE_NOTES.txt             # Keys, URLs, App Store checklist
```

---

## Database Tables (Supabase)
| Table | Purpose |
|---|---|
| `players` | All users — players and referees. Has `is_admin`, `role`, `avatar_url`, `rating` |
| `games` | Pickup games. Has `status`, `format`, `kickoff_time`, `entry_fee`, `latitude`, `longitude` |
| `game_players` | Junction: player ↔ game. Has `team` (A/B) |
| `game_player_stats` | Per-player stats per game: goals, cards, `verified` boolean |
| `game_referees` | Referee ↔ game assignments. Has `status` (accepted/pending) |
| `referee_ratings` | Player ratings for referees (1-5 stars) per game |
| `tournaments` | Cups/tournaments |
| `tournament_teams` | Teams registered for cups |
| `payments` | Stripe payment records (player, game, amount, stripe_pi_id) |
| `referee_payouts` | Referee payout tracking (paid boolean, paid_at) |
| `app_config` | Key-value config (e.g. `referee_bonus_threshold`) |

---

## Features Built
- ✅ Player signup / login (Supabase Auth, bcrypt passwords)
- ✅ Referee signup (with ID photo upload, 18+ age check)
- ✅ Game feed with filters (format, free, today)
- ✅ Join games (free = instant, paid = Stripe payment sheet)
- ✅ Stripe payments — `create-payment-intent` Edge Function deployed
- ✅ Payment records saved to `payments` table
- ✅ Real map on game cards (OpenStreetMap web / Apple Maps native)
- ✅ Auto-geocoding when admin creates a game (Nominatim API)
- ✅ Get Directions button (Apple Maps / Google Maps)
- ✅ Smart team balancing (snake draft by rating, 2h before kickoff)
- ✅ Upcoming fixtures (horizontal scroll, team lineup reveal)
- ✅ Push notifications (game reminders via expo-notifications)
- ✅ Share games / cups (native share sheet)
- ✅ Match reports (score, timeline, points, referee rating, verify, share)
- ✅ Live match management (attendance → 25+5+25 timer → live stats)
- ✅ Referee platform (fixtures, live match panel, $50 bonus tracker)
- ✅ Rankings leaderboard (referees excluded)
- ✅ Admin panel (dashboard, availability heatmap, new game, new cup, payments)
- ✅ Admin payments tab (income list, referee payout tracker with Mark Paid)
- ✅ Pull-to-refresh on profile tab
- ✅ Sign out button in feed
- ✅ Privacy policy (Netlify hosted)
- ✅ GitHub Pages privacy policy
- ✅ EAS configured

---

## Pending / To Do
- ⏳ Enroll in Apple Developer Program ($99/yr) → developer.apple.com
- ⏳ Run EAS iOS build: `eas build --platform ios --profile preview`
- ⏳ Test end-to-end on phone (home WiFi: `npx expo start --lan`)
- ⏳ App Store screenshots
- ⏳ App Store Connect listing (description, keywords, category)

## Recently Completed
- ✅ Private referee-ids Supabase storage bucket (RLS: admin-read, referee-upload only)
- ✅ Admin "View ID" button in Ref Payouts tab (60-min signed URL)
- ✅ Auto team balancing via `apply_team_assignments` Supabase SECURITY DEFINER function
- ✅ Lineup card in UpcomingFixtures (expands 2h before kickoff)
- ✅ Fixed snake draft algorithm (even split regardless of equal ratings)
- ✅ Referee accepted/pending status shown on Admin Dashboard game rows
- ✅ Splash screen + Onboarding screen
- ✅ i18n (English/Spanish)

---

## How to Run
```bash
# Install dependencies
npm install

# Run in browser (for quick testing)
npx expo start --clear
# then press 'w'

# Run on phone via LAN (home WiFi only — corporate blocks it)
npx expo start --lan --clear

# Deploy Edge Function
npx supabase functions deploy create-payment-intent --no-verify-jwt

# Push to GitHub
git add -A && git commit -m "message" && git push origin master

# iOS build (requires Apple Developer account)
eas build --platform ios --profile preview
```

---

## Important Notes
- **Stripe is native-only** — web uses mock via `metro.config.js`
- **Referees** have `role = 'Referee'` in players table — excluded from rankings
- **Admins** have `is_admin = true` in players table
- **Team balancing** runs automatically 2 hours before kickoff
- **Match reports** appear 5 minutes after `completed_at` timestamp
- **Avatar uploads** use Supabase Storage bucket named `avatars` (public bucket)
- **$50 referee bonus** triggers after 5 completed games

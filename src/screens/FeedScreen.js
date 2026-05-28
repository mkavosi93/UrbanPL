import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, ScrollView, Modal, Pressable,
  Share, Image, Alert, TextInput, KeyboardAvoidingView, Platform as RNPlatform,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
const useStripe = Platform.OS !== 'web'
  ? require('@stripe/stripe-react-native').useStripe
  : () => ({ initPaymentSheet: async () => {}, presentPaymentSheet: async () => ({}) });
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { scheduleGameReminders } from '../lib/notifications';
import GameMap from '../components/GameMap';
import GameChat from '../components/GameChat';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';

const SUPABASE_FUNCTIONS_URL = 'https://zprtghdcmiavtoaltlld.supabase.co/functions/v1';
import { colors, spacing, radius } from '../theme';

// ─── Smart team balancer ──────────────────────────────────────────────────────
// Priority: each team gets at least one GK or Versatile player first,
// then remaining outfield players are distributed by rating (snake draft).
function snakeDraft(players) {
  // Sort by rating descending so best players are spread first
  const sorted = [...players].sort((a, b) => (b.rating ?? 2.5) - (a.rating ?? 2.5));

  // Snake draft: A, B, B, A, A, B, B, A ...
  // Pattern by index: 0→A, 1→B, 2→B, 3→A, 4→A, 5→B, ...
  // Simpler: assign to whichever team has fewer players; ties go to A first then B alternating
  const assignment = {};
  let countA = 0;
  let countB = 0;

  sorted.forEach(p => {
    if (countA <= countB) {
      assignment[p.player_id] = 'A';
      countA++;
    } else {
      assignment[p.player_id] = 'B';
      countB++;
    }
  });

  return assignment;
}

// ─── Check and auto-balance games within 2 hours ─────────────────────────────
async function checkAndBalanceGames(playerId) {
  const now = new Date();
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  // Fetch upcoming joined games that aren't balanced yet
  const { data: myGames } = await supabase
    .from('game_players')
    .select('game_id, games(id, kickoff_time, teams_balanced, status)')
    .eq('player_id', playerId);

  if (!myGames) return;

  for (const row of myGames) {
    const game = row.games;
    if (!game || game.teams_balanced || game.status === 'completed') continue;

    const kickoff = new Date(game.kickoff_time);
    if (kickoff <= twoHoursFromNow && kickoff >= now) {
      // Time to balance! Fetch all players in this game with ratings
      const { data: gamePlayers } = await supabase
        .from('game_players')
        .select('player_id, players(rating, role)')
        .eq('game_id', game.id);

      if (!gamePlayers || gamePlayers.length < 2) continue;

      const playersWithRating = gamePlayers.map(gp => ({
        player_id: gp.player_id,
        rating: gp.players?.rating ?? 2.5,
        role: gp.players?.role || 'Outfield',
      }));

      const assignment = snakeDraft(playersWithRating);

      // Use SECURITY DEFINER RPC so writes bypass RLS
      const assignments = Object.entries(assignment).map(([player_id, team]) => ({ player_id, team }));
      await supabase.rpc('apply_team_assignments', {
        p_game_id: game.id,
        p_assignments: assignments,   // pass array directly — supabase serialises to jsonb
      });
    }
  }
}

async function fetchMyFixtures(playerId) {
  // My joined games — now also fetches team assignment and all players' teams
  const { data: myGames } = await supabase
    .from('game_players')
    .select('game_id, team, checked_in, games(id, format, kickoff_time, location, total_spots, entry_fee, status, teams_balanced)')
    .eq('player_id', playerId)
    .order('game_id');

  // My tournament registrations
  const { data: myTournaments } = await supabase
    .from('tournament_teams')
    .select('tournament_id, tournaments(id, name, format, kickoff_date, venue, entry_fee, status)')
    .contains('player_ids', [playerId]);

  const fixtures = [];
  const now = new Date();

  const gameIds = myGames?.map(r => r.game_id).filter(Boolean) || [];
  let allTeams = {};
  let refereeMap = {};

  if (gameIds.length > 0) {
    // Fetch all players' team assignments
    const { data: teamData } = await supabase
      .from('game_players')
      .select('game_id, player_id, team, players(first_name, last_name, name, role, rating, avatar_url)')
      .in('game_id', gameIds);
    teamData?.forEach(gp => {
      if (!allTeams[gp.game_id]) allTeams[gp.game_id] = [];
      allTeams[gp.game_id].push(gp);
    });

    // Fetch accepted referees for these games
    const { data: refData } = await supabase
      .from('game_referees')
      .select('game_id, players(first_name, last_name, name)')
      .in('game_id', gameIds)
      .eq('status', 'accepted');
    refData?.forEach(r => {
      if (r.players) refereeMap[r.game_id] = r.players;
    });
  }

  myGames?.forEach(row => {
    if (row.games && new Date(row.games.kickoff_time) >= now) {
      fixtures.push({
        type: 'game',
        data: row.games,
        myTeam: row.team,
        checkedIn: row.checked_in ?? false,
        allPlayers: allTeams[row.game_id] || [],
        referee: refereeMap[row.game_id] || null,
      });
    }
  });

  myTournaments?.forEach(row => {
    if (row.tournaments && new Date(row.tournaments.kickoff_date) >= now) {
      fixtures.push({ type: 'tournament', data: row.tournaments });
    }
  });

  fixtures.sort((a, b) => {
    const dateA = new Date(a.type === 'game' ? a.data.kickoff_time : a.data.kickoff_date);
    const dateB = new Date(b.type === 'game' ? b.data.kickoff_time : b.data.kickoff_date);
    return dateA - dateB;
  });

  return fixtures;
}

// ─── Formation Pitch ─────────────────────────────────────────────────────────
function PitchPlayerNode({ gp, myPlayerId }) {
  const p = gp?.players;
  const name = p ? ([p.first_name, p.last_name].filter(Boolean).join(' ') || p.name || '?') : '?';
  const firstName = name.split(' ')[0];
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const isYou = gp.player_id === myPlayerId;
  return (
    <View style={pitchStyles.pNode}>
      <View style={[pitchStyles.pCircle, isYou && pitchStyles.pCircleYou]}>
        {p?.avatar_url
          ? <Image source={{ uri: p.avatar_url }} style={pitchStyles.pAvatar} />
          : <Text style={pitchStyles.pInitials}>{initials}</Text>
        }
      </View>
      {isYou && <View style={pitchStyles.youBadge}><Text style={pitchStyles.youTxt}>YOU</Text></View>}
      <Text style={pitchStyles.pName} numberOfLines={1}>{firstName}</Text>
    </View>
  );
}

function buildFormationRows(players) {
  const sorted = [...players].sort((a, b) => {
    const aGK = a.players?.role === 'Goalkeeper' ? -1 : 1;
    const bGK = b.players?.role === 'Goalkeeper' ? -1 : 1;
    return aGK - bGK;
  });
  const n = sorted.length;
  let layout;
  if (n <= 3)      layout = [1, n - 1];
  else if (n === 4) layout = [1, 1, 2];
  else if (n === 5) layout = [1, 2, 2];
  else if (n === 6) layout = [1, 2, 2, 1];
  else              layout = [1, 2, 2, 2]; // 7v7
  const rows = [];
  let i = 0;
  for (const count of layout) {
    const row = sorted.slice(i, i + count);
    if (row.length > 0) rows.push(row);
    i += count;
  }
  if (i < sorted.length) rows[rows.length - 1].push(...sorted.slice(i));
  return rows;
}

function FormationPitch({ teamDark, teamBright, format, myPlayerId, myTeam, refName }) {
  const rowsA = buildFormationRows(teamDark);
  const rowsB = [...buildFormationRows(teamBright)].reverse(); // GK at bottom for lower half

  return (
    <View style={pitchStyles.pitch}>
      {/* Team headers */}
      <View style={pitchStyles.teamHeaders}>
        <Text style={pitchStyles.teamHeaderDark}>🖤 Dark</Text>
        <View style={pitchStyles.formatBadge}>
          <Text style={pitchStyles.formatBadgeTxt}>{format}</Text>
        </View>
        <Text style={pitchStyles.teamHeaderBright}>White 🤍</Text>
      </View>

      {/* Pitch field */}
      <View style={pitchStyles.field}>
        {/* Top goal box */}
        <View style={pitchStyles.goalBoxTop} />

        {/* Team Dark — top half */}
        <View style={pitchStyles.half}>
          {rowsA.map((row, i) => (
            <View key={i} style={pitchStyles.fRow}>
              {row.map(gp => <PitchPlayerNode key={gp.player_id} gp={gp} myPlayerId={myPlayerId} />)}
            </View>
          ))}
        </View>

        {/* Center line + circle */}
        <View style={pitchStyles.centerLineWrap}>
          <View style={pitchStyles.centerLine} />
          <View style={pitchStyles.centerCircle} />
        </View>

        {/* Team Bright — bottom half */}
        <View style={pitchStyles.half}>
          {rowsB.map((row, i) => (
            <View key={i} style={pitchStyles.fRow}>
              {row.map(gp => <PitchPlayerNode key={gp.player_id} gp={gp} myPlayerId={myPlayerId} />)}
            </View>
          ))}
        </View>

        {/* Bottom goal box */}
        <View style={pitchStyles.goalBoxBottom} />
      </View>

      {/* My team + referee strip */}
      <View style={pitchStyles.bottomStrip}>
        {myTeam && (
          <Text style={pitchStyles.myTeamTxt}>
            {myTeam === 'A' ? '🖤 You are on Dark' : '🤍 You are on White'}
          </Text>
        )}
        {refName && (
          <Text style={pitchStyles.refTxt}>🟨 Referee: {refName}</Text>
        )}
      </View>
    </View>
  );
}

const pitchStyles = StyleSheet.create({
  pitch: {
    borderRadius: 14, overflow: 'hidden',
    marginTop: 14, marginBottom: 4,
    backgroundColor: '#0e2a0e',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  teamHeaders: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  teamHeaderDark:  { color: '#ddd', fontSize: 11, fontWeight: '700', flex: 1 },
  teamHeaderBright:{ color: '#ddd', fontSize: 11, fontWeight: '700', flex: 1, textAlign: 'right' },
  formatBadge: {
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 100,
    paddingHorizontal: 10, paddingVertical: 3,
  },
  formatBadgeTxt: { color: '#fff', fontSize: 10, fontWeight: '700' },
  field: {
    marginHorizontal: 10, marginBottom: 0,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: 6, overflow: 'hidden',
  },
  goalBoxTop: {
    height: 14, width: '40%', alignSelf: 'center',
    borderWidth: 1.5, borderTopWidth: 0, borderColor: 'rgba(255,255,255,0.22)',
    borderBottomLeftRadius: 4, borderBottomRightRadius: 4,
  },
  goalBoxBottom: {
    height: 14, width: '40%', alignSelf: 'center',
    borderWidth: 1.5, borderBottomWidth: 0, borderColor: 'rgba(255,255,255,0.22)',
    borderTopLeftRadius: 4, borderTopRightRadius: 4,
  },
  half: { paddingVertical: 10, minHeight: 90 },
  fRow: {
    flexDirection: 'row', justifyContent: 'space-evenly',
    marginBottom: 8,
  },
  centerLineWrap: { alignItems: 'center', height: 1, position: 'relative', marginVertical: 10 },
  centerLine: {
    position: 'absolute', left: 0, right: 0, height: 1.5,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  centerCircle: {
    width: 48, height: 48, borderRadius: 24,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: 'transparent', marginTop: -24,
  },
  // Player node
  pNode: { alignItems: 'center', width: 54 },
  pCircle: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#1c3a1c',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  pCircleYou: { borderColor: colors.gold, borderWidth: 2.5 },
  pAvatar: { width: 42, height: 42, borderRadius: 21 },
  pInitials: { color: '#fff', fontSize: 13, fontWeight: '700' },
  youBadge: {
    backgroundColor: colors.gold, borderRadius: 4,
    paddingHorizontal: 4, paddingVertical: 1, marginTop: 2,
  },
  youTxt: { fontSize: 7, fontWeight: '900', color: '#000', letterSpacing: 0.5 },
  pName: { color: 'rgba(255,255,255,0.8)', fontSize: 9, marginTop: 3, textAlign: 'center' },
  // Bottom strip
  bottomStrip: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 8, marginTop: 4,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
  },
  myTeamTxt: { color: colors.gold, fontSize: 11, fontWeight: '700' },
  refTxt: { color: '#aaa', fontSize: 11 },
});

function FixtureDetailModal({ fixture, visible, onClose, onWithdraw, onCheckIn, playerId, playerName, isAdmin, t }) {
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  // Sync local state whenever the fixture changes (different game opened)
  useEffect(() => {
    setCheckedIn(fixture?.checkedIn ?? false);
  }, [fixture?.data?.id, fixture?.checkedIn]);

  if (!fixture) return null;
  const isGame = fixture.type === 'game';
  const data = fixture.data;
  const date = new Date(isGame ? data.kickoff_time : data.kickoff_date);
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const teamsBalanced = isGame && data.teams_balanced;
  const allPlayers = fixture.allPlayers || [];
  const teamDark   = allPlayers.filter(gp => gp.team === 'A');
  const teamBright = allPlayers.filter(gp => gp.team === 'B');
  const myTeam = fixture.myTeam;
  const referee = fixture.referee;
  const refName = referee
    ? [referee.first_name, referee.last_name].filter(Boolean).join(' ') || referee.name
    : null;

  // Check-in window: within 60 mins before kickoff, up to 30 mins after
  const minsUntil = isGame ? (new Date(data.kickoff_time) - new Date()) / (1000 * 60) : Infinity;
  const showCheckIn = isGame && minsUntil <= 60 && minsUntil > -30;

  async function handleCheckInPress() {
    if (checkingIn || checkedIn) return;
    setCheckingIn(true);
    const success = await onCheckIn?.(fixture);
    if (success) setCheckedIn(true);
    setCheckingIn(false);
  }

  // Determine refund warning label for the withdraw button
  const hoursUntil = minsUntil / 60;
  const withinSixHours = isGame && hoursUntil <= 6;
  const withdrawLabel = withinSixHours ? '🚫 Withdraw (No Refund)' : 'Withdraw from Game';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.modalSheet} onPress={e => e.stopPropagation()}>
          {/* Handle bar */}
          <View style={styles.modalHandle} />

          {/* Icon + Title */}
          <View style={styles.modalHeader}>
            <View style={styles.modalIconCircle}>
              <Text style={{ fontSize: 32 }}>{isGame ? '⚽' : '🏆'}</Text>
            </View>
            <Text style={styles.modalTitle}>
              {isGame ? data.location?.split(',')[0] : data.name}
            </Text>
            <View style={styles.modalBadge}>
              <Text style={styles.modalBadgeText}>{isGame ? 'Game' : 'Cup'}</Text>
            </View>
          </View>

          {/* Details */}
          <View style={styles.modalDetails}>
            <View style={styles.modalRow}>
              <Text style={styles.modalRowIcon}>📅</Text>
              <View>
                <Text style={styles.modalRowLabel}>{t('feed.dateTime')}</Text>
                <Text style={styles.modalRowValue}>{dateStr}</Text>
                <Text style={styles.modalRowValue}>{timeStr}</Text>
              </View>
            </View>

            <View style={styles.modalRow}>
              <Text style={styles.modalRowIcon}>📍</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalRowLabel}>{t('feed.location')}</Text>
                <Text style={styles.modalRowValue}>{isGame ? data.location : data.venue}</Text>
              </View>
            </View>

            <View style={styles.modalRow}>
              <Text style={styles.modalRowIcon}>⚽</Text>
              <View>
                <Text style={styles.modalRowLabel}>{t('feed.format')}</Text>
                <Text style={styles.modalRowValue}>{data.format}</Text>
              </View>
            </View>

            <View style={styles.modalRow}>
              <Text style={styles.modalRowIcon}>💰</Text>
              <View>
                <Text style={styles.modalRowLabel}>{t('feed.entryFee')}</Text>
                <Text style={styles.modalRowValue}>
                  {data.entry_fee > 0 ? `$${data.entry_fee}` : t('feed.free')}
                </Text>
              </View>
            </View>

            {isGame && (
              <View style={styles.modalRow}>
                <Text style={styles.modalRowIcon}>👥</Text>
                <View>
                  <Text style={styles.modalRowLabel}>{t('feed.totalSpots')}</Text>
                  <Text style={styles.modalRowValue}>{data.total_spots} {t('feed.total')}</Text>
                </View>
              </View>
            )}
          </View>

          {/* Team Lineups — Formation Pitch */}
          {isGame && teamsBalanced && (teamDark.length > 0 || teamBright.length > 0) && (
            <View>
              <Text style={styles.teamsSectionTitle}>⚖️ Line-ups</Text>
              <FormationPitch
                teamDark={teamDark}
                teamBright={teamBright}
                format={data.format}
                myPlayerId={playerId}
                myTeam={myTeam}
                refName={refName}
              />
            </View>
          )}

          {isGame && data.status === 'open' && (
            <View style={styles.confirmNoticeBox}>
              <Text style={styles.confirmNoticeIcon}>⚠️</Text>
              <Text style={styles.confirmNoticeText}>
                This game is subject to reaching a minimum of 10 players and a confirmed referee before it's officially confirmed.
              </Text>
            </View>
          )}

          {isGame && !teamsBalanced && (
            <View style={styles.teamsSection}>
              <Text style={styles.teamsPendingText}>
                ⏳ Line-ups will be set 2 hours before kickoff
              </Text>
              {refName && (
                <View style={[styles.refRow, { marginTop: spacing.sm }]}>
                  <Text style={styles.refRowIcon}>🟨</Text>
                  <Text style={styles.refRowLabel}>Referee</Text>
                  <Text style={styles.refRowName}>{refName}</Text>
                </View>
              )}
            </View>
          )}

          {/* Check-in button — within 1 hour of kickoff */}
          {showCheckIn && (
            checkedIn ? (
              <View style={styles.playerCheckedInBadge}>
                <Text style={styles.playerCheckedInText}>✅ You're checked in!</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.playerCheckInBtn, checkingIn && { opacity: 0.7 }]}
                onPress={handleCheckInPress}
                disabled={checkingIn}
              >
                {checkingIn
                  ? <ActivityIndicator color={colors.dark} size="small" />
                  : <Text style={styles.playerCheckInBtnText}>📍 I'm Here!</Text>
                }
              </TouchableOpacity>
            )
          )}

          {/* Withdraw button — games only */}
          {isGame && onWithdraw && (
            <TouchableOpacity
              style={[styles.withdrawBtn, withinSixHours && styles.withdrawBtnNoRefund]}
              onPress={() => onWithdraw(fixture)}
            >
              <Text style={styles.withdrawBtnText}>{withdrawLabel}</Text>
            </TouchableOpacity>
          )}

          {/* Chat button — games only */}
          {isGame && (
            <TouchableOpacity style={styles.chatBtn} onPress={() => setChatOpen(true)}>
              <Text style={styles.chatBtnText}>💬 Game Chat</Text>
            </TouchableOpacity>
          )}

          {/* Community Guidelines */}
          {isGame && (
            <View style={styles.guidelinesBox}>
              <Text style={styles.guidelinesTitle}>COMMUNITY GUIDELINES</Text>
              {[
                { icon: '⏰', title: 'Arrive Ready', body: "Kick-off waits for no one. Be warmed up and on the pitch on time." },
                { icon: '🚫', title: 'Zero Drama', body: "Disputes happen — disrespect doesn't. Any fighting = instant ban." },
                { icon: '📸', title: 'Real Profile, Real You', body: "Use a real photo so your teammates know who's showing up." },
{ icon: '📋', title: 'Registered Players Only', body: "If you're not on the list, you're not on the pitch. No exceptions." },
                { icon: '🟨', title: 'Meet the Referee', body: "Introduce yourself before the game. They're here to keep it fair — show some respect." },
                { icon: '🤝', title: 'Good Energy Only', body: "Daps over drama. Respect the game and your opponents." },
              ].map(({ icon, title, body }) => (
                <View key={title} style={styles.guidelineRow}>
                  <Text style={styles.guidelineIcon}>{icon}</Text>
                  <View style={styles.guidelineText}>
                    <Text style={styles.guidelineItem}>{title}</Text>
                    <Text style={styles.guidelineBody}>{body}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity style={styles.modalCloseBtn} onPress={onClose}>
            <Text style={styles.modalCloseBtnText}>{t('feed.close')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>

      {/* Game Chat */}
      {isGame && (
        <GameChat
          gameId={data?.id}
          gameLocation={data?.location}
          playerId={playerId}
          playerName={playerName}
          isAdmin={isAdmin}
          visible={chatOpen}
          onClose={() => setChatOpen(false)}
        />
      )}
    </Modal>
  );
}

function FixtureCard({ fixture, onPress, t }) {
  const isGame = fixture.type === 'game';
  const data = fixture.data;
  const date = isGame ? data.kickoff_time : data.kickoff_date;
  const dateStr = new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const timeStr = new Date(date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const myTeam = fixture.myTeam;

  // Lineup data (only populated once teams_balanced = true)
  const teamsBalanced = isGame && data.teams_balanced;
  const allPlayers = fixture.allPlayers || [];
  const teamDark   = allPlayers.filter(gp => gp.team === 'A');
  const teamBright = allPlayers.filter(gp => gp.team === 'B');
  const referee = fixture.referee;
  const refName = referee
    ? [referee.first_name, referee.last_name].filter(Boolean).join(' ') || referee.name
    : null;

  // ── Expanded lineup card ──────────────────────────────────────────
  if (isGame && teamsBalanced && (teamDark.length > 0 || teamBright.length > 0)) {
    return (
      <TouchableOpacity style={styles.fixtureCardExpanded} onPress={onPress} activeOpacity={0.85}>
        {/* Header row */}
        <View style={styles.fcExpandedHeader}>
          <View style={styles.fixtureIcon}>
            <Text style={styles.fixtureIconText}>⚽</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fixtureName} numberOfLines={1}>{data.location?.split(',')[0]}</Text>
            <Text style={styles.fixtureMeta}>{data.format} · {dateStr} · {timeStr}</Text>
          </View>
          <View style={styles.fixtureBadge}>
            <Text style={styles.fixtureBadgeText}>{t('feed.game')}</Text>
          </View>
        </View>

        {/* Divider */}
        <View style={styles.fcDivider} />

        {/* Formation Pitch */}
        <FormationPitch
          teamDark={teamDark}
          teamBright={teamBright}
          format={data.format}
          myPlayerId={null}
          myTeam={myTeam}
          refName={refName}
        />
      </TouchableOpacity>
    );
  }

  // ── Compact card (default) ────────────────────────────────────────
  return (
    <TouchableOpacity style={styles.fixtureCard} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.fixtureIcon}>
        <Text style={styles.fixtureIconText}>{isGame ? '⚽' : '🏆'}</Text>
      </View>
      <View style={styles.fixtureInfo}>
        <Text style={styles.fixtureName} numberOfLines={1}>
          {isGame ? (data.location?.split(',')[0]) : data.name}
        </Text>
        <Text style={styles.fixtureMeta}>{data.format} · {dateStr} · {timeStr}</Text>
        {myTeam && (
          <View style={[styles.teamPill, myTeam === 'A' ? styles.teamPillA : styles.teamPillB]}>
            <Text style={styles.teamPillText}>
              {myTeam === 'A' ? '🖤 Dark' : '🤍 White'}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.fixtureBadge}>
        <Text style={styles.fixtureBadgeText}>{isGame ? t('feed.game') : t('feed.cup')}</Text>
      </View>
    </TouchableOpacity>
  );
}

function UpcomingFixtures({ playerId, playerName, playerRole, isAdmin, t }) {
  const [selectedFixture, setSelectedFixture] = useState(null);
  const queryClient = useQueryClient();

  const { data: fixtures, isLoading } = useQuery({
    queryKey: ['myFixtures', playerId],
    queryFn: async () => {
      await checkAndBalanceGames(playerId);
      return fetchMyFixtures(playerId);
    },
    enabled: !!playerId,
    refetchInterval: 10 * 60 * 1000, // re-check every 10 mins
  });

  async function handleCheckIn(fixture) {
    const { error, count } = await supabase
      .from('game_players')
      .update({ checked_in: true, checked_in_at: new Date().toISOString() }, { count: 'exact' })
      .eq('game_id', fixture.data.id)
      .eq('player_id', playerId);

    if (error) {
      Alert.alert('Error', error.message);
      return false;
    }
    if (count === 0) {
      Alert.alert('Error', 'Check-in failed. The column may not exist yet — run the SQL migration first.');
      return false;
    }
    queryClient.invalidateQueries(['myFixtures', playerId]);
    return true;
  }

  async function handleWithdraw(fixture) {
    const data = fixture.data;
    const kickoff = new Date(data.kickoff_time);
    const now = new Date();
    const hoursUntil = (kickoff - now) / (1000 * 60 * 60);
    const withinSixHours = hoursUntil <= 6;
    const hasFee = data.entry_fee > 0;

    let message = `You will be removed from this game.`;
    if (withinSixHours && hasFee) {
      message = `⚠️ No Refund Policy\n\nThis game kicks off in less than 6 hours. Cancellations within 6 hours of kickoff are non-refundable.\n\nAre you sure you want to withdraw?`;
    } else if (withinSixHours) {
      message = `This game kicks off in less than 6 hours. Are you sure you want to withdraw?`;
    } else if (hasFee) {
      message = `You paid $${data.entry_fee} to join this game.\n\nFor refund requests on early cancellations, contact us at urbanpl.app@gmail.com.\n\nWithdraw from this game?`;
    } else {
      message = `Are you sure you want to withdraw from this game?`;
    }

    Alert.alert(
      withinSixHours && hasFee ? '🚫 No Refund' : 'Withdraw from Game',
      message,
      [
        { text: 'Keep My Spot', style: 'cancel' },
        {
          text: 'Withdraw',
          style: 'destructive',
          onPress: async () => {
            const { error, count } = await supabase
              .from('game_players')
              .delete({ count: 'exact' })
              .eq('game_id', data.id)
              .eq('player_id', playerId);

            if (error) {
              Alert.alert('Error', error.message);
            } else if (count === 0) {
              Alert.alert('Error', 'Could not remove you from the game. You may not have permission — please contact support.');
            } else {
              setSelectedFixture(null);
              queryClient.invalidateQueries(['myFixtures']);
              queryClient.invalidateQueries(['games']);
              Alert.alert('Done', "You've been withdrawn from the game.");
            }
          },
        },
      ]
    );
  }

  if (isLoading || !fixtures || fixtures.length === 0) return null;

  return (
    <View style={styles.upcomingSection}>
      <Text style={styles.upcomingTitle}>{t('feed.myUpcoming')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.fixturesRow}>
          {fixtures.map((fixture, i) => (
            <FixtureCard key={i} fixture={fixture} onPress={() => setSelectedFixture(fixture)} t={t} />
          ))}
        </View>
      </ScrollView>
      <FixtureDetailModal
        fixture={selectedFixture}
        visible={!!selectedFixture}
        onClose={() => setSelectedFixture(null)}
        onWithdraw={playerRole !== 'Referee' ? handleWithdraw : null}
        onCheckIn={handleCheckIn}
        playerId={playerId}
        playerName={playerName}
        isAdmin={isAdmin}
        t={t}
      />
    </View>
  );
}

const FILTERS = ['All', '5v5', '6v6', '7v7', 'Free', 'Today'];

// ─── Match Report fetch helpers ───────────────────────────────────────────────
async function fetchPendingReports(playerId) {
  const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('game_player_stats')
    .select('*, games(id, location, format, kickoff_time, score_a, score_b, completed_at, status)')
    .eq('player_id', playerId)
    .eq('verified', false);
  if (error) return [];
  return (data || []).filter(r =>
    r.games?.status === 'completed' &&
    r.games?.completed_at &&
    r.games.completed_at < fiveMinsAgo
  );
}

async function fetchFullGameReport(gameId) {
  const { data } = await supabase
    .from('game_player_stats')
    .select('*, players(id, first_name, last_name, name, role, avatar_url)')
    .eq('game_id', gameId);
  return data || [];
}

async function fetchGameRefereeInfo(gameId) {
  const { data } = await supabase
    .from('game_referees')
    .select('referee_id, players(first_name, last_name, name)')
    .eq('game_id', gameId)
    .maybeSingle();
  return data;
}

// ─── Points calculator (mirror of stat submission logic) ─────────────────────
function calcPoints(stat, scoreA, scoreB) {
  const team = stat.team;
  const won = team === 'A' ? scoreA > scoreB : scoreB > scoreA;
  const isGK = stat.is_goalkeeper;
  const conceded = team === 'A' ? scoreB : scoreA;
  let pts = (won ? 3 : 0) + (stat.goals || 0);
  if (isGK) {
    if (conceded === 0) pts += 3;
    else if (conceded < 2) pts += 1;
  }
  pts -= (stat.yellow_cards || 0) + (stat.red_cards || 0) * 3;
  return Math.max(0, pts);
}

// ─── Match Report Modal ───────────────────────────────────────────────────────
// ─── Match Share Card (Strava-style) ─────────────────────────────────────────
function MatchShareCardModal({ visible, onClose, game, myStats, allStats, playerName: myName }) {
  const cardRef = useRef(null);
  const [bgPhoto, setBgPhoto] = useState(null);
  const [sharing, setSharing] = useState(false);

  const scoreA = game?.score_a ?? 0;
  const scoreB = game?.score_b ?? 0;
  const won  = myStats?.team === 'A' ? scoreA > scoreB : scoreB > scoreA;
  const draw = scoreA === scoreB;
  const result = draw ? 'DRAW' : won ? 'WIN' : 'LOSS';
  const resultColor = draw ? '#888' : won ? '#4caf50' : '#f44336';
  const myGoals = myStats?.goals ?? 0;
  const myYellow = myStats?.yellow_cards ?? 0;
  const myRed = myStats?.red_cards ?? 0;
  const myPts = myStats ? calcPoints(myStats, scoreA, scoreB) : 0;

  const scorers = allStats.filter(s => (s.goals ?? 0) > 0);
  const date = game?.kickoff_time
    ? new Date(game.kickoff_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : '';

  function pName(s) {
    const p = s.players;
    return [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.name || 'Player';
  }

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled) setBgPhoto(result.assets[0].uri);
  }

  async function takePhoto() {
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!result.canceled) setBgPhoto(result.assets[0].uri);
  }

  async function handleShare() {
    if (!cardRef.current) return;
    setSharing(true);
    try {
      const uri = await cardRef.current.capture();
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share Match Card' });
    } catch (e) {
      Alert.alert('Error', 'Could not share. Please try again.');
    } finally {
      setSharing(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={shareCardStyles.container}>
        {/* Header */}
        <View style={shareCardStyles.header}>
          <TouchableOpacity onPress={onClose} style={shareCardStyles.closeBtn}>
            <Text style={shareCardStyles.closeTxt}>✕</Text>
          </TouchableOpacity>
          <Text style={shareCardStyles.headerTitle}>Share Card</Text>
          <TouchableOpacity onPress={handleShare} disabled={sharing} style={shareCardStyles.shareBtn}>
            {sharing
              ? <ActivityIndicator color="#000" size="small" />
              : <Text style={shareCardStyles.shareTxt}>Share ↑</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={shareCardStyles.scroll} showsVerticalScrollIndicator={false}>
          {/* THE CARD — captured by ViewShot */}
          <ViewShot ref={cardRef} options={{ format: 'png', quality: 1 }} style={shareCardStyles.card}>
            {/* Background photo with overlay */}
            {bgPhoto
              ? <Image source={{ uri: bgPhoto }} style={shareCardStyles.cardBg} />
              : null}
            <View style={[shareCardStyles.cardOverlay, !bgPhoto && shareCardStyles.cardOverlayDark]} />

            {/* Top branding */}
            <View style={shareCardStyles.cardTop}>
              <Image source={require('../../assets/logo.png')} style={shareCardStyles.cardLogo} />
              <Text style={shareCardStyles.cardBrand}>URBAN PL</Text>
            </View>

            {/* Result badge */}
            <View style={[shareCardStyles.resultBadge, { backgroundColor: resultColor }]}>
              <Text style={shareCardStyles.resultText}>{result}</Text>
            </View>

            {/* Score */}
            <View style={shareCardStyles.scoreRow}>
              <Text style={shareCardStyles.teamLabel}>TEAM A</Text>
              <Text style={shareCardStyles.scoreText}>{scoreA} — {scoreB}</Text>
              <Text style={shareCardStyles.teamLabel}>TEAM B</Text>
            </View>

            {/* Player name + stats */}
            <View style={shareCardStyles.playerSection}>
              <Text style={shareCardStyles.playerName}>{myName}</Text>
              <View style={shareCardStyles.statsRow}>
                <View style={shareCardStyles.statBox}>
                  <Text style={shareCardStyles.statVal}>{myGoals}</Text>
                  <Text style={shareCardStyles.statLbl}>⚽ Goals</Text>
                </View>
                <View style={shareCardStyles.statBox}>
                  <Text style={shareCardStyles.statVal}>+{myPts}</Text>
                  <Text style={shareCardStyles.statLbl}>★ Points</Text>
                </View>
                <View style={shareCardStyles.statBox}>
                  <Text style={shareCardStyles.statVal}>
                    {myYellow > 0 ? `${myYellow}🟡` : myRed > 0 ? `${myRed}🔴` : '—'}
                  </Text>
                  <Text style={shareCardStyles.statLbl}>Cards</Text>
                </View>
              </View>
            </View>

            {/* Scorers */}
            {scorers.length > 0 && (
              <View style={shareCardStyles.scorerSection}>
                {scorers.slice(0, 4).map((s, i) => (
                  <Text key={i} style={shareCardStyles.scorerLine}>
                    ⚽ {pName(s)}{s.goals > 1 ? ` ×${s.goals}` : ''}
                  </Text>
                ))}
              </View>
            )}

            {/* Venue + date */}
            <View style={shareCardStyles.cardBottom}>
              <Text style={shareCardStyles.cardVenue} numberOfLines={1}>
                📍 {game?.location?.split(',')[0]} · {game?.format}
              </Text>
              <Text style={shareCardStyles.cardDate}>{date}</Text>
              <Text style={shareCardStyles.cardWatermark}>theurbanpl.com</Text>
            </View>
          </ViewShot>

          {/* Photo buttons below card */}
          <View style={shareCardStyles.photoRow}>
            <TouchableOpacity style={shareCardStyles.photoBtn} onPress={takePhoto}>
              <Text style={shareCardStyles.photoBtnIcon}>📷</Text>
              <Text style={shareCardStyles.photoBtnTxt}>Take Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={shareCardStyles.photoBtn} onPress={pickPhoto}>
              <Text style={shareCardStyles.photoBtnIcon}>🖼️</Text>
              <Text style={shareCardStyles.photoBtnTxt}>Choose Photo</Text>
            </TouchableOpacity>
            {bgPhoto && (
              <TouchableOpacity style={shareCardStyles.photoBtn} onPress={() => setBgPhoto(null)}>
                <Text style={shareCardStyles.photoBtnIcon}>✕</Text>
                <Text style={shareCardStyles.photoBtnTxt}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const shareCardStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: RNPlatform.OS === 'ios' ? 54 : 16,
    paddingBottom: 12, paddingHorizontal: 16,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1, borderBottomColor: '#2a2a2a',
  },
  closeBtn: { padding: 8 },
  closeTxt: { color: '#888', fontSize: 16 },
  headerTitle: { color: '#fff', fontWeight: '700', fontSize: 16 },
  shareBtn: {
    backgroundColor: colors.gold, paddingVertical: 8, paddingHorizontal: 16,
    borderRadius: 20,
  },
  shareTxt: { color: '#000', fontWeight: '700', fontSize: 14 },

  scroll: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16 },

  // The card itself
  card: {
    width: 340, borderRadius: 20, overflow: 'hidden',
    backgroundColor: '#0d0d0d',
    minHeight: 480,
  },
  cardBg: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    width: '100%', height: '100%',
  },
  cardOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  cardOverlayDark: { backgroundColor: 'rgba(13,13,13,0.98)' },

  cardTop: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 20, paddingBottom: 8,
  },
  cardLogo: { width: 32, height: 32, borderRadius: 8 },
  cardBrand: {
    color: colors.gold, fontWeight: '900', fontSize: 16, letterSpacing: 2,
  },

  resultBadge: {
    alignSelf: 'center', marginTop: 16,
    paddingHorizontal: 28, paddingVertical: 8,
    borderRadius: 100,
  },
  resultText: { color: '#fff', fontWeight: '900', fontSize: 22, letterSpacing: 3 },

  scoreRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12, marginTop: 16,
  },
  teamLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '600', letterSpacing: 1 },
  scoreText: { color: '#fff', fontSize: 42, fontWeight: '900', letterSpacing: -1 },

  playerSection: {
    marginTop: 20, paddingHorizontal: 20,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)',
    paddingTop: 16,
  },
  playerName: { color: colors.gold, fontWeight: '700', fontSize: 16, marginBottom: 12, textAlign: 'center' },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  statBox: { alignItems: 'center', gap: 4 },
  statVal: { color: '#fff', fontSize: 22, fontWeight: '800' },
  statLbl: { color: 'rgba(255,255,255,0.5)', fontSize: 11 },

  scorerSection: {
    marginTop: 16, paddingHorizontal: 20,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)',
    paddingTop: 12,
  },
  scorerLine: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginBottom: 4 },

  cardBottom: {
    marginTop: 20, padding: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)',
  },
  cardVenue: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  cardDate: { color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 2 },
  cardWatermark: {
    color: colors.gold, fontSize: 11, fontWeight: '700',
    marginTop: 8, letterSpacing: 1,
  },

  // Photo buttons
  photoRow: { flexDirection: 'row', gap: 12, marginTop: 20, flexWrap: 'wrap', justifyContent: 'center' },
  photoBtn: {
    alignItems: 'center', gap: 6,
    backgroundColor: '#1a1a1a',
    borderWidth: 1, borderColor: '#2a2a2a',
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20,
    minWidth: 100,
  },
  photoBtnIcon: { fontSize: 24 },
  photoBtnTxt: { color: '#aaa', fontSize: 12 },
});

function MatchReportModal({ report, playerId, visible, onClose, onVerified }) {
  const game = report?.games;
  const myStats = report; // the game_player_stats row for this player
  const [allStats, setAllStats] = useState([]);
  const [referee, setReferee] = useState(null);
  const [myRating, setMyRating] = useState(0);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [shareCardVisible, setShareCardVisible] = useState(false);

  React.useEffect(() => {
    if (!visible || !game?.id) return;
    setLoading(true);
    setMyRating(0); setRatingSubmitted(false);
    Promise.all([fetchFullGameReport(game.id), fetchGameRefereeInfo(game.id)])
      .then(([stats, ref]) => { setAllStats(stats); setReferee(ref); })
      .finally(() => setLoading(false));
  }, [game?.id, visible]);

  const scoreA = game?.score_a ?? 0;
  const scoreB = game?.score_b ?? 0;
  const myPts  = myStats ? calcPoints(myStats, scoreA, scoreB) : 0;
  const won    = myStats?.team === 'A' ? scoreA > scoreB : scoreB > scoreA;
  const draw   = scoreA === scoreB;

  const scorers = allStats.filter(s => (s.goals || 0) > 0);
  const yellows = allStats.filter(s => (s.yellow_cards || 0) > 0);
  const reds    = allStats.filter(s => (s.red_cards || 0) > 0);

  function playerName(s) {
    const p = s.players;
    return [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.name || 'Player';
  }

  async function handleRate(star) {
    if (ratingSubmitted || !referee?.referee_id) return;
    setMyRating(star);
    await supabase.from('referee_ratings').upsert({
      game_id: game.id,
      referee_id: referee.referee_id,
      player_id: playerId,
      rating: star,
    }, { onConflict: 'game_id,player_id' });
    setRatingSubmitted(true);
  }

  async function handleVerify() {
    setVerifying(true);
    await supabase.from('game_player_stats')
      .update({ verified: true })
      .eq('game_id', game.id)
      .eq('player_id', playerId);
    setVerifying(false);
    onVerified?.();
    onClose();
  }

  async function handleShare() {
    const date = game?.kickoff_time
      ? new Date(game.kickoff_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      : '';
    const result = draw ? 'DRAW' : won ? 'WIN ✅' : 'LOSS';
    const goalLines = scorers.map(s => `  ⚽ ${playerName(s)}${s.goals > 1 ? ` (${s.goals})` : ''}`).join('\n');
    const cardLines = [
      ...yellows.map(s => `  🟡 ${playerName(s)}`),
      ...reds.map(s => `  🔴 ${playerName(s)}`),
    ].join('\n');

    const text = [
      `🏟️ URBAN PL — MATCH REPORT`,
      `📍 ${game?.location?.split(',')[0]} · ${game?.format}`,
      `📅 ${date}`,
      ``,
      `⚪ TEAM A  ${scoreA} — ${scoreB}  TEAM B ⚫`,
      ``,
      goalLines && `⚽ GOALS\n${goalLines}`,
      cardLines && `📋 BOOKINGS\n${cardLines}`,
      ``,
      `MY RESULT: ${result} | +${myPts} pts`,
      ``,
      `🟩 Powered by Urban PL`,
    ].filter(Boolean).join('\n');

    Share.share({ message: text, title: 'Urban PL Match Report' });
  }

  const refName = referee?.players
    ? [referee.players.first_name, referee.players.last_name].filter(Boolean).join(' ') || referee.players.name
    : null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.reportContainer}>
        {/* Header */}
        <View style={styles.reportHeader}>
          <TouchableOpacity onPress={onClose} style={styles.reportCloseBtn}>
            <Text style={styles.reportCloseTxt}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.reportHeaderTitle}>📊 Match Report</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={() => setShareCardVisible(true)} style={[styles.reportShareBtn, { backgroundColor: colors.gold }]}>
              <Text style={[styles.reportShareTxt, { color: colors.dark }]}>🖼️ Card</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleShare} style={styles.reportShareBtn}>
              <Text style={styles.reportShareTxt}>📤 Text</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading ? <ActivityIndicator color={colors.gold} style={{ marginTop: 40 }} /> : (
          <ScrollView contentContainerStyle={styles.reportContent}>

            {/* Branding + venue */}
            <View style={styles.reportBrand}>
              <Text style={styles.reportBrandTitle}>🟩 URBAN PL</Text>
              <Text style={styles.reportVenue} numberOfLines={1}>{game?.location?.split(',')[0]}</Text>
              <Text style={styles.reportMeta}>
                {game?.format} · {game?.kickoff_time
                  ? new Date(game.kickoff_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                  : ''}
              </Text>
            </View>

            {/* Score banner */}
            <View style={styles.scoreBanner}>
              <View style={styles.scoreSide}>
                <Text style={styles.scoreTeamLabel}>TEAM A ⚪</Text>
                <Text style={[styles.scoreNum, scoreA > scoreB && { color: colors.gold }]}>{scoreA}</Text>
              </View>
              <Text style={styles.scoreDivider}>—</Text>
              <View style={styles.scoreSide}>
                <Text style={styles.scoreTeamLabel}>⚫ TEAM B</Text>
                <Text style={[styles.scoreNum, scoreB > scoreA && { color: colors.gold }]}>{scoreB}</Text>
              </View>
            </View>

            {/* Timeline */}
            <View style={styles.reportSection}>
              <Text style={styles.reportSectionTitle}>📋 TIMELINE</Text>
              {scorers.length === 0 && yellows.length === 0 && reds.length === 0 && (
                <Text style={styles.reportNone}>No goals or cards recorded</Text>
              )}
              {scorers.map(s => (
                <View key={s.player_id + 'g'} style={styles.timelineRow}>
                  <Text style={styles.timelineIcon}>⚽</Text>
                  <Text style={styles.timelineName}>{playerName(s)}</Text>
                  {s.goals > 1 && <Text style={styles.timelineExtra}>×{s.goals}</Text>}
                  <Text style={[styles.timelineTeam, { color: s.team === 'A' ? colors.gold : '#4A90D9' }]}>
                    Team {s.team}
                  </Text>
                </View>
              ))}
              {yellows.map(s => (
                <View key={s.player_id + 'y'} style={styles.timelineRow}>
                  <Text style={styles.timelineIcon}>🟡</Text>
                  <Text style={styles.timelineName}>{playerName(s)}</Text>
                  <Text style={[styles.timelineTeam, { color: s.team === 'A' ? colors.gold : '#4A90D9' }]}>
                    Team {s.team}
                  </Text>
                </View>
              ))}
              {reds.map(s => (
                <View key={s.player_id + 'r'} style={styles.timelineRow}>
                  <Text style={styles.timelineIcon}>🔴</Text>
                  <Text style={styles.timelineName}>{playerName(s)}</Text>
                  <Text style={[styles.timelineTeam, { color: s.team === 'A' ? colors.gold : '#4A90D9' }]}>
                    Team {s.team}
                  </Text>
                </View>
              ))}
            </View>

            {/* My Performance */}
            <View style={[styles.reportSection, { borderColor: won ? colors.success : draw ? colors.gray : colors.error }]}>
              <Text style={styles.reportSectionTitle}>⭐ YOUR PERFORMANCE</Text>
              <View style={styles.myStatsRow}>
                <View style={styles.myStatBox}>
                  <Text style={styles.myStatVal}>{myStats?.goals || 0}</Text>
                  <Text style={styles.myStatLbl}>Goals</Text>
                </View>
                <View style={styles.myStatBox}>
                  <Text style={styles.myStatVal}>{myStats?.yellow_cards || 0}</Text>
                  <Text style={styles.myStatLbl}>🟡</Text>
                </View>
                <View style={styles.myStatBox}>
                  <Text style={styles.myStatVal}>{myStats?.red_cards || 0}</Text>
                  <Text style={styles.myStatLbl}>🔴</Text>
                </View>
                <View style={[styles.myStatBox, styles.myStatBoxHighlight]}>
                  <Text style={styles.myStatValGold}>+{myPts}</Text>
                  <Text style={styles.myStatLbl}>Pts Earned</Text>
                </View>
              </View>
              <View style={[styles.resultBadge, {
                backgroundColor: won ? 'rgba(76,175,80,0.15)' : draw ? 'rgba(150,150,150,0.15)' : 'rgba(220,50,50,0.15)',
                borderColor: won ? colors.success : draw ? colors.gray : colors.error,
              }]}>
                <Text style={[styles.resultBadgeText, {
                  color: won ? colors.success : draw ? colors.gray : colors.error,
                }]}>
                  {draw ? '🤝 DRAW' : won ? '✅ WIN' : '❌ LOSS'}
                </Text>
              </View>
            </View>

            {/* Rate Referee */}
            {refName && (
              <View style={styles.reportSection}>
                <Text style={styles.reportSectionTitle}>🟨 RATE THE REFEREE</Text>
                <Text style={styles.refNameText}>{refName}</Text>
                <View style={styles.rateStarRow}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <TouchableOpacity key={n} onPress={() => handleRate(n)} disabled={ratingSubmitted}>
                      <Text style={[styles.rateStar, n <= myRating && styles.rateStarFilled]}>★</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {ratingSubmitted && <Text style={styles.ratingThanks}>✅ Thanks for your rating!</Text>}
              </View>
            )}

            {/* Verify */}
            <TouchableOpacity
              style={[styles.verifyBtn, verifying && { opacity: 0.6 }]}
              onPress={handleVerify}
              disabled={verifying}
            >
              {verifying
                ? <ActivityIndicator color={colors.dark} />
                : <Text style={styles.verifyBtnText}>✓ Verify Match Report</Text>
              }
            </TouchableOpacity>
            <Text style={styles.verifyHint}>Verifying confirms you agree with the stats above.</Text>

          </ScrollView>
        )}
      </View>

      {/* Share Card Modal */}
      <MatchShareCardModal
        visible={shareCardVisible}
        onClose={() => setShareCardVisible(false)}
        game={game}
        myStats={myStats}
        allStats={allStats}
        playerName={
          myStats?.players
            ? [myStats.players.first_name, myStats.players.last_name].filter(Boolean).join(' ') || myStats.players.name
            : ''
        }
      />
    </Modal>
  );
}

async function fetchGames(filter) {
  let query = supabase
    .from('games')
    .select(`*, game_players(player_id), game_waitlist(player_id, position), game_referees(status), latitude, longitude`)
    .in('status', ['open', 'confirmed'])
    .order('kickoff_time', { ascending: true });

  if (filter === '5v5') query = query.eq('format', '5v5');
  if (filter === '6v6') query = query.eq('format', '6v6');
  if (filter === '7v7') query = query.eq('format', '7v7');
  if (filter === 'Free') query = query.eq('entry_fee', 0);
  if (filter === 'Today') {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    query = query.gte('kickoff_time', start.toISOString()).lte('kickoff_time', end.toISOString());
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function formatDate(iso, t) {
  const date = new Date(iso);
  const now = new Date();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const isToday = date.toDateString() === now.toDateString();
  const isTomorrow = date.toDateString() === tomorrow.toDateString();
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (isToday) return `${t ? t('feed.today') : 'Today'} · ${timeStr}`;
  if (isTomorrow) return `${t ? t('feed.tomorrow') : 'Tomorrow'} · ${timeStr}`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ` · ${timeStr}`;
}

function FillBar({ filled, total }) {
  return (
    <View>
      <View style={styles.fillBarTrack}>
        {Array.from({ length: total }).map((_, i) => (
          <View
            key={i}
            style={[styles.fillPip, i < filled && styles.fillPipActive]}
          />
        ))}
      </View>
      <Text style={styles.spotsText}>
        {filled} of {total} spots filled
      </Text>
    </View>
  );
}

function MapStrip({ location }) {
  // Placeholder map strip — Mapbox will replace this in a later update
  return (
    <View style={styles.mapStrip}>
      <View style={styles.mapGrid}>
        {[...Array(4)].map((_, i) => (
          <View key={i} style={styles.mapGridLine} />
        ))}
      </View>
      <View style={styles.mapPin}>
        <Text style={styles.mapPinIcon}>📍</Text>
      </View>
      <Text style={styles.mapLocation} numberOfLines={1}>{location}</Text>
    </View>
  );
}

function shareGame(game) {
  const date = game.kickoff_time
    ? new Date(game.kickoff_time).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
  const filled = game.game_players?.length || 0;
  const spotsLeft = game.total_spots - filled;
  const fee = game.entry_fee > 0 ? `$${game.entry_fee}` : 'Free';

  Share.share({
    message: [
      `⚽ Join me for a game on Urban PL!`,
      ``,
      `📍 ${game.location}`,
      `📅 ${date}`,
      `⚽ Format: ${game.format}`,
      `💰 Entry: ${fee}`,
      `👥 ${spotsLeft} spot${spotsLeft !== 1 ? 's' : ''} left`,
      ``,
      `Download Urban PL and join! 🟩`,
    ].join('\n'),
    title: 'Join my Urban PL game!',
  });
}

// ─── In-Game Chat Modal ───────────────────────────────────────────────────────
function GameChatModal({ game, playerId, playerName, visible, onClose }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!visible || !game?.id) return;
    setLoading(true);

    // Fetch existing messages
    supabase
      .from('game_messages')
      .select('*, players(first_name, last_name, name, avatar_url)')
      .eq('game_id', game.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setMessages(data || []);
        setLoading(false);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100);
      });

    // Real-time subscription
    const channel = supabase
      .channel(`chat:${game.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'game_messages',
        filter: `game_id=eq.${game.id}`,
      }, async (payload) => {
        // Fetch the player info for the new message
        const { data: msgWithPlayer } = await supabase
          .from('game_messages')
          .select('*, players(first_name, last_name, name, avatar_url)')
          .eq('id', payload.new.id)
          .single();
        if (msgWithPlayer) {
          setMessages(prev => [...prev, msgWithPlayer]);
          setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
        }
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [visible, game?.id]);

  async function sendMessage() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText('');
    await supabase.from('game_messages').insert({
      game_id: game.id,
      player_id: playerId,
      message: trimmed,
    });
    setSending(false);
  }

  function getMsgName(msg) {
    const p = msg.players;
    return [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.name || 'Player';
  }

  function getTimeStr(iso) {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  const venue = game?.location?.split(',')[0] || 'Game';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.chatContainer}
        behavior={RNPlatform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.chatHeader}>
          <TouchableOpacity onPress={onClose} style={styles.chatCloseBtn}>
            <Text style={styles.chatCloseTxt}>✕</Text>
          </TouchableOpacity>
          <View style={styles.chatHeaderInfo}>
            <Text style={styles.chatTitle}>💬 Game Chat</Text>
            <Text style={styles.chatSubtitle} numberOfLines={1}>{venue} · {game?.format}</Text>
          </View>
        </View>

        {/* Messages */}
        {loading ? (
          <View style={styles.chatLoading}>
            <ActivityIndicator color={colors.gold} />
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.chatMessages}
            contentContainerStyle={styles.chatMessagesContent}
            showsVerticalScrollIndicator={false}
          >
            {messages.length === 0 && (
              <View style={styles.chatEmpty}>
                <Text style={styles.chatEmptyIcon}>💬</Text>
                <Text style={styles.chatEmptyText}>No messages yet.</Text>
                <Text style={styles.chatEmptySubtext}>Be the first to say something!</Text>
              </View>
            )}
            {messages.map((msg) => {
              const isMe = msg.player_id === playerId;
              return (
                <View key={msg.id} style={[styles.msgRow, isMe && styles.msgRowMe]}>
                  {!isMe && (
                    <View style={styles.msgAvatar}>
                      <Text style={styles.msgAvatarText}>
                        {getMsgName(msg).charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={[styles.msgBubble, isMe ? styles.msgBubbleMe : styles.msgBubbleThem]}>
                    {!isMe && (
                      <Text style={styles.msgSender}>{getMsgName(msg)}</Text>
                    )}
                    <Text style={[styles.msgText, isMe && styles.msgTextMe]}>{msg.message}</Text>
                    <Text style={[styles.msgTime, isMe && styles.msgTimeMe]}>{getTimeStr(msg.created_at)}</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* Input */}
        <View style={styles.chatInputRow}>
          <TextInput
            style={styles.chatInput}
            value={text}
            onChangeText={setText}
            placeholder="Type a message..."
            placeholderTextColor={colors.gray}
            onSubmitEditing={sendMessage}
            returnKeyType="send"
            multiline={false}
            maxLength={300}
          />
          <TouchableOpacity
            style={[styles.chatSendBtn, (!text.trim() || sending) && styles.chatSendBtnDisabled]}
            onPress={sendMessage}
            disabled={!text.trim() || sending}
          >
            {sending
              ? <ActivityIndicator color={colors.dark} size="small" />
              : <Text style={styles.chatSendIcon}>➤</Text>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ConfirmationBadge({ game }) {
  const filled = game.game_players?.length || 0;
  const playersNeeded = Math.max(0, 10 - filled);
  const hasReferee = game.game_referees?.some(r => r.status === 'accepted');
  const isConfirmed = game.status === 'confirmed';

  if (isConfirmed) {
    return (
      <View style={styles.confirmRow}>
        <View style={styles.confirmBadge}>
          <Text style={styles.confirmBadgeText}>✓ Game Confirmed</Text>
        </View>
      </View>
    );
  }

  const items = [];
  if (playersNeeded > 0) {
    items.push(`${playersNeeded} more player${playersNeeded !== 1 ? 's' : ''}`);
  }
  if (!hasReferee) {
    items.push('referee');
  }

  if (items.length === 0) return null; // trigger will flip it soon

  return (
    <View style={styles.confirmRow}>
      <View style={styles.pendingBadge}>
        <Text style={styles.pendingBadgeText}>⚠ Needs {items.join(' & ')} to confirm</Text>
      </View>
    </View>
  );
}

// ─── Payment & Cancellation Policy Modal ─────────────────────────────────────
function PaymentPolicyModal({ visible, game, onAccept, onDecline }) {
  if (!game) return null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDecline}>
      <Pressable style={policyStyles.overlay} onPress={onDecline}>
        <Pressable style={policyStyles.sheet} onPress={e => e.stopPropagation()}>
          <View style={policyStyles.handle} />

          {/* Header */}
          <View style={policyStyles.header}>
            <TouchableOpacity onPress={onDecline} style={policyStyles.closeBtn}>
              <Text style={policyStyles.closeTxt}>✕</Text>
            </TouchableOpacity>
            <Text style={policyStyles.title}>Payment & cancellation policy</Text>
          </View>
          <Text style={policyStyles.subtitle}>
            Make sure you're comfortable with our policy before joining a game.
          </Text>

          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>

            {/* Payment Details */}
            <Text style={policyStyles.sectionTitle}>Payment details</Text>
            <Text style={policyStyles.sectionBody}>
              We place a temporary hold when you join a game. If it's confirmed, you'll be charged. If not, the hold is released (may take a few hours).{' '}
              <Text style={policyStyles.bold}>A $0.50 fee applies for declined cards.</Text>
            </Text>

            {/* Game Confirmation */}
            <Text style={policyStyles.sectionTitle}>Game confirmation</Text>
            <Text style={policyStyles.sectionBody}>
              Games are canceled up to one hour before kickoff if there aren't enough players. We'll notify you if the game is canceled —{' '}
              <Text style={policyStyles.bold}>Turn your notifications on!</Text>
            </Text>

            {/* Cancellation Policy */}
            <Text style={policyStyles.sectionTitle}>Cancellation policy</Text>

            {/* Row 1 */}
            <View style={policyStyles.policyRow}>
              <View style={policyStyles.policyLeft}>
                <Text style={policyStyles.policyTime}>{`> 5 hour notice`}</Text>
                <Text style={policyStyles.policyDesc}>Cancelling more than 5 hours before your game starts.</Text>
              </View>
              <View style={policyStyles.policyRight}>
                <Text style={policyStyles.policyOutcome}>Full refund</Text>
                <Text style={policyStyles.policyDesc}>Get back 100% or receive a game credit (your choice).</Text>
              </View>
            </View>
            <View style={policyStyles.divider} />

            {/* Row 2 */}
            <View style={policyStyles.policyRow}>
              <View style={policyStyles.policyLeft}>
                <Text style={policyStyles.policyTime}>3-5 hour notice</Text>
                <Text style={policyStyles.policyDesc}>Cancelling between 3-5 hours before your game starts.</Text>
              </View>
              <View style={policyStyles.policyRight}>
                <Text style={policyStyles.policyOutcome}>Game credit ONLY</Text>
                <Text style={policyStyles.policyDesc}>Receive a game credit for a future game ONLY if we can find a replacement.</Text>
              </View>
            </View>
            <View style={policyStyles.divider} />

            {/* Row 3 */}
            <View style={policyStyles.policyRow}>
              <View style={policyStyles.policyLeft}>
                <Text style={policyStyles.policyTime}>{`< 3 hour notice`}</Text>
                <Text style={policyStyles.policyDesc}>Cancelling less than 3 hours before your game starts.</Text>
              </View>
              <View style={policyStyles.policyRight}>
                <Text style={[policyStyles.policyOutcome, { color: colors.error }]}>No refund</Text>
                <Text style={policyStyles.policyDesc}>Player does not receive a refund or game credit.</Text>
              </View>
            </View>

            <View style={{ height: 16 }} />
          </ScrollView>

          {/* CTA */}
          <TouchableOpacity style={policyStyles.acceptBtn} onPress={onAccept}>
            <Text style={policyStyles.acceptTxt}>I Agree — Pay ${game.entry_fee} & Join</Text>
          </TouchableOpacity>
          <TouchableOpacity style={policyStyles.declineBtn} onPress={onDecline}>
            <Text style={policyStyles.declineTxt}>Cancel</Text>
          </TouchableOpacity>

        </Pressable>
      </Pressable>
    </Modal>
  );
}

const policyStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.dark,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 36,
    maxHeight: '90%',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#444',
    alignSelf: 'center', marginTop: 12, marginBottom: 16,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 6,
  },
  closeBtn: { padding: 4, marginRight: 10 },
  closeTxt: { color: colors.gray, fontSize: 16 },
  title: {
    fontSize: 18, fontWeight: '800', color: colors.white, flex: 1,
  },
  subtitle: {
    fontSize: 13, color: colors.gray, marginBottom: 20, lineHeight: 18,
  },
  sectionTitle: {
    fontSize: 15, fontWeight: '700', color: colors.white,
    marginTop: 16, marginBottom: 6,
  },
  sectionBody: {
    fontSize: 13, color: '#bbb', lineHeight: 20,
  },
  bold: { fontWeight: '700', color: colors.white },
  policyRow: {
    flexDirection: 'row', paddingVertical: 14, gap: 12,
  },
  policyLeft: { flex: 1 },
  policyRight: { flex: 1 },
  policyTime: {
    fontSize: 13, fontWeight: '700', color: colors.white, marginBottom: 4,
  },
  policyOutcome: {
    fontSize: 13, fontWeight: '700', color: colors.gold, marginBottom: 4,
  },
  policyDesc: {
    fontSize: 12, color: '#888', lineHeight: 17,
  },
  divider: {
    height: 1, backgroundColor: '#222',
  },
  acceptBtn: {
    backgroundColor: colors.gold,
    borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', marginTop: 12,
  },
  acceptTxt: {
    color: colors.dark, fontWeight: '800', fontSize: 15,
  },
  declineBtn: {
    paddingVertical: 12, alignItems: 'center', marginTop: 6,
  },
  declineTxt: {
    color: colors.gray, fontSize: 14, fontWeight: '600',
  },
});

function GameCard({ game, onJoin, onWaitlist, isJoined, isOnWaitlist, waitlistPos, isPaying, onChat, t }) {
  const filled = game.game_players?.length || 0;
  const isFull = filled >= game.total_spots;
  const hasFee = game.entry_fee > 0;

  function joinLabel() {
    if (isPaying) return '⏳ Processing...';
    if (isJoined) return '✓ ' + t('feed.joined');
    if (isFull && isOnWaitlist) return `⏳ Waitlist #${waitlistPos}`;
    if (isFull) return '📋 Join Waitlist';
    if (hasFee) return `Pay $${game.entry_fee} & Join`;
    return t('feed.joinGame');
  }

  function handleMainBtn() {
    if (isJoined || isPaying) return;
    if (isFull && !isOnWaitlist) { onWaitlist(game); return; }
    if (!isFull) { onJoin(game); return; }
  }

  const mainBtnStyle = [
    styles.joinBtn,
    isJoined && styles.joinBtnJoined,
    isFull && !isJoined && !isOnWaitlist && styles.joinBtnWaitlist,
    isOnWaitlist && styles.joinBtnOnWaitlist,
    isPaying && { opacity: 0.7 },
  ];
  const mainTextStyle = [
    styles.joinBtnText,
    isJoined && styles.joinBtnTextJoined,
    (isFull && !isJoined && !isOnWaitlist) && styles.joinBtnTextWaitlist,
    isOnWaitlist && styles.joinBtnTextOnWaitlist,
  ];

  return (
    <View style={styles.card}>
      <GameMap latitude={game.latitude} longitude={game.longitude} location={game.location} />

      {/* Time & Cost badges */}
      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>🕐 {formatDate(game.kickoff_time, t)}</Text>
        </View>
        <View style={[styles.badge, styles.badgeRight]}>
          <Text style={styles.badgeText}>
            {hasFee ? `$${game.entry_fee}` : t('feed.free')}
          </Text>
        </View>
      </View>

      {/* Game Info */}
      <View style={styles.cardBody}>
        <View style={styles.cardTop}>
          <Text style={styles.gameName}>{game.location.split(',')[0]}</Text>
          <View style={styles.formatChip}>
            <Text style={styles.formatText}>{game.format}</Text>
          </View>
        </View>

        <FillBar filled={filled} total={game.total_spots} />

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={mainBtnStyle}
            onPress={handleMainBtn}
            disabled={(isJoined || isOnWaitlist) && !isFull || isPaying}
          >
            {isPaying
              ? <ActivityIndicator color={colors.dark} size="small" />
              : <Text style={mainTextStyle}>{joinLabel()}</Text>
            }
          </TouchableOpacity>

          {/* Chat button — only for joined players */}
          {isJoined && (
            <TouchableOpacity style={styles.chatBtn} onPress={() => onChat(game)}>
              <Text style={styles.chatBtnIcon}>💬</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.shareBtn} onPress={() => shareGame(game)}>
            <Text style={styles.shareBtnText}>📤</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export default function FeedScreen() {
  const [activeFilter, setActiveFilter] = useState('All');
  const [selectedReport, setSelectedReport] = useState(null);
  const [payingGame, setPayingGame] = useState(null);
  const [chatGame, setChatGame] = useState(null);
  const [policyGame, setPolicyGame] = useState(null); // paid game pending policy acceptance
  const { player, signOut } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const { data: games, isLoading, isError, refetch } = useQuery({
    queryKey: ['games', activeFilter],
    queryFn: () => fetchGames(activeFilter),
  });

  const { data: pendingReports = [] } = useQuery({
    queryKey: ['pendingReports', player?.id],
    queryFn: () => fetchPendingReports(player.id),
    enabled: !!player?.id,
    refetchInterval: 60000, // re-check every minute
  });

  async function joinGame(game) {
    const { error } = await supabase
      .from('game_players')
      .insert({ game_id: game.id, player_id: player.id });
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      queryClient.invalidateQueries(['games']);
      queryClient.invalidateQueries(['myFixtures']);
      await scheduleGameReminders(game);
      Alert.alert('🎉 Joined!', `You're in for ${game.location.split(',')[0]}. See you on the pitch!`);
    }
  }

  async function handleJoin(game) {
    // Free game — join directly
    if (!game.entry_fee || game.entry_fee <= 0) {
      await joinGame(game);
      return;
    }

    // Paid game — show policy modal first
    setPolicyGame(game);
  }

  async function proceedWithPayment(game) {
    setPolicyGame(null);

    // Paid game — go through Stripe
    try {
      setPayingGame(game);

      // 1. Ask Edge Function for a PaymentIntent client secret
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/create-payment-intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          amount: game.entry_fee,
          currency: 'usd',
          gameId: game.id,
          playerId: player.id,
          gameTitle: game.location,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.clientSecret) {
        throw new Error(json.error || 'Could not create payment');
      }

      // 2. Initialise the Stripe payment sheet
      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'Urban PL',
        paymentIntentClientSecret: json.clientSecret,
        applePay: {
          merchantCountryCode: 'US',
        },
        defaultBillingDetails: {
          name: `${player.first_name ?? ''} ${player.last_name ?? ''}`.trim(),
          email: player.email ?? '',
        },
        appearance: {
          colors: {
            primary: '#C9A84C',
            background: '#1A1A2E',
            componentBackground: '#12122a',
            componentBorder: '#2a2a4a',
            componentDivider: '#2a2a4a',
            primaryText: '#FFFFFF',
            secondaryText: '#888888',
            componentText: '#FFFFFF',
            placeholderText: '#555555',
          },
        },
      });

      if (initError) throw new Error(initError.message);

      // 3. Present the sheet — user pays (or cancels)
      const { error: presentError } = await presentPaymentSheet();

      if (presentError) {
        if (presentError.code !== 'Canceled') {
          Alert.alert('Payment failed', presentError.message);
        }
        return; // user cancelled — don't join
      }

      // 4. Payment succeeded — record it in DB then join the game
      await supabase.from('payments').insert({
        player_id: player.id,
        game_id: game.id,
        amount: game.entry_fee,
        currency: 'usd',
        stripe_payment_intent_id: json.clientSecret.split('_secret_')[0],
        status: 'succeeded',
      });
      await joinGame(game);

    } catch (err) {
      Alert.alert('Payment error', err.message);
    } finally {
      setPayingGame(null);
    }
  }

  async function handleWaitlist(game) {
    const alreadyOn = game.game_waitlist?.some(w => w.player_id === player?.id);
    if (alreadyOn) return;

    // Get next position (max existing + 1)
    const maxPos = game.game_waitlist?.reduce((m, w) => Math.max(m, w.position || 0), 0) ?? 0;
    const { error } = await supabase
      .from('game_waitlist')
      .insert({ game_id: game.id, player_id: player.id, position: maxPos + 1 });

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      queryClient.invalidateQueries(['games']);
      Alert.alert('📋 Waitlisted!', `You're #${maxPos + 1} on the waitlist for ${game.location.split(',')[0]}. We'll notify you if a spot opens.`);
    }
  }

  function isPlayerJoined(game) {
    return game.game_players?.some(gp => gp.player_id === player?.id);
  }

  function isPlayerOnWaitlist(game) {
    return game.game_waitlist?.some(w => w.player_id === player?.id);
  }

  function playerWaitlistPos(game) {
    return game.game_waitlist?.find(w => w.player_id === player?.id)?.position ?? null;
  }

  // Group games by date
  function groupByDate(games) {
    const groups = {};
    games.forEach(game => {
      const date = new Date(game.kickoff_time);
      const now = new Date();
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      let key;
      if (date.toDateString() === now.toDateString()) key = t('feed.today');
      else if (date.toDateString() === tomorrow.toDateString()) key = t('feed.tomorrow');
      else key = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      if (!groups[key]) groups[key] = [];
      groups[key].push(game);
    });
    return Object.entries(groups);
  }

  const grouped = games ? groupByDate(games) : [];

  // Flatten for FlatList with section headers
  const listData = [];
  grouped.forEach(([date, items]) => {
    listData.push({ type: 'header', date });
    items.forEach(item => listData.push({ type: 'game', game: item }));
  });

  function confirmSignOut() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  }

  return (
    <View style={styles.container}>

      {/* Top bar */}
      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>⚽ Urban PL</Text>
        <TouchableOpacity onPress={confirmSignOut} style={styles.signOutBtn}>
          <Text style={styles.signOutBtnText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* Match Reports */}
      {pendingReports.length > 0 && (
        <View style={styles.reportBanner}>
          <Text style={styles.reportBannerTitle}>📊 Match Reports Ready</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.reportBannerScroll}>
            {pendingReports.map(report => {
              const g = report.games;
              const scoreA = g?.score_a ?? 0;
              const scoreB = g?.score_b ?? 0;
              const won = report.team === 'A' ? scoreA > scoreB : scoreB > scoreA;
              const draw = scoreA === scoreB;
              return (
                <TouchableOpacity key={report.game_id} style={styles.reportCard} onPress={() => setSelectedReport(report)}>
                  <Text style={styles.reportCardVenue} numberOfLines={1}>{g?.location?.split(',')[0]}</Text>
                  <Text style={styles.reportCardScore}>{scoreA} — {scoreB}</Text>
                  <View style={[styles.reportCardResult, {
                    backgroundColor: won ? 'rgba(76,175,80,0.15)' : draw ? 'rgba(150,150,150,0.15)' : 'rgba(220,50,50,0.15)',
                  }]}>
                    <Text style={[styles.reportCardResultText, { color: won ? colors.success : draw ? colors.gray : colors.error }]}>
                      {draw ? 'DRAW' : won ? 'WIN' : 'LOSS'}
                    </Text>
                  </View>
                  <Text style={styles.reportCardCta}>View Report →</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Upcoming Fixtures */}
      <UpcomingFixtures
        playerId={player?.id}
        playerName={[player?.first_name, player?.last_name].filter(Boolean).join(' ') || player?.name}
        playerRole={player?.role}
        isAdmin={player?.is_admin}
        t={t}
      />

      {/* Filter Chips */}
      <FlatList
        data={FILTERS}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={item => item}
        style={styles.filterBar}
        contentContainerStyle={styles.filterContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.filterChip, activeFilter === item && styles.filterChipActive]}
            onPress={() => setActiveFilter(item)}
          >
            <Text style={[styles.filterText, activeFilter === item && styles.filterTextActive]}>
              {item}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Game List */}
      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.gold} size="large" />
        </View>
      )}

      {isError && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{t('feed.failedLoad')}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={refetch}>
            <Text style={styles.retryText}>{t('feed.retry')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {!isLoading && !isError && listData.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🏟️</Text>
          <Text style={styles.emptyText}>{t('feed.noGames')}</Text>
          <Text style={styles.emptySubText}>
            {activeFilter !== 'All'
              ? t('feed.noGamesFilter')
              : t('feed.noGamesDefault')}
          </Text>
        </View>
      )}

      {!isLoading && !isError && listData.length > 0 && (
        <FlatList
          data={listData}
          keyExtractor={(item, index) =>
            item.type === 'header' ? `header-${item.date}` : item.game.id
          }
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetch}
              tintColor={colors.gold}
            />
          }
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            if (item.type === 'header') {
              return <Text style={styles.sectionHeader}>{item.date}</Text>;
            }
            return (
              <GameCard
                game={item.game}
                onJoin={handleJoin}
                onWaitlist={handleWaitlist}
                isJoined={isPlayerJoined(item.game)}
                isOnWaitlist={isPlayerOnWaitlist(item.game)}
                waitlistPos={playerWaitlistPos(item.game)}
                isPaying={payingGame?.id === item.game.id}
                onChat={(g) => setChatGame(g)}
                t={t}
              />
            );
          }}
        />
      )}

      {/* Payment & Cancellation Policy Modal */}
      <PaymentPolicyModal
        visible={!!policyGame}
        game={policyGame}
        onAccept={() => proceedWithPayment(policyGame)}
        onDecline={() => setPolicyGame(null)}
      />

      {/* Match Report Modal */}
      {selectedReport && (
        <MatchReportModal
          report={selectedReport}
          playerId={player?.id}
          visible={!!selectedReport}
          onClose={() => setSelectedReport(null)}
          onVerified={() => {
            queryClient.invalidateQueries(['pendingReports', player?.id]);
            setSelectedReport(null);
          }}
        />
      )}

      {/* In-Game Chat Modal */}
      <GameChatModal
        game={chatGame}
        playerId={player?.id}
        playerName={[player?.first_name, player?.last_name].filter(Boolean).join(' ') || player?.name || 'Player'}
        visible={!!chatGame}
        onClose={() => setChatGame(null)}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.dark },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.darkBorder,
    backgroundColor: colors.darkCard,
  },
  topBarTitle: { color: colors.gold, fontSize: 16, fontWeight: 'bold' },
  signOutBtn: {
    paddingVertical: 5, paddingHorizontal: spacing.md,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.darkBorder,
  },
  signOutBtnText: { color: colors.gray, fontSize: 12, fontWeight: '600' },
  // Upcoming Fixtures
  upcomingSection: {
    borderBottomWidth: 1,
    borderBottomColor: colors.darkBorder,
    paddingVertical: spacing.sm,
  },
  upcomingTitle: {
    color: colors.gold,
    fontWeight: 'bold',
    fontSize: 13,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  fixturesRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  fixtureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.darkCard,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.gold,
    gap: spacing.sm,
    width: 240,
  },

  // Expanded lineup card
  fixtureCardExpanded: {
    backgroundColor: colors.darkCard,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.gold,
    width: 310,
  },
  fcExpandedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  fcDivider: {
    height: 1,
    backgroundColor: colors.darkBorder,
    marginVertical: spacing.sm,
  },
  fcTeamsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  fcTeamCol: {
    flex: 1,
  },
  fcTeamDarkLabel: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 5,
    letterSpacing: 0.3,
  },
  fcTeamBrightLabel: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 5,
    letterSpacing: 0.3,
    textAlign: 'right',
  },
  fcVsDivider: {
    paddingHorizontal: 6,
    paddingTop: 1,
  },
  fcVsText: {
    color: colors.gray,
    fontSize: 10,
    fontWeight: 'bold',
  },
  fcPlayerName: {
    color: colors.grayLight,
    fontSize: 11,
    marginBottom: 2,
    flex: 1,
  },
  fcPlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  fcPlayerRating: {
    color: colors.gold,
    fontSize: 10,
    fontWeight: '700',
  },
  fcMyTeamBanner: {
    marginTop: spacing.sm,
    borderRadius: radius.sm,
    paddingVertical: 4,
    alignItems: 'center',
  },
  fcMyTeamDark: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  fcMyTeamBright: {
    backgroundColor: 'rgba(232,184,75,0.1)',
    borderWidth: 1,
    borderColor: colors.gold,
  },
  fcMyTeamText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  fcRefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.darkBorder,
  },
  fcRefIcon: { fontSize: 12 },
  fcRefLabel: { color: colors.gray, fontSize: 11 },
  fcRefName: { color: colors.gold, fontSize: 11, fontWeight: '700', flex: 1, textAlign: 'right' },
  fixtureIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.goldDim,
    alignItems: 'center', justifyContent: 'center',
  },
  fixtureIconText: { fontSize: 18 },
  fixtureInfo: { flex: 1 },
  fixtureName: { color: colors.white, fontWeight: 'bold', fontSize: 13 },
  fixtureMeta: { color: colors.gray, fontSize: 11, marginTop: 2 },
  fixtureBadge: {
    backgroundColor: colors.goldDim,
    borderRadius: radius.sm,
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
  },
  fixtureBadgeText: { color: colors.gold, fontSize: 10, fontWeight: 'bold' },

  // Filters
  filterBar: { maxHeight: 52, borderBottomWidth: 1, borderBottomColor: colors.darkBorder },
  filterContent: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  filterChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    backgroundColor: colors.darkCard,
  },
  filterChipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  filterText: { color: colors.gray, fontSize: 13 },
  filterTextActive: { color: colors.dark, fontWeight: 'bold' },

  // List
  listContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  sectionHeader: {
    color: colors.gold,
    fontWeight: 'bold',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },

  // Card
  card: {
    backgroundColor: colors.darkCard,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.darkBorder,
  },

  // Map strip
  mapStrip: {
    height: 120,
    backgroundColor: '#0a2a1a',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  mapGrid: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  mapGridLine: { width: 1, backgroundColor: 'rgba(201,168,76,0.1)' },
  mapPin: { marginBottom: spacing.xs },
  mapPinIcon: { fontSize: 28 },
  mapLocation: {
    color: colors.grayLight,
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },

  // Badges
  badgeRow: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  badge: {
    backgroundColor: 'rgba(26,26,46,0.85)',
    borderRadius: radius.sm,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
  },
  badgeRight: {},
  badgeText: { color: colors.white, fontSize: 11, fontWeight: '600' },

  // Card body
  cardBody: { padding: spacing.md, gap: spacing.sm },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gameName: { fontSize: 16, fontWeight: 'bold', color: colors.white, flex: 1 },
  formatChip: {
    backgroundColor: colors.goldDim,
    borderRadius: radius.sm,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  formatText: { color: colors.gold, fontSize: 11, fontWeight: 'bold' },

  // Fill bar
  fillBarTrack: {
    flexDirection: 'row',
    gap: 3,
    marginBottom: 4,
  },
  fillPip: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.darkBorder,
  },
  fillPipActive: { backgroundColor: colors.gold },
  spotsText: { color: colors.gray, fontSize: 11 },

  // Confirmation badge
  confirmRow: {
    marginTop: spacing.sm,
    marginBottom: 2,
  },
  confirmBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
    borderWidth: 1,
    borderColor: '#4CAF50',
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  confirmBadgeText: {
    color: '#4CAF50',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  pendingBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 193, 7, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 193, 7, 0.5)',
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pendingBadgeText: {
    color: '#FFC107',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },

  // Join button
  joinBtn: {
    flex: 1,
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    padding: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  joinBtnJoined: { backgroundColor: colors.goldDim, borderWidth: 1, borderColor: colors.gold },
  joinBtnFull: { backgroundColor: colors.darkBorder },
  joinBtnText: { color: colors.dark, fontWeight: 'bold', fontSize: 14 },
  joinBtnTextJoined: { color: colors.gold },
  joinBtnTextFull: { color: colors.gray },

  // Fixture Detail Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.darkCard,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    borderTopWidth: 1,
    borderColor: colors.darkBorder,
  },
  modalHandle: {
    width: 40, height: 4,
    backgroundColor: colors.darkBorder,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  modalHeader: { alignItems: 'center', marginBottom: spacing.lg },
  modalIconCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.goldDim,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  modalTitle: {
    color: colors.white,
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  modalBadge: {
    backgroundColor: colors.goldDim,
    borderRadius: radius.sm,
    paddingVertical: 3,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  modalBadgeText: { color: colors.gold, fontSize: 12, fontWeight: 'bold' },
  modalDetails: {
    backgroundColor: colors.dark,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.darkBorder,
  },
  modalRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  modalRowIcon: { fontSize: 18, width: 28, textAlign: 'center', marginTop: 2 },
  modalRowLabel: { color: colors.gray, fontSize: 11, marginBottom: 2 },
  modalRowValue: { color: colors.white, fontSize: 14, fontWeight: '600' },
  // Team pill on fixture card
  teamPill: {
    alignSelf: 'flex-start',
    borderRadius: radius.full,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    marginTop: 4,
    borderWidth: 1,
  },
  teamPillA: { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: colors.grayLight },
  teamPillB: { backgroundColor: 'rgba(0,0,0,0.3)', borderColor: colors.gray },
  teamPillText: { color: colors.white, fontSize: 10, fontWeight: 'bold' },

  // Teams section in modal
  teamsSection: {
    backgroundColor: colors.dark,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.darkBorder,
  },
  teamsSectionTitle: {
    color: colors.gold,
    fontWeight: 'bold',
    fontSize: 13,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  teamsRow: { flexDirection: 'row', alignItems: 'flex-start' },
  teamColumn: { flex: 1, padding: spacing.sm, borderRadius: radius.sm },
  teamColumnRight: { alignItems: 'flex-end' },
  teamColumnHighlight: {
    backgroundColor: colors.goldDim,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: radius.sm,
  },
  teamColumnHeader: {
    color: colors.grayLight,
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  teamDarkHeader: {
    color: colors.white,
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: spacing.sm,
  },
  teamBrightHeader: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: spacing.sm,
    textAlign: 'right',
  },
  teamPlayerName: { color: colors.white, fontSize: 13, flex: 1 },
  lineupPlayerRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 6, marginBottom: 4,
  },
  lineupRating: {
    color: colors.gold, fontSize: 11, fontWeight: '700',
  },
  teamsMiddle: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs, paddingTop: 20 },
  teamsVs: { color: colors.gray, fontWeight: 'bold', fontSize: 14 },
  refRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.darkBorder,
  },
  refRowIcon: { fontSize: 16 },
  refRowLabel: { color: colors.gray, fontSize: 13 },
  refRowName: { color: colors.gold, fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' },
  myTeamBanner: {
    marginTop: spacing.md,
    borderRadius: radius.sm,
    padding: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
  },
  myTeamBannerA: { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: colors.grayLight },
  myTeamBannerB: { backgroundColor: 'rgba(0,0,0,0.2)', borderColor: colors.gray },
  myTeamBannerText: { color: colors.white, fontWeight: 'bold', fontSize: 13 },
  teamsPendingText: { color: colors.gray, fontSize: 13, textAlign: 'center', fontStyle: 'italic' },
  confirmNoticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255, 193, 7, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 193, 7, 0.35)',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    gap: 8,
  },
  confirmNoticeIcon: { fontSize: 15, marginTop: 1 },
  confirmNoticeText: {
    flex: 1,
    color: '#FFC107',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },

  modalCloseBtn: {
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  modalCloseBtnText: { color: colors.dark, fontWeight: 'bold', fontSize: 16 },
  playerCheckInBtn: {
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  playerCheckInBtnText: { color: colors.dark, fontWeight: 'bold', fontSize: 16 },
  playerCheckedInBadge: {
    backgroundColor: 'rgba(76,175,80,0.12)',
    borderWidth: 1,
    borderColor: colors.success,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  playerCheckedInText: { color: colors.success, fontWeight: 'bold', fontSize: 15 },

  // ── Community Guidelines ──────────────────────────────
  guidelinesBox: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 16,
    marginTop: 16,
    marginBottom: 4,
  },
  guidelinesTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.gold,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  guidelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 13,
  },
  guidelineIcon: { fontSize: 18, marginTop: 1 },
  guidelineText: { flex: 1 },
  guidelineItem: {
    fontSize: 13, fontWeight: '700', color: colors.white, marginBottom: 2,
  },
  guidelineBody: {
    fontSize: 12, color: '#888', lineHeight: 17,
  },

  withdrawBtn: {
    borderWidth: 1,
    borderColor: 'rgba(244, 67, 54, 0.5)',
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  withdrawBtnNoRefund: {
    borderColor: '#F44336',
    backgroundColor: 'rgba(244, 67, 54, 0.08)',
  },
  withdrawBtnText: { color: '#F44336', fontWeight: '600', fontSize: 14 },

  chatBtn: {
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.gold,
    paddingVertical: spacing.sm, alignItems: 'center', marginBottom: spacing.sm,
    backgroundColor: 'rgba(201,168,76,0.08)',
  },
  chatBtnText: { color: colors.gold, fontWeight: '600', fontSize: 14 },

  // States
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  errorText: { color: colors.error, fontSize: 16, marginBottom: spacing.md },
  retryBtn: {
    backgroundColor: colors.darkCard,
    borderRadius: radius.md,
    padding: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  retryText: { color: colors.gold },
  cardActions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  shareBtn: {
    width: 42, height: 42, borderRadius: radius.md,
    backgroundColor: colors.darkCard, borderWidth: 1, borderColor: colors.darkBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  shareBtnText: { fontSize: 18 },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyText: { color: colors.white, fontSize: 18, fontWeight: 'bold' },
  emptySubText: { color: colors.gray, fontSize: 13, marginTop: spacing.xs },

  // Match Report Banner (Feed)
  reportBanner: {
    backgroundColor: colors.darkCard, borderBottomWidth: 1,
    borderBottomColor: colors.gold, paddingVertical: spacing.sm,
  },
  reportBannerTitle: {
    color: colors.gold, fontSize: 12, fontWeight: 'bold',
    letterSpacing: 1, paddingHorizontal: spacing.md, marginBottom: spacing.sm,
  },
  reportBannerScroll: { paddingHorizontal: spacing.md, gap: spacing.sm },
  reportCard: {
    backgroundColor: colors.dark, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.gold, minWidth: 160, alignItems: 'center',
  },
  reportCardVenue: { color: colors.white, fontSize: 13, fontWeight: '600', marginBottom: 4 },
  reportCardScore: { color: colors.gold, fontSize: 22, fontWeight: 'bold', marginBottom: 6 },
  reportCardResult: { borderRadius: radius.sm, paddingVertical: 2, paddingHorizontal: spacing.sm, marginBottom: 6 },
  reportCardResultText: { fontSize: 11, fontWeight: 'bold' },
  reportCardCta: { color: colors.gold, fontSize: 12 },

  // Match Report Modal
  reportContainer: { flex: 1, backgroundColor: colors.dark },
  reportHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.md, paddingTop: spacing.xl,
    borderBottomWidth: 1, borderBottomColor: colors.darkBorder,
    backgroundColor: colors.darkCard,
  },
  reportCloseBtn: { padding: spacing.xs },
  reportCloseTxt: { color: colors.gold, fontSize: 18, fontWeight: 'bold' },
  reportHeaderTitle: { color: colors.white, fontSize: 16, fontWeight: 'bold', flex: 1 },
  reportShareBtn: {
    backgroundColor: colors.darkBorder, borderRadius: radius.md,
    paddingVertical: 6, paddingHorizontal: spacing.sm,
  },
  reportShareTxt: { color: colors.white, fontSize: 13, fontWeight: '600' },
  reportContent: { padding: spacing.md, paddingBottom: 60 },

  // Branding block
  reportBrand: {
    alignItems: 'center', backgroundColor: colors.darkCard,
    borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md,
    borderWidth: 1, borderColor: 'rgba(76,175,80,0.4)',
  },
  reportBrandTitle: { color: '#4CAF50', fontSize: 18, fontWeight: 'bold', letterSpacing: 2, marginBottom: 4 },
  reportVenue: { color: colors.white, fontSize: 15, fontWeight: '600', marginBottom: 2 },
  reportMeta: { color: colors.gray, fontSize: 12 },

  // Score banner
  scoreBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.darkCard, borderRadius: radius.lg,
    padding: spacing.lg, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.darkBorder,
  },
  scoreSide: { flex: 1, alignItems: 'center' },
  scoreTeamLabel: { color: colors.gray, fontSize: 12, fontWeight: 'bold', marginBottom: spacing.xs },
  scoreNum: { color: colors.white, fontSize: 52, fontWeight: 'bold' },
  scoreDivider: { color: colors.gray, fontSize: 32, fontWeight: 'bold', marginHorizontal: spacing.lg },

  // Timeline
  reportSection: {
    backgroundColor: colors.darkCard, borderRadius: radius.lg,
    padding: spacing.md, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.darkBorder,
  },
  reportSectionTitle: {
    color: colors.gold, fontSize: 11, fontWeight: 'bold',
    letterSpacing: 1, marginBottom: spacing.sm,
  },
  reportNone: { color: colors.gray, fontSize: 13, fontStyle: 'italic' },
  timelineRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.dark,
  },
  timelineIcon: { fontSize: 16, width: 22 },
  timelineName: { color: colors.white, fontSize: 13, flex: 1 },
  timelineExtra: { color: colors.gold, fontSize: 12, fontWeight: 'bold' },
  timelineTeam: { fontSize: 11, fontWeight: 'bold' },

  // My Performance
  myStatsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  myStatBox: {
    flex: 1, alignItems: 'center', backgroundColor: colors.dark,
    borderRadius: radius.sm, padding: spacing.sm,
  },
  myStatBoxHighlight: { backgroundColor: 'rgba(201,168,76,0.1)', borderWidth: 1, borderColor: colors.gold },
  myStatVal: { color: colors.white, fontSize: 22, fontWeight: 'bold' },
  myStatValGold: { color: colors.gold, fontSize: 22, fontWeight: 'bold' },
  myStatLbl: { color: colors.gray, fontSize: 11, marginTop: 2 },
  resultBadge: {
    alignSelf: 'center', borderRadius: radius.md, borderWidth: 1,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.lg, marginTop: spacing.xs,
  },
  resultBadgeText: { fontSize: 15, fontWeight: 'bold' },

  // Referee rating
  refNameText: { color: colors.white, fontSize: 14, fontWeight: '600', marginBottom: spacing.sm },
  rateStarRow: { flexDirection: 'row', gap: spacing.sm },
  rateStar: { fontSize: 32, color: colors.darkBorder },
  rateStarFilled: { color: colors.gold },
  ratingThanks: { color: colors.success, fontSize: 13, marginTop: spacing.sm },

  // Verify button
  verifyBtn: {
    backgroundColor: colors.gold, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', marginBottom: spacing.sm,
  },
  verifyBtnText: { color: colors.dark, fontWeight: 'bold', fontSize: 16 },
  verifyHint: { color: colors.gray, fontSize: 12, textAlign: 'center', marginBottom: spacing.xl },

  // Waitlist button variants
  joinBtnWaitlist: {
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: colors.gray,
  },
  joinBtnOnWaitlist: {
    backgroundColor: 'rgba(122,122,130,0.12)',
    borderWidth: 1, borderColor: colors.gray,
  },
  joinBtnTextWaitlist: { color: colors.gray },
  joinBtnTextOnWaitlist: { color: colors.grayLight },

  // Chat button on card
  chatBtn: {
    width: 42, height: 42, borderRadius: radius.md,
    backgroundColor: colors.goldDim, borderWidth: 1, borderColor: colors.gold,
    alignItems: 'center', justifyContent: 'center',
  },
  chatBtnIcon: { fontSize: 18 },

  // GameChatModal
  chatContainer: { flex: 1, backgroundColor: colors.dark },
  chatHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.md, paddingTop: spacing.xl,
    borderBottomWidth: 1, borderBottomColor: colors.darkBorder,
    backgroundColor: colors.darkCard,
  },
  chatCloseBtn: { padding: spacing.xs },
  chatCloseTxt: { color: colors.gold, fontSize: 18, fontWeight: 'bold' },
  chatHeaderInfo: { flex: 1 },
  chatTitle: { color: colors.white, fontSize: 16, fontWeight: 'bold' },
  chatSubtitle: { color: colors.gray, fontSize: 12, marginTop: 2 },
  chatLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  chatMessages: { flex: 1 },
  chatMessagesContent: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.lg },
  chatEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  chatEmptyIcon: { fontSize: 48, marginBottom: spacing.md },
  chatEmptyText: { color: colors.white, fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  chatEmptySubtext: { color: colors.gray, fontSize: 13 },

  // Message bubbles
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, maxWidth: '80%' },
  msgRowMe: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  msgAvatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.darkElevated, borderWidth: 1, borderColor: colors.darkBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  msgAvatarText: { color: colors.gold, fontSize: 13, fontWeight: 'bold' },
  msgBubble: {
    borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    borderWidth: 1, maxWidth: 280,
  },
  msgBubbleThem: { backgroundColor: colors.darkCard, borderColor: colors.darkBorder, borderBottomLeftRadius: 4 },
  msgBubbleMe: { backgroundColor: colors.goldDim, borderColor: colors.gold, borderBottomRightRadius: 4 },
  msgSender: { color: colors.gold, fontSize: 11, fontWeight: '700', marginBottom: 3 },
  msgText: { color: colors.white, fontSize: 14, lineHeight: 20 },
  msgTextMe: { color: colors.white },
  msgTime: { color: colors.gray, fontSize: 10, marginTop: 4 },
  msgTimeMe: { textAlign: 'right' },

  // Chat input
  chatInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, paddingBottom: RNPlatform.OS === 'ios' ? 32 : spacing.md,
    borderTopWidth: 1, borderTopColor: colors.darkBorder,
    backgroundColor: colors.darkCard, paddingTop: spacing.md,
  },
  chatInput: {
    flex: 1, backgroundColor: colors.darkElevated,
    borderRadius: radius.xl, borderWidth: 1, borderColor: colors.gold,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    color: colors.white, fontSize: 15,
  },
  chatSendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center',
  },
  chatSendBtnDisabled: { backgroundColor: colors.darkBorder },
  chatSendIcon: { color: colors.dark, fontSize: 18, fontWeight: 'bold' },
});

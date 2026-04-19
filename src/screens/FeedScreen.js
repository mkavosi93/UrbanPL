import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, ScrollView, Modal, Pressable,
  Share, Image, Alert,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { scheduleGameReminders } from '../lib/notifications';
import { colors, spacing, radius } from '../theme';

// ─── Smart team balancer ──────────────────────────────────────────────────────
// Priority: each team gets at least one GK or Versatile player first,
// then remaining outfield players are distributed by rating (snake draft).
function snakeDraft(players) {
  const assignment = {};

  // Separate goalkeepers/versatile from outfield
  const gkPool = players.filter(p => p.role === 'Goalkeeper' || p.role === 'Versatile')
    .sort((a, b) => (b.rating ?? 2.5) - (a.rating ?? 2.5));
  const outfield = players.filter(p => p.role !== 'Goalkeeper' && p.role !== 'Versatile')
    .sort((a, b) => (b.rating ?? 2.5) - (a.rating ?? 2.5));

  // Assign first GK/Versatile to A, second to B
  // If only one available, assign to A (B will have to manage)
  // If more than 2, treat the rest as outfield for rating balancing
  const gkForA = gkPool[0];
  const gkForB = gkPool[1];
  const extraGKs = gkPool.slice(2);

  if (gkForA) assignment[gkForA.player_id] = 'A';
  if (gkForB) assignment[gkForB.player_id] = 'B';

  // Merge extra GKs into outfield pool and re-sort by rating
  const remaining = [...extraGKs, ...outfield]
    .sort((a, b) => (b.rating ?? 2.5) - (a.rating ?? 2.5));

  // Track team rating totals to keep balance
  let totalA = gkForA ? (gkForA.rating ?? 2.5) : 0;
  let totalB = gkForB ? (gkForB.rating ?? 2.5) : 0;
  let countA = gkForA ? 1 : 0;
  let countB = gkForB ? 1 : 0;

  // Snake draft the remaining players into whichever team has lower avg rating
  remaining.forEach((p, i) => {
    const avgA = countA > 0 ? totalA / countA : 0;
    const avgB = countB > 0 ? totalB / countB : 0;
    // Assign to team with lower average, or alternate if equal
    const team = avgA <= avgB ? 'A' : 'B';
    assignment[p.player_id] = team;
    if (team === 'A') { totalA += (p.rating ?? 2.5); countA++; }
    else { totalB += (p.rating ?? 2.5); countB++; }
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

      // Save team assignments to game_players
      await Promise.all(
        Object.entries(assignment).map(([pid, team]) =>
          supabase
            .from('game_players')
            .update({ team })
            .eq('game_id', game.id)
            .eq('player_id', pid)
        )
      );

      // Mark game as balanced
      await supabase
        .from('games')
        .update({ teams_balanced: true })
        .eq('id', game.id);
    }
  }
}

async function fetchMyFixtures(playerId) {
  // My joined games — now also fetches team assignment and all players' teams
  const { data: myGames } = await supabase
    .from('game_players')
    .select('game_id, team, games(id, format, kickoff_time, location, total_spots, entry_fee, status, teams_balanced)')
    .eq('player_id', playerId)
    .order('game_id');

  // My tournament registrations
  const { data: myTournaments } = await supabase
    .from('tournament_teams')
    .select('tournament_id, tournaments(id, name, format, kickoff_date, venue, entry_fee, status)')
    .contains('player_ids', [playerId]);

  const fixtures = [];
  const now = new Date();

  // Also fetch all players' team assignments for each game
  const gameIds = myGames?.map(r => r.game_id).filter(Boolean) || [];
  let allTeams = {};
  if (gameIds.length > 0) {
    const { data: teamData } = await supabase
      .from('game_players')
      .select('game_id, player_id, team, players(first_name, last_name, name, role, rating)')
      .in('game_id', gameIds);
    teamData?.forEach(gp => {
      if (!allTeams[gp.game_id]) allTeams[gp.game_id] = [];
      allTeams[gp.game_id].push(gp);
    });
  }

  myGames?.forEach(row => {
    if (row.games && new Date(row.games.kickoff_time) >= now) {
      fixtures.push({
        type: 'game',
        data: row.games,
        myTeam: row.team,
        allPlayers: allTeams[row.game_id] || [],
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

function FixtureDetailModal({ fixture, visible, onClose, t }) {
  if (!fixture) return null;
  const isGame = fixture.type === 'game';
  const data = fixture.data;
  const date = new Date(isGame ? data.kickoff_time : data.kickoff_date);
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const teamsBalanced = isGame && data.teams_balanced;
  const allPlayers = fixture.allPlayers || [];
  const teamA = allPlayers.filter(gp => gp.team === 'A');
  const teamB = allPlayers.filter(gp => gp.team === 'B');
  const myTeam = fixture.myTeam;

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

          {/* Team Lineups */}
          {isGame && teamsBalanced && (teamA.length > 0 || teamB.length > 0) && (
            <View style={styles.teamsSection}>
              <Text style={styles.teamsSectionTitle}>⚖️ Teams</Text>
              <View style={styles.teamsRow}>
                {/* Team A */}
                <View style={[styles.teamColumn, myTeam === 'A' && styles.teamColumnHighlight]}>
                  <Text style={styles.teamColumnHeader}>⚪ Team A</Text>
                  {teamA.map(gp => {
                    const p = gp.players;
                    const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.name || 'Player';
                    return (
                      <Text key={gp.player_id} style={styles.teamPlayerName} numberOfLines={1}>
                        {name}
                      </Text>
                    );
                  })}
                </View>
                <View style={styles.teamsMiddle}>
                  <Text style={styles.teamsVs}>VS</Text>
                </View>
                {/* Team B */}
                <View style={[styles.teamColumn, styles.teamColumnRight, myTeam === 'B' && styles.teamColumnHighlight]}>
                  <Text style={styles.teamColumnHeader}>⚫ Team B</Text>
                  {teamB.map(gp => {
                    const p = gp.players;
                    const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.name || 'Player';
                    return (
                      <Text key={gp.player_id} style={[styles.teamPlayerName, { textAlign: 'right' }]} numberOfLines={1}>
                        {name}
                      </Text>
                    );
                  })}
                </View>
              </View>
              {myTeam && (
                <View style={[styles.myTeamBanner, myTeam === 'A' ? styles.myTeamBannerA : styles.myTeamBannerB]}>
                  <Text style={styles.myTeamBannerText}>
                    You are on {myTeam === 'A' ? '⚪ Team A' : '⚫ Team B'}
                  </Text>
                </View>
              )}
            </View>
          )}

          {isGame && !teamsBalanced && (
            <View style={styles.teamsSection}>
              <Text style={styles.teamsPendingText}>
                ⏳ Teams will be announced 2 hours before kickoff
              </Text>
            </View>
          )}

          <TouchableOpacity style={styles.modalCloseBtn} onPress={onClose}>
            <Text style={styles.modalCloseBtnText}>{t('feed.close')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
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
              {myTeam === 'A' ? '⚪ Team A' : '⚫ Team B'}
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

function UpcomingFixtures({ playerId, t }) {
  const [selectedFixture, setSelectedFixture] = useState(null);

  const { data: fixtures, isLoading } = useQuery({
    queryKey: ['myFixtures', playerId],
    queryFn: async () => {
      await checkAndBalanceGames(playerId);
      return fetchMyFixtures(playerId);
    },
    enabled: !!playerId,
    refetchInterval: 10 * 60 * 1000, // re-check every 10 mins
  });

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
function MatchReportModal({ report, playerId, visible, onClose, onVerified }) {
  const game = report?.games;
  const myStats = report; // the game_player_stats row for this player
  const [allStats, setAllStats] = useState([]);
  const [referee, setReferee] = useState(null);
  const [myRating, setMyRating] = useState(0);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(true);

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
          <TouchableOpacity onPress={handleShare} style={styles.reportShareBtn}>
            <Text style={styles.reportShareTxt}>📤 Share</Text>
          </TouchableOpacity>
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
    </Modal>
  );
}

async function fetchGames(filter) {
  let query = supabase
    .from('games')
    .select(`*, game_players(player_id)`)
    .eq('status', 'open')
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

function GameCard({ game, onJoin, isJoined, t }) {
  const filled = game.game_players?.length || 0;
  const isFull = filled >= game.total_spots;

  return (
    <View style={styles.card}>
      <MapStrip location={game.location} />

      {/* Time & Cost badges */}
      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>🕐 {formatDate(game.kickoff_time, t)}</Text>
        </View>
        <View style={[styles.badge, styles.badgeRight]}>
          <Text style={styles.badgeText}>
            {game.entry_fee > 0 ? `$${game.entry_fee}` : t('feed.free')}
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

        <TouchableOpacity
          style={[
            styles.joinBtn,
            isJoined && styles.joinBtnJoined,
            isFull && !isJoined && styles.joinBtnFull,
          ]}
          onPress={() => !isJoined && !isFull && onJoin(game)}
          disabled={isJoined || isFull}
        >
          <Text style={[
            styles.joinBtnText,
            isJoined && styles.joinBtnTextJoined,
            isFull && !isJoined && styles.joinBtnTextFull,
          ]}>
            {isJoined ? t('feed.joined') : isFull ? t('feed.full') : t('feed.joinGame')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function FeedScreen() {
  const [activeFilter, setActiveFilter] = useState('All');
  const [selectedReport, setSelectedReport] = useState(null);
  const { player, signOut } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

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

  async function handleJoin(game) {
    const { error } = await supabase
      .from('game_players')
      .insert({ game_id: game.id, player_id: player.id });

    if (error) {
      console.log('Join error:', error.message);
    } else {
      queryClient.invalidateQueries(['games']);
      queryClient.invalidateQueries(['myFixtures']);
      // Schedule push reminders for this game
      await scheduleGameReminders(game);
    }
  }

  function isPlayerJoined(game) {
    return game.game_players?.some(gp => gp.player_id === player?.id);
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
      <UpcomingFixtures playerId={player?.id} t={t} />

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
                isJoined={isPlayerJoined(item.game)}
                t={t}
              />
            );
          }}
        />
      )}

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

  // Join button
  joinBtn: {
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
  teamPlayerName: { color: colors.white, fontSize: 13, marginBottom: 4 },
  teamsMiddle: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs, paddingTop: 20 },
  teamsVs: { color: colors.gray, fontWeight: 'bold', fontSize: 14 },
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

  modalCloseBtn: {
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  modalCloseBtnText: { color: colors.dark, fontWeight: 'bold', fontSize: 16 },

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
});

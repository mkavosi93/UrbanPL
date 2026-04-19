import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, ScrollView, TextInput, Modal, Image,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { colors, spacing, radius } from '../theme';

const SECTIONS = ['Feed', 'Score', 'Profile'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function StarRow({ rating, onRate, readonly }) {
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map(n => (
        <TouchableOpacity key={n} onPress={() => !readonly && onRate?.(n)} disabled={readonly}>
          <Text style={[styles.star, n <= rating && styles.starFilled]}>★</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Fetch functions ──────────────────────────────────────────────────────────
async function fetchFeedGames() {
  const { data, error } = await supabase
    .from('games')
    .select('*, game_players(player_id)')
    .in('status', ['open', 'active'])
    .order('kickoff_time', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchFeedCups() {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*')
    .in('status', ['upcoming', 'active'])
    .order('kickoff_date', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchMyAcceptances(refereeId) {
  const { data, error } = await supabase
    .from('game_referees')
    .select('game_id')
    .eq('referee_id', refereeId);
  if (error) return [];
  return (data || []).map(r => r.game_id);
}

async function fetchScoreGames() {
  const { data, error } = await supabase
    .from('games')
    .select(`*, game_players(player_id, team, players(id, first_name, last_name, name, role, rating, games_played, avatar_url))`)
    .in('status', ['open', 'active'])
    .order('kickoff_time', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function fetchRefereeHistory(refereeId) {
  const { data, error } = await supabase
    .from('game_referees')
    .select('*, games(id, location, format, kickoff_time, status)')
    .eq('referee_id', refereeId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

async function fetchMyFixtures(refereeId) {
  const { data, error } = await supabase
    .from('game_referees')
    .select('game_id, games(*, game_players(player_id, team, players(id, first_name, last_name, name, role, rating, avatar_url)))')
    .eq('referee_id', refereeId)
    .eq('status', 'accepted');
  if (error) return [];
  return (data || []).map(r => r.games).filter(Boolean);
}

async function fetchRefereeRatings(refereeId) {
  const { data, error } = await supabase
    .from('referee_ratings')
    .select('rating, game_id, created_at')
    .eq('referee_id', refereeId);
  if (error) return [];
  return data || [];
}

// ─── Team balancer ────────────────────────────────────────────────────────────
function balanceTeams(gamePlayers) {
  const assignment = {};
  const withRole = gamePlayers.map(gp => ({
    player_id: gp.player_id,
    role: gp.players?.role || 'Outfield',
    rating: gp.players?.rating ?? 2.5,
  }));
  const gkPool = withRole.filter(p => p.role === 'Goalkeeper' || p.role === 'Versatile')
    .sort((a, b) => b.rating - a.rating);
  const outfield = withRole.filter(p => p.role !== 'Goalkeeper' && p.role !== 'Versatile')
    .sort((a, b) => b.rating - a.rating);
  const gkForA = gkPool[0]; const gkForB = gkPool[1];
  if (gkForA) assignment[gkForA.player_id] = 'A';
  if (gkForB) assignment[gkForB.player_id] = 'B';
  const remaining = [...gkPool.slice(2), ...outfield].sort((a, b) => b.rating - a.rating);
  let totalA = gkForA ? gkForA.rating : 0, totalB = gkForB ? gkForB.rating : 0;
  let countA = gkForA ? 1 : 0, countB = gkForB ? 1 : 0;
  remaining.forEach(p => {
    const team = (countA > 0 ? totalA / countA : 0) <= (countB > 0 ? totalB / countB : 0) ? 'A' : 'B';
    assignment[p.player_id] = team;
    if (team === 'A') { totalA += p.rating; countA++; } else { totalB += p.rating; countB++; }
  });
  return assignment;
}

function teamAvgRating(playerIds, players) {
  const members = players.filter(gp => playerIds.includes(gp.player_id));
  if (!members.length) return 0;
  return (members.reduce((acc, gp) => acc + (gp.players?.rating ?? 2.5), 0) / members.length).toFixed(1);
}

// ─── GoalRow ──────────────────────────────────────────────────────────────────
function GoalRow({ gp, goals, cards, onAdjustGoals, onAdjustCards }) {
  const p = gp.players;
  const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.name || 'Player';
  const goalCount = goals[gp.player_id] || 0;
  const playerCards = cards[gp.player_id] || { yellow: 0, red: 0 };
  return (
    <View style={styles.statRow}>
      <View style={styles.playerInfo}>
        <Text style={styles.playerName}>{name}</Text>
        <Text style={styles.playerRole}>{p?.role || 'Outfield'}</Text>
      </View>
      <View style={styles.statControls}>
        <View style={styles.counterGroup}>
          <Text style={styles.counterLabel}>⚽</Text>
          <TouchableOpacity style={styles.goalBtn} onPress={() => onAdjustGoals(gp.player_id, -1)}>
            <Text style={styles.goalBtnText}>−</Text>
          </TouchableOpacity>
          <Text style={styles.goalCount}>{goalCount}</Text>
          <TouchableOpacity style={styles.goalBtn} onPress={() => onAdjustGoals(gp.player_id, 1)}>
            <Text style={styles.goalBtnText}>+</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.cardBtn, { backgroundColor: playerCards.yellow > 0 ? '#F5C518' : colors.dark }]}
          onPress={() => onAdjustCards(gp.player_id, 'yellow', playerCards.yellow > 0 ? -1 : 1)}
        >
          <Text style={styles.cardBtnText}>🟡{playerCards.yellow > 0 ? ` ${playerCards.yellow}` : ''}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.cardBtn, { backgroundColor: playerCards.red > 0 ? '#C0392B' : colors.dark }]}
          onPress={() => onAdjustCards(gp.player_id, 'red', playerCards.red > 0 ? -1 : 1)}
        >
          <Text style={styles.cardBtnText}>🔴{playerCards.red > 0 ? ` ${playerCards.red}` : ''}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Stats Modal ──────────────────────────────────────────────────────────────
function StatsModal({ game, visible, onClose, onSubmitted }) {
  const players = game?.game_players || [];
  const initialTeams = {};
  players.forEach(gp => { if (gp.team) initialTeams[gp.player_id] = gp.team; });
  const [teams, setTeams]       = useState(initialTeams);
  const [scoreA, setScoreA]     = useState('');
  const [scoreB, setScoreB]     = useState('');
  const [goals, setGoals]       = useState({});
  const [cards, setCards]       = useState({});
  const [submitting, setSubmitting] = useState(false);

  function adjustCards(playerId, type, delta) {
    setCards(prev => {
      const cur = prev[playerId] || { yellow: 0, red: 0 };
      return { ...prev, [playerId]: { ...cur, [type]: Math.max(0, cur[type] + delta) } };
    });
  }
  function assignTeam(playerId, team) {
    setTeams(prev => ({ ...prev, [playerId]: prev[playerId] === team ? null : team }));
  }
  function adjustGoals(playerId, delta) {
    setGoals(prev => ({ ...prev, [playerId]: Math.max(0, (prev[playerId] || 0) + delta) }));
  }

  async function handleSubmit() {
    const a = parseInt(scoreA) || 0, b = parseInt(scoreB) || 0;
    if (players.some(gp => !teams[gp.player_id])) {
      Alert.alert('Missing teams', 'Assign every player to Team A or B.'); return;
    }
    if (scoreA === '' || scoreB === '') {
      Alert.alert('Missing score', 'Enter the final score for both teams.'); return;
    }
    setSubmitting(true);
    try {
      const stats = players.map(gp => {
        const p = gp.players; const team = teams[gp.player_id];
        const won = team === 'A' ? a > b : b > a;
        const isGK = p?.role === 'Goalkeeper';
        const conceded = team === 'A' ? b : a;
        const playerCards = cards[gp.player_id] || { yellow: 0, red: 0 };
        return {
          game_id: game.id, player_id: gp.player_id,
          goals: goals[gp.player_id] || 0, won, is_goalkeeper: isGK,
          goals_conceded: isGK ? conceded : 0,
          yellow_cards: playerCards.yellow, red_cards: playerCards.red,
        };
      });
      const { error } = await supabase
        .from('game_player_stats')
        .upsert(stats, { onConflict: 'game_id,player_id' });
      if (error) throw error;
      await supabase.from('games').update({ status: 'completed' }).eq('id', game.id);
      Alert.alert('Stats saved!', 'Points updated for all players.', [
        { text: 'OK', onPress: () => { onSubmitted(); onClose(); } },
      ]);
    } catch (err) { Alert.alert('Error', err.message); }
    finally { setSubmitting(false); }
  }

  const teamA = players.filter(gp => teams[gp.player_id] === 'A');
  const teamB = players.filter(gp => teams[gp.player_id] === 'B');
  const allAssigned = players.every(gp => teams[gp.player_id]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalBack}>
            <Text style={styles.modalBackText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle} numberOfLines={1}>
            {game?.location?.split(',')[0]} · {game && formatDate(game.kickoff_time)}
          </Text>
        </View>
        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">

          {allAssigned && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>TEAM BALANCE</Text>
              <View style={styles.teamStrengthRow}>
                <View style={styles.teamStrengthBox}>
                  <Text style={styles.teamStrengthLabel}>⚪ Team A</Text>
                  <Text style={styles.teamStrengthRating}>⭐ {teamAvgRating(teamA.map(g => g.player_id), players)}</Text>
                  <Text style={styles.teamStrengthCount}>{teamA.length} players</Text>
                </View>
                <View style={styles.teamStrengthDivider} />
                <View style={styles.teamStrengthBox}>
                  <Text style={styles.teamStrengthLabel}>⚫ Team B</Text>
                  <Text style={styles.teamStrengthRating}>⭐ {teamAvgRating(teamB.map(g => g.player_id), players)}</Text>
                  <Text style={styles.teamStrengthCount}>{teamB.length} players</Text>
                </View>
              </View>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>OVERRIDE TEAMS</Text>
            <Text style={styles.sectionHint}>Teams were auto-set by rating. Tap A or B to override</Text>
            {players.map(gp => {
              const p = gp.players;
              const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.name || 'Player';
              return (
                <View key={gp.player_id} style={styles.playerRow}>
                  <View style={styles.playerInfo}>
                    <Text style={styles.playerName}>{name}</Text>
                    <Text style={styles.playerRole}>{p?.role || 'Outfield'} · ⭐{p?.rating ?? 2.5}</Text>
                  </View>
                  <View style={styles.teamBtns}>
                    <TouchableOpacity style={[styles.teamBtn, teams[gp.player_id] === 'A' && styles.teamBtnA]} onPress={() => assignTeam(gp.player_id, 'A')}>
                      <Text style={[styles.teamBtnText, teams[gp.player_id] === 'A' && styles.teamBtnTextActive]}>A</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.teamBtn, teams[gp.player_id] === 'B' && styles.teamBtnB]} onPress={() => assignTeam(gp.player_id, 'B')}>
                      <Text style={[styles.teamBtnText, teams[gp.player_id] === 'B' && styles.teamBtnTextActive]}>B</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>

          {allAssigned && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>FINAL SCORE</Text>
              <View style={styles.scoreRow}>
                <View style={styles.scoreBox}>
                  <Text style={styles.scoreTeamLabel}>⚪ Team A</Text>
                  <TextInput style={styles.scoreInput} value={scoreA} onChangeText={setScoreA} keyboardType="number-pad" maxLength={2} placeholder="0" placeholderTextColor={colors.gray} />
                </View>
                <Text style={styles.scoreDash}>—</Text>
                <View style={styles.scoreBox}>
                  <Text style={styles.scoreTeamLabel}>⚫ Team B</Text>
                  <TextInput style={styles.scoreInput} value={scoreB} onChangeText={setScoreB} keyboardType="number-pad" maxLength={2} placeholder="0" placeholderTextColor={colors.gray} />
                </View>
              </View>
            </View>
          )}

          {(teamA.length > 0 || teamB.length > 0) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>PLAYER STATS</Text>
              <Text style={styles.sectionHint}>Goals · 🟡 Yellow (-1pt) · 🔴 Red (-3pts)</Text>
              {teamA.length > 0 && (<><Text style={styles.teamDivider}>⚪ Team A</Text>{teamA.map(gp => <GoalRow key={gp.player_id} gp={gp} goals={goals} cards={cards} onAdjustGoals={adjustGoals} onAdjustCards={adjustCards} />)}</>)}
              {teamB.length > 0 && (<><Text style={styles.teamDivider}>⚫ Team B</Text>{teamB.map(gp => <GoalRow key={gp.player_id} gp={gp} goals={goals} cards={cards} onAdjustGoals={adjustGoals} onAdjustCards={adjustCards} />)}</>)}
            </View>
          )}

          {allAssigned && scoreA !== '' && scoreB !== '' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>POINTS PREVIEW</Text>
              {players.map(gp => {
                const p = gp.players; const team = teams[gp.player_id];
                if (!team) return null;
                const a = parseInt(scoreA) || 0, b = parseInt(scoreB) || 0;
                const won = team === 'A' ? a > b : b > a;
                const isGK = p?.role === 'Goalkeeper';
                const conceded = team === 'A' ? b : a;
                const playerCards = cards[gp.player_id] || { yellow: 0, red: 0 };
                let pts = (won ? 3 : 0) + (goals[gp.player_id] || 0);
                if (isGK) { if (conceded === 0) pts += 3; else if (conceded < 2) pts += 1; }
                pts -= playerCards.yellow + playerCards.red * 3;
                pts = Math.max(0, pts);
                const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.name || 'Player';
                return (
                  <View key={gp.player_id} style={styles.previewRow}>
                    <Text style={styles.previewName}>{name}</Text>
                    <Text style={styles.previewPts}>+{pts} pts</Text>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
        <View style={styles.submitRow}>
          <TouchableOpacity style={[styles.submitBtn, submitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator color={colors.dark} /> : <Text style={styles.submitBtnText}>✓ Save Stats & Close Game</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Feed Tab ─────────────────────────────────────────────────────────────────
function FeedTab({ refereeId }) {
  const queryClient = useQueryClient();

  const { data: games = [] }       = useQuery({ queryKey: ['refFeedGames'],   queryFn: fetchFeedGames });
  const { data: cups = [] }        = useQuery({ queryKey: ['refFeedCups'],    queryFn: fetchFeedCups });
  const { data: accepted = [] }    = useQuery({ queryKey: ['refAccepted', refereeId], queryFn: () => fetchMyAcceptances(refereeId), enabled: !!refereeId });
  const { data: fixtures = [] }    = useQuery({ queryKey: ['refFixtures', refereeId], queryFn: () => fetchMyFixtures(refereeId), enabled: !!refereeId });

  async function handleAccept(gameId) {
    const { error } = await supabase.from('game_referees').upsert(
      { game_id: gameId, referee_id: refereeId, status: 'accepted' },
      { onConflict: 'game_id,referee_id' }
    );
    if (error) Alert.alert('Error', error.message);
    else queryClient.invalidateQueries(['refAccepted', refereeId]);
  }

  async function handleDecline(gameId) {
    await supabase.from('game_referees').delete()
      .eq('game_id', gameId).eq('referee_id', refereeId);
    queryClient.invalidateQueries(['refAccepted', refereeId]);
  }

  if (games.length === 0 && cups.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>📋</Text>
        <Text style={styles.emptyTitle}>No openings yet</Text>
        <Text style={styles.emptySub}>No upcoming games or tournaments posted yet.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.feedContent}>

      {/* Your Fixtures */}
      {fixtures.length > 0 && (
        <>
          <Text style={styles.feedSection}>📅 Your Fixtures</Text>
          {fixtures.map(g => (
            <View key={g.id} style={[styles.oppCard, { borderColor: colors.gold }]}>
              <View style={styles.oppCardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.oppCardTitle} numberOfLines={1}>{g.location?.split(',')[0]}</Text>
                  <Text style={styles.oppCardMeta}>{g.format} · {formatDate(g.kickoff_time)}</Text>
                  <Text style={styles.oppCardMeta}>👥 {g.game_players?.length || 0} players registered</Text>
                </View>
                <View style={[styles.acceptedBadge, { flex: 0, paddingHorizontal: spacing.sm }]}>
                  <Text style={styles.acceptedText}>✓ Confirmed</Text>
                </View>
              </View>
            </View>
          ))}
        </>
      )}

      {games.length > 0 && (
        <>
          <Text style={styles.feedSection}>⚽ Games</Text>
          {games.map(g => {
            const isAccepted = accepted.includes(g.id);
            return (
              <View key={g.id} style={styles.oppCard}>
                <View style={styles.oppCardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.oppCardTitle} numberOfLines={1}>{g.location?.split(',')[0]}</Text>
                    <Text style={styles.oppCardMeta}>{g.format} · {formatDate(g.kickoff_time)}</Text>
                    <Text style={styles.oppCardMeta}>👥 {g.game_players?.length || 0} players</Text>
                  </View>
                  <View style={styles.oppCardRight}>
                    <View style={[styles.payBadge, (g.referee_pay ?? 0) === 0 && styles.payBadgeMuted]}>
                      <Text style={[styles.payBadgeText, (g.referee_pay ?? 0) === 0 && styles.payBadgeTextMuted]}>
                        💰 ${(g.referee_pay ?? 0).toFixed ? (g.referee_pay ?? 0).toFixed(0) : (g.referee_pay ?? 0)}
                      </Text>
                    </View>
                    <Text style={styles.refsNeeded}>
                      🟨 {g.referees_needed ?? 1} ref{(g.referees_needed ?? 1) !== 1 ? 's' : ''} needed
                    </Text>
                  </View>
                </View>
                <View style={styles.oppCardActions}>
                  {isAccepted ? (
                    <>
                      <View style={styles.acceptedBadge}>
                        <Text style={styles.acceptedText}>✓ Accepted</Text>
                      </View>
                      <TouchableOpacity style={styles.declineBtn} onPress={() => handleDecline(g.id)}>
                        <Text style={styles.declineBtnText}>Withdraw</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity style={styles.acceptBtn} onPress={() => handleAccept(g.id)}>
                      <Text style={styles.acceptBtnText}>Accept Game →</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </>
      )}

      {cups.length > 0 && (
        <>
          <Text style={styles.feedSection}>🏆 Tournaments</Text>
          {cups.map(c => {
            const isAccepted = accepted.includes(c.id);
            return (
              <View key={c.id} style={styles.oppCard}>
                <View style={styles.oppCardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.oppCardTitle} numberOfLines={1}>{c.name}</Text>
                    <Text style={styles.oppCardMeta}>{c.format} · {new Date(c.kickoff_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                    <Text style={styles.oppCardMeta}>📍 {c.venue}</Text>
                  </View>
                  <View style={styles.oppCardRight}>
                    <View style={[styles.payBadge, (c.referee_pay ?? 0) === 0 && styles.payBadgeMuted]}>
                      <Text style={[styles.payBadgeText, (c.referee_pay ?? 0) === 0 && styles.payBadgeTextMuted]}>
                        💰 ${(c.referee_pay ?? 0).toFixed ? (c.referee_pay ?? 0).toFixed(0) : (c.referee_pay ?? 0)}
                      </Text>
                    </View>
                    <Text style={styles.refsNeeded}>
                      🟨 {c.referees_needed ?? 1} ref{(c.referees_needed ?? 1) !== 1 ? 's' : ''} needed
                    </Text>
                  </View>
                </View>
                <View style={styles.oppCardActions}>
                  {isAccepted ? (
                    <>
                      <View style={styles.acceptedBadge}>
                        <Text style={styles.acceptedText}>✓ Accepted</Text>
                      </View>
                      <TouchableOpacity style={styles.declineBtn} onPress={() => handleDecline(c.id)}>
                        <Text style={styles.declineBtnText}>Withdraw</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity style={styles.acceptBtn} onPress={() => handleAccept(c.id)}>
                      <Text style={styles.acceptBtnText}>Accept Tournament →</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

// ─── Profile Tab ──────────────────────────────────────────────────────────────
function ProfileTab({ player }) {
  const { data: history = [] } = useQuery({
    queryKey: ['refHistory', player?.id],
    queryFn: () => fetchRefereeHistory(player.id),
    enabled: !!player?.id,
  });
  const { data: ratings = [] } = useQuery({
    queryKey: ['refRatings', player?.id],
    queryFn: () => fetchRefereeRatings(player.id),
    enabled: !!player?.id,
  });

  const avgRating = ratings.length > 0
    ? (ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length).toFixed(1)
    : null;

  const fullName = [player?.first_name, player?.last_name].filter(Boolean).join(' ') || player?.name || 'Referee';
  const initials = [player?.first_name?.[0], player?.last_name?.[0]].filter(Boolean).join('').toUpperCase() || 'R';

  return (
    <ScrollView contentContainerStyle={styles.profileContent}>

      {/* Avatar + name */}
      <View style={styles.profileHero}>
        <View style={styles.profileAvatar}>
          {player?.avatar_url
            ? <Image source={{ uri: player.avatar_url }} style={styles.profileAvatarImg} />
            : <Text style={styles.profileAvatarText}>{initials}</Text>
          }
        </View>
        <Text style={styles.profileName}>{fullName}</Text>
        <View style={styles.refBadge}>
          <Text style={styles.refBadgeText}>🟨 Official Referee</Text>
        </View>
        {avgRating && (
          <View style={styles.avgRatingRow}>
            <StarRow rating={Math.round(parseFloat(avgRating))} readonly />
            <Text style={styles.avgRatingText}>{avgRating} / 5  ({ratings.length} rating{ratings.length !== 1 ? 's' : ''})</Text>
          </View>
        )}
      </View>

      {/* $50 Bonus Progress */}
      {(() => {
        const BONUS_THRESHOLD = 5;
        const BONUS_AMOUNT = 50;
        const gamesRefereed = history.length;
        const gamesLeft = Math.max(0, BONUS_THRESHOLD - gamesRefereed);
        const pct = Math.min((gamesRefereed / BONUS_THRESHOLD) * 100, 100);
        const earned = gamesRefereed >= BONUS_THRESHOLD;
        return (
          <View style={styles.bonusCard}>
            <View style={styles.bonusCardTop}>
              <Text style={styles.bonusIcon}>🎁</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.bonusTitle}>${BONUS_AMOUNT} Bonus Reward</Text>
                <Text style={styles.bonusSub}>
                  {earned
                    ? '🎉 You\'ve earned your bonus!'
                    : `Referee ${gamesLeft} more game${gamesLeft !== 1 ? 's' : ''} to unlock`}
                </Text>
              </View>
              <Text style={styles.bonusCount}>{gamesRefereed}/{BONUS_THRESHOLD}</Text>
            </View>
            <View style={styles.bonusTrack}>
              <View style={[styles.bonusFill, { width: `${pct}%`, backgroundColor: earned ? colors.success : colors.gold }]} />
            </View>
          </View>
        );
      })()}

      {/* Credentials */}
      <View style={styles.profileSection}>
        <Text style={styles.profileSectionTitle}>📋 Credentials</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoKey}>Email</Text>
          <Text style={styles.infoVal}>{player?.email || '—'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoKey}>Phone</Text>
          <Text style={styles.infoVal}>{player?.phone || '—'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoKey}>Certification</Text>
          <Text style={styles.infoVal}>{player?.referee_cert || '—'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoKey}>Experience</Text>
          <Text style={styles.infoVal}>{player?.referee_experience || '—'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoKey}>Formats</Text>
          <Text style={styles.infoVal}>{Array.isArray(player?.referee_formats) ? player.referee_formats.join(', ') : (player?.referee_formats || '—')}</Text>
        </View>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{history.length}</Text>
          <Text style={styles.statLbl}>Games</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{avgRating ?? '—'}</Text>
          <Text style={styles.statLbl}>Avg Rating</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{ratings.length}</Text>
          <Text style={styles.statLbl}>Reviews</Text>
        </View>
      </View>

      {/* Game History */}
      <View style={styles.profileSection}>
        <Text style={styles.profileSectionTitle}>🎮 Game History</Text>
        {history.length === 0 ? (
          <Text style={styles.noDataText}>No games refereed yet</Text>
        ) : (
          history.slice(0, 10).map(h => (
            <View key={h.id} style={styles.historyRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.historyTitle} numberOfLines={1}>
                  {h.games?.location?.split(',')[0] || 'Game'}
                </Text>
                <Text style={styles.historyMeta}>
                  {h.games?.format} · {h.games?.kickoff_time ? formatDate(h.games.kickoff_time) : ''}
                </Text>
              </View>
              <View style={[styles.historyStatus, {
                borderColor: h.games?.status === 'completed' ? colors.gray : colors.success
              }]}>
                <Text style={[styles.historyStatusText, {
                  color: h.games?.status === 'completed' ? colors.gray : colors.success
                }]}>{h.games?.status || 'open'}</Text>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Ratings breakdown */}
      {ratings.length > 0 && (
        <View style={styles.profileSection}>
          <Text style={styles.profileSectionTitle}>⭐ Player Ratings</Text>
          {[5, 4, 3, 2, 1, 0].map(n => {
            const count = ratings.filter(r => r.rating === n).length;
            const pct = ratings.length > 0 ? (count / ratings.length) * 100 : 0;
            return (
              <View key={n} style={styles.ratingBarRow}>
                <Text style={styles.ratingBarLabel}>{n}★</Text>
                <View style={styles.ratingBarTrack}>
                  <View style={[styles.ratingBarFill, { width: `${pct}%` }]} />
                </View>
                <Text style={styles.ratingBarCount}>{count}</Text>
              </View>
            );
          })}
        </View>
      )}

    </ScrollView>
  );
}

// ─── Player Live Card ─────────────────────────────────────────────────────────
function PlayerLiveCard({ gp, goals, cards, onAdjustGoals, onAdjustCards, team }) {
  const p = gp.players;
  const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.name || 'Player';
  const initials = [p?.first_name?.[0], p?.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?';
  const goalCount = goals[gp.player_id] || 0;
  const c = cards[gp.player_id] || { yellow: 0, red: 0 };
  const teamColor = team === 'A' ? colors.gold : '#4A90D9';
  return (
    <View style={[styles.liveCard, { borderLeftColor: teamColor }]}>
      <View style={styles.liveCardLeft}>
        {p?.avatar_url
          ? <Image source={{ uri: p.avatar_url }} style={styles.liveAvatar} />
          : <View style={[styles.liveAvatarFallback, { borderColor: teamColor }]}><Text style={[styles.liveAvatarText, { color: teamColor }]}>{initials}</Text></View>
        }
        <View style={{ flex: 1 }}>
          <Text style={styles.livePlayerName} numberOfLines={1}>{name}</Text>
          <Text style={styles.livePlayerRole}>{p?.role || 'Outfield'}</Text>
        </View>
      </View>
      <View style={styles.liveCardControls}>
        <View style={styles.liveGoalRow}>
          <TouchableOpacity style={styles.liveCntBtn} onPress={() => onAdjustGoals(gp.player_id, -1)}>
            <Text style={styles.liveCntBtnText}>−</Text>
          </TouchableOpacity>
          <Text style={styles.liveGoalVal}>⚽ {goalCount}</Text>
          <TouchableOpacity style={styles.liveCntBtn} onPress={() => onAdjustGoals(gp.player_id, 1)}>
            <Text style={styles.liveCntBtnText}>+</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.liveCardBtns}>
          <TouchableOpacity
            style={[styles.liveCardBtn, c.yellow > 0 && { backgroundColor: '#F5C518', borderColor: '#F5C518' }]}
            onPress={() => onAdjustCards(gp.player_id, 'yellow', c.yellow > 0 ? -1 : 1)}
          >
            <Text style={styles.liveCardBtnText}>🟡{c.yellow > 0 ? ` ${c.yellow}` : ''}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.liveCardBtn, c.red > 0 && { backgroundColor: '#C0392B', borderColor: '#C0392B' }]}
            onPress={() => onAdjustCards(gp.player_id, 'red', c.red > 0 ? -1 : 1)}
          >
            <Text style={styles.liveCardBtnText}>🔴{c.red > 0 ? ` ${c.red}` : ''}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── Match Modal ──────────────────────────────────────────────────────────────
const FIRST_HALF_SECS = 25 * 60;
const BREAK_SECS      = 5 * 60;
const SECOND_HALF_SECS = 25 * 60;

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function MatchModal({ game, visible, onClose, onSaved }) {
  const players = game?.game_players || [];

  // Phase: 'attendance' | 'first_half' | 'break' | 'second_half' | 'final'
  const [phase, setPhase]       = useState('attendance');
  const [present, setPresent]   = useState(() => {
    const m = {};
    players.forEach(gp => { m[gp.player_id] = true; });
    return m;
  });
  const [teams, setTeams]       = useState(() => {
    // Auto-balance on open
    const m = {};
    players.forEach(gp => { if (gp.team) m[gp.player_id] = gp.team; });
    return m;
  });
  const [goals, setGoals]       = useState({});
  const [cards, setCards]       = useState({});
  const [scoreA, setScoreA]     = useState('');
  const [scoreB, setScoreB]     = useState('');
  const [timeLeft, setTimeLeft] = useState(FIRST_HALF_SECS);
  const [running, setRunning]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const intervalRef = useRef(null);

  // Re-init when game changes
  useEffect(() => {
    if (!visible) return;
    setPhase('attendance');
    setGoals({}); setCards({}); setScoreA(''); setScoreB('');
    setTimeLeft(FIRST_HALF_SECS); setRunning(false);
    const m = {};
    players.forEach(gp => { m[gp.player_id] = true; });
    setPresent(m);
    const t = {};
    players.forEach(gp => { if (gp.team) t[gp.player_id] = gp.team; });
    setTeams(t);
  }, [game?.id, visible]);

  // Timer
  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(intervalRef.current);
            setRunning(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [running]);

  function togglePresent(pid) {
    setPresent(p => ({ ...p, [pid]: !p[pid] }));
  }
  function assignTeam(pid, team) {
    setTeams(t => ({ ...t, [pid]: t[pid] === team ? null : team }));
  }
  function adjustGoals(pid, delta) {
    setGoals(g => ({ ...g, [pid]: Math.max(0, (g[pid] || 0) + delta) }));
  }
  function adjustCards(pid, type, delta) {
    setCards(c => {
      const cur = c[pid] || { yellow: 0, red: 0 };
      return { ...c, [pid]: { ...cur, [type]: Math.max(0, cur[type] + delta) } };
    });
  }

  function handleStartMatch() {
    const presentPlayers = players.filter(gp => present[gp.player_id]);
    const unassigned = presentPlayers.filter(gp => !teams[gp.player_id]);
    if (unassigned.length > 0) {
      // Auto-balance unassigned players
      const balanced = balanceTeams(presentPlayers);
      setTeams(balanced);
    }
    setPhase('first_half');
    setTimeLeft(FIRST_HALF_SECS);
    setRunning(true);
  }

  function handleEndHalf() {
    setRunning(false);
    if (phase === 'first_half') {
      Alert.alert('⏱ Half Time!', '5 minute break starting now.', [
        { text: 'Start Break', onPress: () => { setPhase('break'); setTimeLeft(BREAK_SECS); setRunning(true); } },
      ]);
    } else if (phase === 'break') {
      Alert.alert('▶️ Second Half', 'Ready to kick off the second half?', [
        { text: 'Start 2nd Half', onPress: () => { setPhase('second_half'); setTimeLeft(SECOND_HALF_SECS); setRunning(true); } },
      ]);
    } else if (phase === 'second_half') {
      setRunning(false);
      setPhase('final');
    }
  }

  // Auto-alert when timer hits 0
  useEffect(() => {
    if (timeLeft === 0 && (phase === 'first_half' || phase === 'break' || phase === 'second_half')) {
      handleEndHalf();
    }
  }, [timeLeft]);

  async function handleSave() {
    const a = parseInt(scoreA) || 0, b = parseInt(scoreB) || 0;
    const presentPlayers = players.filter(gp => present[gp.player_id]);
    setSubmitting(true);
    try {
      const stats = presentPlayers.map(gp => {
        const p = gp.players; const team = teams[gp.player_id];
        const won = team === 'A' ? a > b : b > a;
        const isGK = p?.role === 'Goalkeeper';
        const conceded = team === 'A' ? b : a;
        const c = cards[gp.player_id] || { yellow: 0, red: 0 };
        return {
          game_id: game.id, player_id: gp.player_id,
          goals: goals[gp.player_id] || 0, won, is_goalkeeper: isGK,
          goals_conceded: isGK ? conceded : 0,
          yellow_cards: c.yellow, red_cards: c.red,
        };
      });
      const { error } = await supabase.from('game_player_stats')
        .upsert(stats, { onConflict: 'game_id,player_id' });
      if (error) throw error;
      await supabase.from('games').update({
        status: 'completed',
        score_a: a,
        score_b: b,
        completed_at: new Date().toISOString(),
      }).eq('id', game.id);
      Alert.alert('✅ Match Complete!', 'Stats saved and game closed.', [
        { text: 'Done', onPress: () => { onSaved?.(); onClose(); } },
      ]);
    } catch (err) { Alert.alert('Error', err.message); }
    finally { setSubmitting(false); }
  }

  const presentPlayers  = players.filter(gp => present[gp.player_id]);
  const teamA = presentPlayers.filter(gp => teams[gp.player_id] === 'A');
  const teamB = presentPlayers.filter(gp => teams[gp.player_id] === 'B');

  const phaseLabel = phase === 'first_half' ? '1st Half'
    : phase === 'break' ? 'Half Time Break'
    : phase === 'second_half' ? '2nd Half'
    : '';
  const phaseColor = phase === 'break' ? colors.gray : colors.gold;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.matchContainer}>

        {/* Header */}
        <View style={styles.matchHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalBack}>
            <Text style={styles.modalBackText}>✕</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.matchHeaderTitle} numberOfLines={1}>{game?.location?.split(',')[0]}</Text>
            <Text style={styles.matchHeaderMeta}>{game?.format} · {game && formatDate(game.kickoff_time)}</Text>
          </View>
        </View>

        {/* ── ATTENDANCE PHASE ── */}
        {phase === 'attendance' && (
          <View style={{ flex: 1 }}>
            <Text style={styles.phaseTitle}>📋 Take Attendance</Text>
            <Text style={styles.phaseHint}>Tap to mark present/absent. Then assign teams.</Text>
            <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 120 }}>
              {players.map(gp => {
                const p = gp.players;
                const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.name || 'Player';
                const initials = [p?.first_name?.[0], p?.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?';
                const isPresent = present[gp.player_id] !== false;
                return (
                  <View key={gp.player_id} style={[styles.attendanceRow, !isPresent && { opacity: 0.4 }]}>
                    <TouchableOpacity style={styles.attendanceLeft} onPress={() => togglePresent(gp.player_id)}>
                      {p?.avatar_url
                        ? <Image source={{ uri: p.avatar_url }} style={styles.attAvatar} />
                        : <View style={styles.attAvatarFallback}><Text style={styles.attAvatarText}>{initials}</Text></View>
                      }
                      <View>
                        <Text style={styles.attName}>{name}</Text>
                        <Text style={styles.attRole}>{p?.role || 'Outfield'}</Text>
                      </View>
                    </TouchableOpacity>
                    <View style={styles.attRight}>
                      {isPresent && (
                        <View style={styles.teamBtns}>
                          <TouchableOpacity style={[styles.teamBtn, teams[gp.player_id] === 'A' && styles.teamBtnA]} onPress={() => assignTeam(gp.player_id, 'A')}>
                            <Text style={[styles.teamBtnText, teams[gp.player_id] === 'A' && styles.teamBtnTextActive]}>A</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.teamBtn, teams[gp.player_id] === 'B' && styles.teamBtnB]} onPress={() => assignTeam(gp.player_id, 'B')}>
                            <Text style={[styles.teamBtnText, teams[gp.player_id] === 'B' && styles.teamBtnTextActive]}>B</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      <Text style={{ fontSize: 20 }}>{isPresent ? '✅' : '❌'}</Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
            <View style={styles.matchFooter}>
              <Text style={styles.matchFooterHint}>
                {presentPlayers.length} present · {teamA.length}A / {teamB.length}B assigned
              </Text>
              <TouchableOpacity style={styles.matchStartBtn} onPress={handleStartMatch}>
                <Text style={styles.matchStartBtnText}>▶ Start Match</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── LIVE PHASES ── */}
        {(phase === 'first_half' || phase === 'break' || phase === 'second_half') && (
          <View style={{ flex: 1 }}>
            {/* Timer */}
            <View style={styles.timerBlock}>
              <Text style={[styles.timerPhase, { color: phaseColor }]}>{phaseLabel}</Text>
              <Text style={styles.timerDisplay}>{formatTime(timeLeft)}</Text>
              <View style={styles.timerBtns}>
                <TouchableOpacity
                  style={[styles.timerBtn, { backgroundColor: running ? colors.darkBorder : colors.success }]}
                  onPress={() => setRunning(r => !r)}
                >
                  <Text style={styles.timerBtnText}>{running ? '⏸ Pause' : '▶ Resume'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.timerBtn, { backgroundColor: colors.error }]} onPress={handleEndHalf}>
                  <Text style={styles.timerBtnText}>
                    {phase === 'first_half' ? 'End Half →' : phase === 'break' ? 'Start 2nd →' : 'End Match →'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Player panels */}
            {phase !== 'break' ? (
              <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 20 }}>
                {teamA.length > 0 && (
                  <>
                    <Text style={styles.liveTeamHeader}>⚪ Team A</Text>
                    {teamA.map(gp => (
                      <PlayerLiveCard key={gp.player_id} gp={gp} goals={goals} cards={cards}
                        onAdjustGoals={adjustGoals} onAdjustCards={adjustCards} team="A" />
                    ))}
                  </>
                )}
                {teamB.length > 0 && (
                  <>
                    <Text style={[styles.liveTeamHeader, { color: '#4A90D9' }]}>⚫ Team B</Text>
                    {teamB.map(gp => (
                      <PlayerLiveCard key={gp.player_id} gp={gp} goals={goals} cards={cards}
                        onAdjustGoals={adjustGoals} onAdjustCards={adjustCards} team="B" />
                    ))}
                  </>
                )}
              </ScrollView>
            ) : (
              <View style={styles.breakScreen}>
                <Text style={styles.breakIcon}>☕</Text>
                <Text style={styles.breakTitle}>Half Time</Text>
                <Text style={styles.breakSub}>Players are resting. Timer will signal when to resume.</Text>
              </View>
            )}
          </View>
        )}

        {/* ── FINAL PHASE ── */}
        {phase === 'final' && (
          <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 120 }}>
            <Text style={styles.phaseTitle}>🏁 Full Time — Enter Score</Text>
            <View style={styles.finalScoreRow}>
              <View style={styles.finalScoreBox}>
                <Text style={styles.finalScoreLabel}>⚪ Team A</Text>
                <TextInput style={styles.finalScoreInput} value={scoreA} onChangeText={setScoreA}
                  keyboardType="number-pad" maxLength={2} placeholder="0" placeholderTextColor={colors.gray} />
              </View>
              <Text style={styles.finalScoreDash}>—</Text>
              <View style={styles.finalScoreBox}>
                <Text style={styles.finalScoreLabel}>⚫ Team B</Text>
                <TextInput style={styles.finalScoreInput} value={scoreB} onChangeText={setScoreB}
                  keyboardType="number-pad" maxLength={2} placeholder="0" placeholderTextColor={colors.gray} />
              </View>
            </View>

            <Text style={styles.finalStatsHeader}>Player Stats Summary</Text>
            {presentPlayers.map(gp => {
              const p = gp.players;
              const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.name;
              const g = goals[gp.player_id] || 0;
              const c = cards[gp.player_id] || { yellow: 0, red: 0 };
              const team = teams[gp.player_id];
              return (
                <View key={gp.player_id} style={styles.finalStatRow}>
                  <Text style={[styles.finalStatTeam, { color: team === 'A' ? colors.gold : '#4A90D9' }]}>{team}</Text>
                  <Text style={styles.finalStatName} numberOfLines={1}>{name}</Text>
                  <Text style={styles.finalStatGoals}>⚽ {g}</Text>
                  {c.yellow > 0 && <Text style={styles.finalStatCard}>🟡{c.yellow}</Text>}
                  {c.red > 0 && <Text style={styles.finalStatCard}>🔴{c.red}</Text>}
                </View>
              );
            })}
          </ScrollView>
        )}

        {phase === 'final' && (
          <View style={styles.matchFooter}>
            <TouchableOpacity
              style={[styles.matchStartBtn, submitting && { opacity: 0.6 }]}
              onPress={handleSave} disabled={submitting}
            >
              {submitting
                ? <ActivityIndicator color={colors.dark} />
                : <Text style={styles.matchStartBtnText}>✓ Save Stats & Close Game</Text>
              }
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ─── Score Tab ────────────────────────────────────────────────────────────────
function ScoreTab({ refereeId }) {
  const queryClient = useQueryClient();
  const [selectedGame, setSelectedGame] = useState(null);

  const { data: fixtures = [], isLoading, refetch } = useQuery({
    queryKey: ['refFixturesScore', refereeId],
    queryFn: () => fetchMyFixtures(refereeId),
    enabled: !!refereeId,
  });
  const { data: allGames = [] } = useQuery({
    queryKey: ['refereeGames'],
    queryFn: fetchScoreGames,
  });

  // Merge: fixtures first, then other open/active games not already in fixtures
  const fixtureIds = new Set(fixtures.map(g => g.id));
  const otherGames = allGames.filter(g => !fixtureIds.has(g.id));

  if (isLoading) return <View style={styles.center}><ActivityIndicator color={colors.gold} size="large" /></View>;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.list}>

        {fixtures.length > 0 && (
          <>
            <Text style={styles.scoreSection}>📅 Your Fixtures</Text>
            {fixtures.map(item => (
              <TouchableOpacity key={item.id} style={[styles.gameCard, { borderColor: colors.gold }]}
                onPress={() => setSelectedGame(item)} activeOpacity={0.85}>
                <View style={styles.gameCardLeft}>
                  <Text style={styles.gameCardTitle} numberOfLines={1}>{item.location?.split(',')[0]}</Text>
                  <Text style={styles.gameCardMeta}>{item.format} · {formatDate(item.kickoff_time)}</Text>
                  <Text style={styles.gameCardPlayers}>👥 {item.game_players?.length || 0} players</Text>
                </View>
                <View style={styles.gameCardRight}>
                  <Text style={styles.arrowIcon}>›</Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}

        {otherGames.length > 0 && (
          <>
            <Text style={styles.scoreSection}>⚽ Other Games</Text>
            {otherGames.map(item => (
              <TouchableOpacity key={item.id} style={styles.gameCard}
                onPress={() => setSelectedGame(item)} activeOpacity={0.85}>
                <View style={styles.gameCardLeft}>
                  <Text style={styles.gameCardTitle} numberOfLines={1}>{item.location?.split(',')[0]}</Text>
                  <Text style={styles.gameCardMeta}>{item.format} · {formatDate(item.kickoff_time)}</Text>
                  <Text style={styles.gameCardPlayers}>👥 {item.game_players?.length || 0} players</Text>
                </View>
                <View style={styles.gameCardRight}>
                  <View style={[styles.statusDot, { backgroundColor: item.status === 'active' ? colors.gold : colors.success }]} />
                  <Text style={styles.statusLabel}>{item.status === 'active' ? 'Live' : 'Open'}</Text>
                  <Text style={styles.arrowIcon}>›</Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}

        {fixtures.length === 0 && otherGames.length === 0 && (
          <View style={styles.center}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No games yet</Text>
            <Text style={styles.emptySub}>Accept a game from Feed to manage it here.</Text>
          </View>
        )}
      </ScrollView>

      {selectedGame && (
        <MatchModal
          game={selectedGame}
          visible={!!selectedGame}
          onClose={() => setSelectedGame(null)}
          onSaved={() => {
            queryClient.invalidateQueries(['refFixturesScore', refereeId]);
            queryClient.invalidateQueries(['refereeGames']);
            setSelectedGame(null);
          }}
        />
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function RefereeScreen() {
  const { player } = useAuth();
  const [activeSection, setActiveSection] = useState('Feed');

  if (!player?.is_referee && !player?.is_admin) {
    return (
      <View style={styles.center}>
        <Text style={styles.lockIcon}>🔒</Text>
        <Text style={styles.lockText}>Referee Access Only</Text>
        <Text style={styles.lockSub}>Contact your admin to get referee access.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Tab bar */}
      <View style={styles.tabBar}>
        {SECTIONS.map(s => (
          <TouchableOpacity
            key={s}
            style={[styles.tabBtn, activeSection === s && styles.tabBtnActive]}
            onPress={() => setActiveSection(s)}
          >
            <Text style={[styles.tabBtnText, activeSection === s && styles.tabBtnTextActive]}>
              {s === 'Feed' ? '📋 Feed' : s === 'Score' ? '🟨 Score' : '👤 Profile'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeSection === 'Feed'    && <FeedTab refereeId={player?.id} />}
      {activeSection === 'Score'   && <ScoreTab refereeId={player?.id} />}
      {activeSection === 'Profile' && <ProfileTab player={player} />}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.dark },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  lockIcon: { fontSize: 48, marginBottom: spacing.md },
  lockText: { color: colors.white, fontSize: 20, fontWeight: 'bold', marginBottom: spacing.xs },
  lockSub: { color: colors.gray, fontSize: 14, textAlign: 'center' },
  errorText: { color: colors.error, fontSize: 16, marginBottom: spacing.md },
  retryBtn: { backgroundColor: colors.darkCard, borderRadius: radius.md, padding: spacing.sm, paddingHorizontal: spacing.lg },
  retryText: { color: colors.gold },

  // Tab bar
  tabBar: {
    flexDirection: 'row', borderBottomWidth: 1,
    borderBottomColor: colors.darkBorder, backgroundColor: colors.darkCard,
  },
  tabBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.gold },
  tabBtnText: { color: colors.gray, fontSize: 13, fontWeight: '600' },
  tabBtnTextActive: { color: colors.gold, fontWeight: 'bold' },

  // Feed tab
  feedContent: { padding: spacing.md, paddingBottom: 80 },
  feedSection: {
    color: colors.grayLight, fontSize: 12, fontWeight: 'bold',
    letterSpacing: 1, textTransform: 'uppercase',
    marginTop: spacing.md, marginBottom: spacing.sm,
  },
  oppCard: {
    backgroundColor: colors.darkCard, borderRadius: radius.lg,
    padding: spacing.md, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.darkBorder,
  },
  oppCardTop: { flexDirection: 'row', marginBottom: spacing.md },
  oppCardTitle: { color: colors.white, fontSize: 15, fontWeight: 'bold', marginBottom: 4 },
  oppCardMeta: { color: colors.gray, fontSize: 12, marginBottom: 2 },
  oppCardRight: { alignItems: 'flex-end', gap: spacing.xs },
  payBadge: {
    backgroundColor: 'rgba(76,175,80,0.15)', borderRadius: radius.sm,
    paddingVertical: 3, paddingHorizontal: spacing.sm,
    borderWidth: 1, borderColor: colors.success,
  },
  payBadgeText: { color: colors.success, fontSize: 13, fontWeight: 'bold' },
  payBadgeMuted: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: colors.darkBorder },
  payBadgeTextMuted: { color: colors.gray },
  refsNeeded: { color: colors.gold, fontSize: 12, fontWeight: '600' },
  oppCardActions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  acceptBtn: {
    flex: 1, backgroundColor: colors.gold,
    borderRadius: radius.md, padding: spacing.sm,
    alignItems: 'center',
  },
  acceptBtnText: { color: colors.dark, fontWeight: 'bold', fontSize: 14 },
  acceptedBadge: {
    flex: 1, borderRadius: radius.md, padding: spacing.sm,
    alignItems: 'center', borderWidth: 1, borderColor: colors.success,
  },
  acceptedText: { color: colors.success, fontWeight: 'bold', fontSize: 14 },
  declineBtn: {
    paddingVertical: spacing.xs, paddingHorizontal: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.error,
  },
  declineBtnText: { color: colors.error, fontSize: 12 },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle: { color: colors.white, fontSize: 18, fontWeight: 'bold', marginBottom: spacing.xs },
  emptySub: { color: colors.gray, fontSize: 13, textAlign: 'center' },

  // Score tab
  list: { padding: spacing.md, paddingBottom: 100 },
  listHeader: { color: colors.gray, fontSize: 12, textAlign: 'center', marginBottom: spacing.md },
  gameCard: {
    backgroundColor: colors.darkCard, borderRadius: radius.lg,
    padding: spacing.md, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.darkBorder,
    flexDirection: 'row', alignItems: 'center',
  },
  gameCardLeft: { flex: 1 },
  gameCardTitle: { color: colors.white, fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  gameCardMeta: { color: colors.gray, fontSize: 13, marginBottom: 4 },
  gameCardPlayers: { color: colors.grayLight, fontSize: 12 },
  gameCardRight: { alignItems: 'center', gap: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { color: colors.gray, fontSize: 11 },
  arrowIcon: { color: colors.gold, fontSize: 22, fontWeight: 'bold' },

  // Profile tab
  profileContent: { padding: spacing.md, paddingBottom: 80 },
  profileHero: { alignItems: 'center', marginBottom: spacing.xl },
  profileAvatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.darkBorder, borderWidth: 3, borderColor: colors.gold,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
  },
  profileAvatarText: { color: colors.gold, fontSize: 30, fontWeight: 'bold' },
  profileAvatarImg: { width: 80, height: 80, borderRadius: 40 },
  bonusCard: {
    backgroundColor: colors.darkCard, borderRadius: radius.lg,
    padding: spacing.md, marginHorizontal: spacing.md, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.gold,
  },
  bonusCardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  bonusIcon: { fontSize: 28 },
  bonusTitle: { color: colors.white, fontSize: 15, fontWeight: 'bold' },
  bonusSub: { color: colors.gray, fontSize: 12, marginTop: 2 },
  bonusCount: { color: colors.gold, fontSize: 18, fontWeight: 'bold' },
  bonusTrack: {
    height: 8, backgroundColor: colors.darkBorder,
    borderRadius: 4, overflow: 'hidden',
  },
  bonusFill: { height: 8, borderRadius: 4 },
  profileName: { color: colors.white, fontSize: 22, fontWeight: 'bold', marginBottom: spacing.xs },
  refBadge: {
    backgroundColor: 'rgba(201,168,76,0.15)', borderRadius: radius.full,
    paddingVertical: 4, paddingHorizontal: spacing.md,
    borderWidth: 1, borderColor: colors.gold, marginBottom: spacing.sm,
  },
  refBadgeText: { color: colors.gold, fontSize: 13, fontWeight: '600' },
  avgRatingRow: { alignItems: 'center', gap: 4, marginTop: spacing.xs },
  avgRatingText: { color: colors.gray, fontSize: 12 },
  starRow: { flexDirection: 'row', gap: 2 },
  star: { fontSize: 20, color: colors.darkBorder },
  starFilled: { color: colors.gold },

  profileSection: {
    backgroundColor: colors.darkCard, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.darkBorder,
    marginBottom: spacing.md,
  },
  profileSectionTitle: { color: colors.gold, fontWeight: 'bold', fontSize: 14, marginBottom: spacing.sm },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.dark,
  },
  infoKey: { color: colors.gray, fontSize: 13 },
  infoVal: { color: colors.white, fontSize: 13, fontWeight: '500', flex: 1, textAlign: 'right' },

  statsRow: {
    flexDirection: 'row', backgroundColor: colors.darkCard,
    borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.darkBorder, marginBottom: spacing.md,
  },
  statBox: { flex: 1, alignItems: 'center' },
  statVal: { color: colors.gold, fontSize: 26, fontWeight: 'bold' },
  statLbl: { color: colors.gray, fontSize: 11, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: colors.darkBorder },

  historyRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.dark, gap: spacing.sm,
  },
  historyTitle: { color: colors.white, fontSize: 13, fontWeight: '600' },
  historyMeta: { color: colors.gray, fontSize: 11, marginTop: 2 },
  historyStatus: {
    borderRadius: radius.sm, borderWidth: 1,
    paddingVertical: 2, paddingHorizontal: spacing.sm,
  },
  historyStatusText: { fontSize: 10, fontWeight: 'bold' },
  noDataText: { color: colors.gray, fontSize: 13, fontStyle: 'italic' },

  ratingBarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  ratingBarLabel: { color: colors.gold, fontSize: 12, width: 22, textAlign: 'right' },
  ratingBarTrack: { flex: 1, height: 8, backgroundColor: colors.dark, borderRadius: 4, overflow: 'hidden' },
  ratingBarFill: { height: '100%', backgroundColor: colors.gold, borderRadius: 4 },
  ratingBarCount: { color: colors.gray, fontSize: 12, width: 20 },

  // Modal
  modalContainer: { flex: 1, backgroundColor: colors.dark },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center',
    padding: spacing.md, paddingTop: spacing.xl,
    borderBottomWidth: 1, borderBottomColor: colors.darkBorder, gap: spacing.md,
  },
  modalBack: { padding: spacing.xs },
  modalBackText: { color: colors.gold, fontSize: 18, fontWeight: 'bold' },
  modalTitle: { color: colors.white, fontSize: 15, fontWeight: 'bold', flex: 1 },
  modalContent: { padding: spacing.md, paddingBottom: 120 },
  section: {
    backgroundColor: colors.darkCard, borderRadius: radius.lg,
    padding: spacing.md, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.darkBorder,
  },
  sectionTitle: { color: colors.gold, fontSize: 11, fontWeight: 'bold', letterSpacing: 1, marginBottom: spacing.sm },
  sectionHint: { color: colors.gray, fontSize: 12, marginBottom: spacing.md },
  teamStrengthRow: {
    flexDirection: 'row', backgroundColor: colors.dark,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.darkBorder, overflow: 'hidden',
  },
  teamStrengthBox: { flex: 1, alignItems: 'center', padding: spacing.md },
  teamStrengthLabel: { color: colors.grayLight, fontSize: 12, fontWeight: 'bold', marginBottom: 4 },
  teamStrengthRating: { color: colors.gold, fontSize: 20, fontWeight: 'bold' },
  teamStrengthCount: { color: colors.gray, fontSize: 11, marginTop: 2 },
  teamStrengthDivider: { width: 1, backgroundColor: colors.darkBorder },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  scoreBox: { alignItems: 'center', flex: 1 },
  scoreTeamLabel: { color: colors.gray, fontSize: 12, marginBottom: spacing.xs },
  scoreInput: {
    backgroundColor: colors.dark, borderWidth: 1, borderColor: colors.darkBorder,
    borderRadius: radius.md, color: colors.white, fontSize: 36, fontWeight: 'bold',
    textAlign: 'center', width: 80, padding: spacing.sm,
  },
  scoreDash: { color: colors.gray, fontSize: 28, fontWeight: 'bold' },
  playerRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.darkBorder,
  },
  playerInfo: { flex: 1 },
  playerName: { color: colors.white, fontSize: 14, fontWeight: '600' },
  playerRole: { color: colors.gray, fontSize: 12, marginTop: 2 },
  teamBtns: { flexDirection: 'row', gap: spacing.sm },
  teamBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: colors.darkBorder, alignItems: 'center', justifyContent: 'center' },
  teamBtnA: { borderColor: colors.gold, backgroundColor: colors.goldDim },
  teamBtnB: { borderColor: '#4A90D9', backgroundColor: 'rgba(74,144,217,0.15)' },
  teamBtnText: { color: colors.gray, fontWeight: 'bold', fontSize: 14 },
  teamBtnTextActive: { color: colors.white },
  teamDivider: { color: colors.grayLight, fontSize: 12, fontWeight: 'bold', marginTop: spacing.sm, marginBottom: spacing.xs, textTransform: 'uppercase', letterSpacing: 1 },
  statRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.darkBorder },
  statControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  counterGroup: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  counterLabel: { fontSize: 14, marginRight: 2 },
  goalBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.dark, borderWidth: 1, borderColor: colors.darkBorder, alignItems: 'center', justifyContent: 'center' },
  goalBtnText: { color: colors.gold, fontSize: 16, fontWeight: 'bold', lineHeight: 20 },
  goalCount: { color: colors.white, fontSize: 15, fontWeight: 'bold', minWidth: 18, textAlign: 'center' },
  cardBtn: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.darkBorder, alignItems: 'center', justifyContent: 'center' },
  cardBtnText: { fontSize: 13, color: colors.white },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.darkBorder },
  previewName: { color: colors.white, fontSize: 13 },
  previewPts: { color: colors.gold, fontSize: 13, fontWeight: 'bold' },
  submitRow: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: spacing.md, backgroundColor: colors.dark, borderTopWidth: 1, borderTopColor: colors.darkBorder },
  submitBtn: { backgroundColor: colors.gold, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  submitBtnText: { color: colors.dark, fontWeight: 'bold', fontSize: 16 },

  // Score tab sections
  scoreSection: {
    color: colors.grayLight, fontSize: 12, fontWeight: 'bold',
    letterSpacing: 1, textTransform: 'uppercase',
    marginTop: spacing.md, marginBottom: spacing.sm,
  },

  // Match Modal
  matchContainer: { flex: 1, backgroundColor: colors.dark },
  matchHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.md, paddingTop: spacing.xl,
    borderBottomWidth: 1, borderBottomColor: colors.darkBorder,
    backgroundColor: colors.darkCard,
  },
  matchHeaderTitle: { color: colors.white, fontSize: 16, fontWeight: 'bold' },
  matchHeaderMeta: { color: colors.gray, fontSize: 12, marginTop: 2 },
  phaseTitle: { color: colors.gold, fontSize: 17, fontWeight: 'bold', padding: spacing.md, paddingBottom: spacing.xs },
  phaseHint: { color: colors.gray, fontSize: 12, paddingHorizontal: spacing.md, marginBottom: spacing.sm },

  // Attendance
  attendanceRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.darkCard, borderRadius: radius.md, padding: spacing.sm,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.darkBorder,
  },
  attendanceLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  attAvatar: { width: 44, height: 44, borderRadius: 22 },
  attAvatarFallback: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.darkBorder, alignItems: 'center', justifyContent: 'center',
  },
  attAvatarText: { color: colors.gold, fontSize: 16, fontWeight: 'bold' },
  attName: { color: colors.white, fontSize: 14, fontWeight: '600' },
  attRole: { color: colors.gray, fontSize: 12, marginTop: 2 },
  attRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  // Timer
  timerBlock: {
    alignItems: 'center', padding: spacing.lg,
    backgroundColor: colors.darkCard, borderBottomWidth: 1, borderBottomColor: colors.darkBorder,
  },
  timerPhase: { fontSize: 13, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.xs },
  timerDisplay: { color: colors.white, fontSize: 56, fontWeight: 'bold', fontVariant: ['tabular-nums'] },
  timerBtns: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  timerBtn: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
    borderRadius: radius.md, alignItems: 'center',
  },
  timerBtnText: { color: colors.white, fontWeight: 'bold', fontSize: 14 },

  // Live player cards
  liveTeamHeader: {
    color: colors.gold, fontSize: 12, fontWeight: 'bold',
    letterSpacing: 1, textTransform: 'uppercase',
    marginTop: spacing.md, marginBottom: spacing.sm,
  },
  liveCard: {
    backgroundColor: colors.darkCard, borderRadius: radius.md, padding: spacing.sm,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.darkBorder,
    borderLeftWidth: 4, flexDirection: 'row', alignItems: 'center',
  },
  liveCardLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  liveAvatar: { width: 40, height: 40, borderRadius: 20 },
  liveAvatarFallback: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 2,
    backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center',
  },
  liveAvatarText: { fontSize: 14, fontWeight: 'bold' },
  livePlayerName: { color: colors.white, fontSize: 13, fontWeight: '600' },
  livePlayerRole: { color: colors.gray, fontSize: 11, marginTop: 1 },
  liveCardControls: { alignItems: 'flex-end', gap: spacing.xs },
  liveGoalRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveCntBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.dark, borderWidth: 1, borderColor: colors.darkBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  liveCntBtnText: { color: colors.gold, fontSize: 18, fontWeight: 'bold', lineHeight: 22 },
  liveGoalVal: { color: colors.white, fontSize: 14, fontWeight: 'bold', minWidth: 36, textAlign: 'center' },
  liveCardBtns: { flexDirection: 'row', gap: 6 },
  liveCardBtn: {
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.darkBorder,
    backgroundColor: colors.dark,
  },
  liveCardBtnText: { fontSize: 13, color: colors.white },

  // Break screen
  breakScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  breakIcon: { fontSize: 56, marginBottom: spacing.md },
  breakTitle: { color: colors.white, fontSize: 24, fontWeight: 'bold', marginBottom: spacing.sm },
  breakSub: { color: colors.gray, fontSize: 14, textAlign: 'center' },

  // Final phase
  finalScoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg, marginBottom: spacing.xl },
  finalScoreBox: { alignItems: 'center', flex: 1 },
  finalScoreLabel: { color: colors.gray, fontSize: 13, marginBottom: spacing.xs },
  finalScoreInput: {
    backgroundColor: colors.darkCard, borderWidth: 1, borderColor: colors.darkBorder,
    borderRadius: radius.md, color: colors.white, fontSize: 40, fontWeight: 'bold',
    textAlign: 'center', width: 90, padding: spacing.sm,
  },
  finalScoreDash: { color: colors.gray, fontSize: 30, fontWeight: 'bold' },
  finalStatsHeader: {
    color: colors.gold, fontSize: 12, fontWeight: 'bold', letterSpacing: 1,
    textTransform: 'uppercase', marginBottom: spacing.sm,
  },
  finalStatRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.darkCard, borderRadius: radius.sm,
    padding: spacing.sm, marginBottom: spacing.xs,
    borderWidth: 1, borderColor: colors.darkBorder,
  },
  finalStatTeam: { fontSize: 12, fontWeight: 'bold', width: 16 },
  finalStatName: { color: colors.white, fontSize: 13, flex: 1 },
  finalStatGoals: { color: colors.gray, fontSize: 12 },
  finalStatCard: { fontSize: 12 },

  // Match footer
  matchFooter: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: spacing.md, backgroundColor: colors.dark,
    borderTopWidth: 1, borderTopColor: colors.darkBorder,
  },
  matchFooterHint: { color: colors.gray, fontSize: 12, textAlign: 'center', marginBottom: spacing.sm },
  matchStartBtn: {
    backgroundColor: colors.gold, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center',
  },
  matchStartBtnText: { color: colors.dark, fontWeight: 'bold', fontSize: 16 },
});

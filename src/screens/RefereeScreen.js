import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, ScrollView, TextInput, Modal, Image,
  AppState,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { colors, spacing, radius } from '../theme';

const SECTIONS = ['Feed', 'Fixtures', 'Rankings', 'Profile'];

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
    .select('game_id, checked_in, games(*, game_players(player_id, team, players(id, first_name, last_name, name, role, rating, avatar_url)))')
    .eq('referee_id', refereeId)
    .eq('status', 'accepted');
  if (error) return [];
  // Merge checked_in onto the game object so it travels through the app
  return (data || []).map(r => r.games ? { ...r.games, checked_in: r.checked_in ?? false } : null).filter(Boolean);
}

async function fetchRefereeRatings(refereeId) {
  const { data, error } = await supabase
    .from('referee_ratings')
    .select('rating, game_id, created_at')
    .eq('referee_id', refereeId);
  if (error) return [];
  return data || [];
}

async function fetchRefereeRankings() {
  const { data, error } = await supabase
    .from('players')
    .select('id, first_name, last_name, name, avatar_url, points, games_played')
    .eq('role', 'Referee')
    .order('points', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ─── Team balancer ────────────────────────────────────────────────────────────
// Optimal size-constrained balancer:
// 1. One GK per team (best GK → A, second → B)
// 2. Remaining players sorted by rating DESC; each assigned to whichever team
//    produces the smallest projected average difference, respecting hard size caps
//    (Dark = floor(n/2), White = ceil(n/2)).
function balanceTeams(gamePlayers) {
  const assignment = {};
  const n = gamePlayers.length;
  const capA = Math.floor(n / 2);   // Dark (smaller or equal)
  const capB = Math.ceil(n / 2);    // White (larger or equal)

  const mapped = gamePlayers.map(gp => ({
    player_id: gp.player_id,
    role: gp.players?.role || 'Outfield',
    rating: gp.players?.rating ?? 2.5,
  }));

  // Separate GKs: best goes to A, second to B
  const gks = mapped
    .filter(p => p.role === 'Goalkeeper' || p.role === 'Versatile')
    .sort((a, b) => b.rating - a.rating);
  const outfield = mapped
    .filter(p => p.role !== 'Goalkeeper' && p.role !== 'Versatile')
    .sort((a, b) => b.rating - a.rating);

  let sumA = 0, sumB = 0, cA = 0, cB = 0;

  if (gks[0]) { assignment[gks[0].player_id] = 'A'; sumA += gks[0].rating; cA++; }
  if (gks[1]) { assignment[gks[1].player_id] = 'B'; sumB += gks[1].rating; cB++; }

  const remaining = [...gks.slice(2), ...outfield].sort((a, b) => b.rating - a.rating);

  for (const p of remaining) {
    let pick;
    if (cA >= capA) {
      pick = 'B'; // A is full
    } else if (cB >= capB) {
      pick = 'A'; // B is full
    } else if (cA === 0 && cB === 0) {
      pick = 'A'; // first assignment always Dark
    } else {
      // Project avg if we add this player to each team
      const avgA_if = (sumA + p.rating) / (cA + 1);
      const avgB_now = cB > 0 ? sumB / cB : avgA_if;
      const diffIfA = Math.abs(avgA_if - avgB_now);

      const avgB_if = (sumB + p.rating) / (cB + 1);
      const avgA_now = cA > 0 ? sumA / cA : avgB_if;
      const diffIfB = Math.abs(avgA_now - avgB_if);

      pick = diffIfA <= diffIfB ? 'A' : 'B';
    }

    assignment[p.player_id] = pick;
    if (pick === 'A') { sumA += p.rating; cA++; }
    else              { sumB += p.rating; cB++; }
  }

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
                  <Text style={styles.teamStrengthLabel}>🖤 Dark</Text>
                  <Text style={styles.teamStrengthRating}>⭐ {teamAvgRating(teamA.map(g => g.player_id), players)}</Text>
                  <Text style={styles.teamStrengthCount}>{teamA.length} players</Text>
                </View>
                <View style={styles.teamStrengthDivider} />
                <View style={styles.teamStrengthBox}>
                  <Text style={styles.teamStrengthLabel}>🤍 White</Text>
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
                  <Text style={styles.scoreTeamLabel}>🖤 Dark</Text>
                  <TextInput style={styles.scoreInput} value={scoreA} onChangeText={setScoreA} keyboardType="number-pad" maxLength={2} placeholder="0" placeholderTextColor={colors.gray} />
                </View>
                <Text style={styles.scoreDash}>—</Text>
                <View style={styles.scoreBox}>
                  <Text style={styles.scoreTeamLabel}>🤍 White</Text>
                  <TextInput style={styles.scoreInput} value={scoreB} onChangeText={setScoreB} keyboardType="number-pad" maxLength={2} placeholder="0" placeholderTextColor={colors.gray} />
                </View>
              </View>
            </View>
          )}

          {(teamA.length > 0 || teamB.length > 0) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>PLAYER STATS</Text>
              <Text style={styles.sectionHint}>Goals · 🟡 Yellow (-1pt) · 🔴 Red (-3pts)</Text>
              {teamA.length > 0 && (<><Text style={styles.teamDivider}>🖤 Dark</Text>{teamA.map(gp => <GoalRow key={gp.player_id} gp={gp} goals={goals} cards={cards} onAdjustGoals={adjustGoals} onAdjustCards={adjustCards} />)}</>)}
              {teamB.length > 0 && (<><Text style={styles.teamDivider}>🤍 White</Text>{teamB.map(gp => <GoalRow key={gp.player_id} gp={gp} goals={goals} cards={cards} onAdjustGoals={adjustGoals} onAdjustCards={adjustCards} />)}</>)}
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
  const { t } = useLanguage();

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
        <Text style={styles.emptyTitle}>{t('referee.noOpenings')}</Text>
        <Text style={styles.emptySub}>{t('referee.noOpeningsSub')}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.feedContent}>

      {/* Your Fixtures */}
      {fixtures.length > 0 && (
        <>
          <Text style={styles.feedSection}>{t('referee.yourFixtures')}</Text>
          {fixtures.map(g => (
            <View key={g.id} style={[styles.oppCard, { borderColor: colors.gold }]}>
              <View style={styles.oppCardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.oppCardTitle} numberOfLines={1}>{g.location?.split(',')[0]}</Text>
                  <Text style={styles.oppCardMeta}>{g.format} · {formatDate(g.kickoff_time)}</Text>
                  <Text style={styles.oppCardMeta}>👥 {g.game_players?.length || 0} {t('referee.playersRegistered')}</Text>
                </View>
                <View style={[styles.acceptedBadge, { flex: 0, paddingHorizontal: spacing.sm }]}>
                  <Text style={styles.acceptedText}>{t('referee.confirmed')}</Text>
                </View>
              </View>
            </View>
          ))}
        </>
      )}

      {games.length > 0 && (
        <>
          <Text style={styles.feedSection}>{t('referee.gamesSection')}</Text>
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
                        <Text style={styles.acceptedText}>{t('referee.accepted')}</Text>
                      </View>
                      <TouchableOpacity style={styles.declineBtn} onPress={() => handleDecline(g.id)}>
                        <Text style={styles.declineBtnText}>{t('referee.withdraw')}</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity style={styles.acceptBtn} onPress={() => handleAccept(g.id)}>
                      <Text style={styles.acceptBtnText}>{t('referee.acceptGame')}</Text>
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
          <Text style={styles.feedSection}>{t('referee.tournamentsSection')}</Text>
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
                        <Text style={styles.acceptedText}>{t('referee.accepted')}</Text>
                      </View>
                      <TouchableOpacity style={styles.declineBtn} onPress={() => handleDecline(c.id)}>
                        <Text style={styles.declineBtnText}>{t('referee.withdraw')}</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity style={styles.acceptBtn} onPress={() => handleAccept(c.id)}>
                      <Text style={styles.acceptBtnText}>{t('referee.acceptTournament')}</Text>
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

// ─── Rankings Tab ─────────────────────────────────────────────────────────────
function RefereeRankingsTab({ currentRefereeId }) {
  const { t } = useLanguage();

  const { data: referees = [], isLoading } = useQuery({
    queryKey: ['refereeRankings'],
    queryFn: fetchRefereeRankings,
    refetchInterval: 5 * 60 * 1000,
  });

  if (isLoading) {
    return <View style={styles.center}><ActivityIndicator color={colors.gold} size="large" /></View>;
  }

  if (referees.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>🏆</Text>
        <Text style={styles.emptyTitle}>{t('referee.noRankings')}</Text>
        <Text style={styles.emptySub}>{t('referee.noRankingsSub')}</Text>
      </View>
    );
  }

  const MEDAL = ['🥇', '🥈', '🥉'];

  return (
    <ScrollView contentContainerStyle={styles.rankingsContent}>
      <View style={styles.rankingsHeader}>
        <Text style={styles.rankingsTitle}>{t('referee.topReferees')}</Text>
      </View>

      {/* Column headers */}
      <View style={styles.rankRow}>
        <Text style={[styles.rankCol, styles.rankColRank]}>{t('referee.rankLabel')}</Text>
        <Text style={[styles.rankCol, { flex: 1 }]}>{t('referee.refereeLabel')}</Text>
        <Text style={[styles.rankCol, styles.rankColStat]}>{t('referee.gamesRefereed')}</Text>
        <Text style={[styles.rankCol, styles.rankColStat]}>{t('referee.pointsLabel')}</Text>
      </View>

      {referees.map((ref, index) => {
        const isMe = ref.id === currentRefereeId;
        const name = [ref.first_name, ref.last_name].filter(Boolean).join(' ') || ref.name || 'Referee';
        const initials = [ref.first_name?.[0], ref.last_name?.[0]].filter(Boolean).join('').toUpperCase() || 'R';
        const medal = MEDAL[index] || null;
        return (
          <View key={ref.id} style={[styles.rankRow, styles.rankRowData, isMe && styles.rankRowMe]}>
            <View style={[styles.rankCol, styles.rankColRank, { alignItems: 'center' }]}>
              {medal
                ? <Text style={styles.rankMedal}>{medal}</Text>
                : <Text style={[styles.rankNum, isMe && { color: colors.gold }]}>{index + 1}</Text>
              }
            </View>
            <View style={[styles.rankCol, { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
              {ref.avatar_url
                ? <Image source={{ uri: ref.avatar_url }} style={styles.rankAvatar} />
                : <View style={styles.rankAvatarFallback}><Text style={styles.rankAvatarText}>{initials}</Text></View>
              }
              <View style={{ flex: 1 }}>
                <Text style={[styles.rankName, isMe && { color: colors.gold }]} numberOfLines={1}>{name}</Text>
                {isMe && <Text style={styles.rankYouLabel}>← You</Text>}
              </View>
            </View>
            <Text style={[styles.rankCol, styles.rankColStat, styles.rankStatVal]}>{ref.games_played ?? 0}</Text>
            <Text style={[styles.rankCol, styles.rankColStat, styles.rankStatPts, isMe && { color: colors.gold }]}>
              {ref.points ?? 0}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

// ─── Profile Tab ──────────────────────────────────────────────────────────────
function ProfileTab({ player }) {
  const { t } = useLanguage();
  const { language, setLanguage } = useLanguage();
  const { signOut } = useAuth();
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

  function handleSignOut() {
    Alert.alert(t('referee.signOutTitle'), t('referee.signOutMsg'), [
      { text: t('referee.cancel'), style: 'cancel' },
      { text: t('referee.signOut'), style: 'destructive', onPress: signOut },
    ]);
  }

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
          <Text style={styles.refBadgeText}>{t('referee.officialReferee')}</Text>
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
                <Text style={styles.bonusTitle}>{t('referee.bonusTitle')}</Text>
                <Text style={styles.bonusSub}>
                  {earned
                    ? t('referee.bonusEarned')
                    : `${gamesLeft} ${gamesLeft !== 1 ? t('referee.bonusLeftPlural') : t('referee.bonusLeft')}`}
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
        <Text style={styles.profileSectionTitle}>{t('referee.credentials')}</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoKey}>{t('referee.email')}</Text>
          <Text style={styles.infoVal}>{player?.email || '—'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoKey}>{t('referee.phone')}</Text>
          <Text style={styles.infoVal}>{player?.phone || '—'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoKey}>{t('referee.certification')}</Text>
          <Text style={styles.infoVal}>{player?.referee_cert || '—'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoKey}>{t('referee.experience')}</Text>
          <Text style={styles.infoVal}>{player?.referee_experience || '—'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoKey}>{t('referee.formats')}</Text>
          <Text style={styles.infoVal}>{Array.isArray(player?.referee_formats) ? player.referee_formats.join(', ') : (player?.referee_formats || '—')}</Text>
        </View>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{history.length}</Text>
          <Text style={styles.statLbl}>{t('referee.gamesLabel')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{avgRating ?? '—'}</Text>
          <Text style={styles.statLbl}>{t('referee.avgRating')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{ratings.length}</Text>
          <Text style={styles.statLbl}>{t('referee.reviews')}</Text>
        </View>
      </View>

      {/* Game History */}
      <View style={styles.profileSection}>
        <Text style={styles.profileSectionTitle}>{t('referee.gameHistory')}</Text>
        {history.length === 0 ? (
          <Text style={styles.noDataText}>{t('referee.noGamesRefereed')}</Text>
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
          <Text style={styles.profileSectionTitle}>{t('referee.playerRatings')}</Text>
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

      {/* Language toggle */}
      <View style={styles.profileSection}>
        <Text style={styles.profileSectionTitle}>{t('referee.language')}</Text>
        <View style={styles.langRow}>
          <TouchableOpacity
            style={[styles.langBtn, language === 'en' && styles.langBtnActive]}
            onPress={() => setLanguage('en')}
          >
            <Text style={[styles.langBtnText, language === 'en' && styles.langBtnTextActive]}>🇺🇸 English</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.langBtn, language === 'es' && styles.langBtnActive]}
            onPress={() => setLanguage('es')}
          >
            <Text style={[styles.langBtnText, language === 'es' && styles.langBtnTextActive]}>🇪🇸 Español</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Sign Out */}
      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutBtnText}>{t('referee.signOut')}</Text>
      </TouchableOpacity>

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

function MatchModal({ game, visible, onClose, onSaved, initialPresent }) {
  const players = game?.game_players || [];

  // Phase: 'attendance' | 'first_half' | 'break' | 'second_half' | 'final'
  // If initialPresent passed, skip attendance and go straight to first_half
  const [phase, setPhase]       = useState(initialPresent ? 'first_half' : 'attendance');
  const [present, setPresent]   = useState(() => {
    if (initialPresent) return initialPresent;
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
  const [matchNotes, setMatchNotes] = useState('');
  const [timeLeft, setTimeLeft] = useState(FIRST_HALF_SECS);
  const [running, setRunning]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const intervalRef   = useRef(null);
  const endTimeRef    = useRef(null);  // absolute ms timestamp when current phase ends
  const appStateRef   = useRef(AppState.currentState);

  // Re-init when game changes
  useEffect(() => {
    if (!visible) return;
    setPhase(initialPresent ? 'first_half' : 'attendance');
    setGoals({}); setCards({}); setScoreA(''); setScoreB('');
    setTimeLeft(FIRST_HALF_SECS); setRunning(initialPresent ? true : false);
    if (initialPresent) {
      setPresent(initialPresent);
    } else {
      const m = {};
      players.forEach(gp => { m[gp.player_id] = true; });
      setPresent(m);
    }
    const t = {};
    players.forEach(gp => { if (gp.team) t[gp.player_id] = gp.team; });
    setTeams(t);
  }, [game?.id, visible]);

  // ── Wall-clock timer ─────────────────────────────────────────────────────────
  // Instead of decrementing every second (pauses in background), we record the
  // absolute end timestamp and derive remaining time from Date.now() on each tick.
  // The interval only drives UI repaints; the actual time comes from the system clock.
  useEffect(() => {
    if (running) {
      // Set end timestamp only on a fresh start (not on re-render)
      if (!endTimeRef.current) {
        endTimeRef.current = Date.now() + timeLeft * 1000;
      }
      intervalRef.current = setInterval(() => {
        const remaining = Math.max(0, Math.round((endTimeRef.current - Date.now()) / 1000));
        setTimeLeft(remaining);
        if (remaining <= 0) {
          clearInterval(intervalRef.current);
          endTimeRef.current = null;
          setRunning(false);
        }
      }, 500); // 500 ms for snappy UI; actual time is wall-clock accurate
    } else {
      clearInterval(intervalRef.current);
      endTimeRef.current = null;
    }
    return () => clearInterval(intervalRef.current);
  }, [running]);

  // ── AppState listener — snap timer when app returns to foreground ─────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if ((prev === 'background' || prev === 'inactive') && nextState === 'active') {
        // App just came back — recalculate immediately without waiting for next tick
        if (endTimeRef.current) {
          const remaining = Math.max(0, Math.round((endTimeRef.current - Date.now()) / 1000));
          setTimeLeft(remaining);
          if (remaining <= 0) {
            endTimeRef.current = null;
            setRunning(false);
          }
        }
      }
    });
    return () => sub.remove();
  }, []);

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
      // Auto-calculate score from recorded goals
      const presentPl = players.filter(gp => present[gp.player_id]);
      const calcA = presentPl
        .filter(gp => teams[gp.player_id] === 'A')
        .reduce((sum, gp) => sum + (goals[gp.player_id] || 0), 0);
      const calcB = presentPl
        .filter(gp => teams[gp.player_id] === 'B')
        .reduce((sum, gp) => sum + (goals[gp.player_id] || 0), 0);
      setScoreA(String(calcA));
      setScoreB(String(calcB));
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
      // Check if already completed to avoid double-counting stats
      const { data: currentGame } = await supabase
        .from('games').select('status').eq('id', game.id).single();
      const alreadyCompleted = currentGame?.status === 'completed';

      const stats = presentPlayers.map(gp => {
        const p = gp.players; const team = teams[gp.player_id];
        const won = team === 'A' ? a > b : b > a;
        const isGK = p?.role === 'Goalkeeper';
        const conceded = team === 'A' ? b : a;
        const c = cards[gp.player_id] || { yellow: 0, red: 0 };
        return {
          game_id: game.id, player_id: gp.player_id,
          team,                                         // Dark=A / White=B
          goals: goals[gp.player_id] || 0, won, is_goalkeeper: isGK,
          goals_conceded: isGK ? conceded : 0,
          yellow_cards: c.yellow, red_cards: c.red,
        };
      });
      const { error } = await supabase.from('game_player_stats')
        .upsert(stats, { onConflict: 'game_id,player_id' });
      if (error) throw error;

      // Only increment player stats once — skip if game was already completed
      if (!alreadyCompleted) {
        const { error: rpcError } = await supabase.rpc('update_player_stats_after_game', {
          p_game_id: game.id,
        });
        // Log but don't block — admin can re-run manually if function is missing
        if (rpcError) console.warn('update_player_stats_after_game failed:', rpcError.message);
      }

      await supabase.from('games').update({
        status: 'completed',
        score_a: a,
        score_b: b,
        completed_at: new Date().toISOString(),
        referee_notes: matchNotes.trim() || null,
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
                    <Text style={styles.liveTeamHeader}>🖤 Dark</Text>
                    {teamA.map(gp => (
                      <PlayerLiveCard key={gp.player_id} gp={gp} goals={goals} cards={cards}
                        onAdjustGoals={adjustGoals} onAdjustCards={adjustCards} team="A" />
                    ))}
                  </>
                )}
                {teamB.length > 0 && (
                  <>
                    <Text style={[styles.liveTeamHeader, { color: '#4A90D9' }]}>🤍 White</Text>
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
            <Text style={styles.phaseTitle}>🏁 Full Time</Text>
            <Text style={styles.phaseSubtitle}>Score calculated from recorded goals. Adjust if needed (e.g. own goals), then confirm.</Text>
            <View style={styles.finalScoreRow}>
              <View style={styles.finalScoreBox}>
                <Text style={styles.finalScoreLabel}>🖤 Dark</Text>
                <TextInput style={styles.finalScoreInput} value={scoreA} onChangeText={setScoreA}
                  keyboardType="number-pad" maxLength={2} placeholder="0" placeholderTextColor={colors.gray} />
              </View>
              <Text style={styles.finalScoreDash}>—</Text>
              <View style={styles.finalScoreBox}>
                <Text style={styles.finalScoreLabel}>🤍 White</Text>
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

            {/* ── Referee Notes ── */}
            <View style={styles.refNotesBox}>
              <Text style={styles.refNotesLabel}>📋 Referee Notes</Text>
              <Text style={styles.refNotesHint}>
                Log any technical difficulties, disputes, or incidents (optional)
              </Text>
              <TextInput
                style={styles.refNotesInput}
                value={matchNotes}
                onChangeText={setMatchNotes}
                placeholder="e.g. Pitch lights failed at 70', game paused 8 mins. Player dispute resolved."
                placeholderTextColor={colors.gray}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                maxLength={1000}
              />
              <Text style={styles.refNotesCount}>{matchNotes.length}/1000</Text>
            </View>
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
                : <Text style={styles.matchStartBtnText}>✓ Confirm & Close Game</Text>
              }
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ─── Fixture Detail Modal ─────────────────────────────────────────────────────
function FixtureDetailModal({ game, visible, onClose, onStartMatch }) {
  const players = game?.game_players || [];
  const teamA = players.filter(gp => gp.team === 'A');
  const teamB = players.filter(gp => gp.team === 'B');

  // Countdown
  const [timeUntil, setTimeUntil] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!visible || !game?.kickoff_time) return;
    function tick() {
      const diff = new Date(game.kickoff_time) - new Date();
      setTimeUntil(diff);
    }
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => clearInterval(timerRef.current);
  }, [visible, game?.kickoff_time]);

  // Attendance state (active within 15 min)
  const minsUntil = timeUntil != null ? timeUntil / 60000 : 999;
  const showAttendance = minsUntil <= 15;
  const [present, setPresent] = useState(() => {
    const m = {};
    players.forEach(gp => { m[gp.player_id] = true; });
    return m;
  });

  useEffect(() => {
    if (visible) {
      const m = {};
      players.forEach(gp => { m[gp.player_id] = true; });
      setPresent(m);
    }
  }, [visible, game?.id]);

  function togglePresent(pid) {
    setPresent(p => ({ ...p, [pid]: !p[pid] }));
  }

  function pName(gp) {
    const p = gp.players;
    return [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.name || 'Player';
  }

  function formatCountdown(ms) {
    if (ms <= 0) return 'KICK OFF!';
    const totalSecs = Math.floor(ms / 1000);
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
    return `${s}s`;
  }

  const presentCount = Object.values(present).filter(Boolean).length;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.fdContainer}>
        {/* Header */}
        <View style={styles.fdHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalBack}>
            <Text style={styles.modalBackText}>✕</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.fdTitle} numberOfLines={1}>{game?.location?.split(',')[0]}</Text>
            <Text style={styles.fdMeta}>{game?.format} · {game && formatDate(game.kickoff_time)}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.fdScroll}>
          {/* Countdown */}
          <View style={styles.fdCountdownBox}>
            <Text style={styles.fdCountdownLabel}>
              {minsUntil <= 0 ? 'Game Time' : minsUntil <= 15 ? '⚠️ Starting Soon' : 'Kickoff In'}
            </Text>
            <Text style={[styles.fdCountdown, minsUntil <= 15 && { color: '#f44336' }]}>
              {timeUntil != null ? formatCountdown(timeUntil) : '—'}
            </Text>
            <Text style={styles.fdPlayerCount}>👥 {players.length} players registered</Text>
          </View>

          {/* Lineup */}
          <View style={styles.fdSection}>
            <Text style={styles.fdSectionTitle}>📋 LINE-UP</Text>
            <View style={styles.fdTeamsRow}>
              {/* Team A */}
              <View style={styles.fdTeamCol}>
                <Text style={styles.fdTeamDark}>🖤 Dark</Text>
                {teamA.length === 0
                  ? <Text style={styles.fdNoTeam}>TBC</Text>
                  : teamA.map(gp => {
                    const p = gp.players;
                    const rating = p?.rating != null ? p.rating.toFixed(1) : null;
                    return (
                      <View key={gp.player_id} style={styles.fdPlayerRow}>
                        <Text style={styles.fdPlayerName} numberOfLines={1}>{pName(gp)}</Text>
                        {rating && <Text style={styles.fdPlayerRating}>★{rating}</Text>}
                      </View>
                    );
                  })}
                {teamA.length > 0 && (
                  <Text style={styles.fdTeamAvg}>
                    Avg ★{teamAvgRating(teamA.map(g => g.player_id), players)}
                  </Text>
                )}
              </View>

              <View style={styles.fdVsDivider}>
                <Text style={styles.fdVs}>VS</Text>
              </View>

              {/* Team B */}
              <View style={[styles.fdTeamCol, { alignItems: 'flex-end' }]}>
                <Text style={styles.fdTeamBright}>White 🤍</Text>
                {teamB.length === 0
                  ? <Text style={styles.fdNoTeam}>TBC</Text>
                  : teamB.map(gp => {
                    const p = gp.players;
                    const rating = p?.rating != null ? p.rating.toFixed(1) : null;
                    return (
                      <View key={gp.player_id} style={[styles.fdPlayerRow, { flexDirection: 'row-reverse' }]}>
                        <Text style={[styles.fdPlayerName, { textAlign: 'right' }]} numberOfLines={1}>{pName(gp)}</Text>
                        {rating && <Text style={styles.fdPlayerRating}>★{rating}</Text>}
                      </View>
                    );
                  })}
                {teamB.length > 0 && (
                  <Text style={[styles.fdTeamAvg, { textAlign: 'right' }]}>
                    Avg ★{teamAvgRating(teamB.map(g => g.player_id), players)}
                  </Text>
                )}
              </View>
            </View>
          </View>

          {/* Attendance — only within 15 min of kickoff */}
          {showAttendance && (
            <View style={styles.fdSection}>
              <Text style={styles.fdSectionTitle}>✅ ATTENDANCE ({presentCount}/{players.length})</Text>
              <Text style={styles.fdSectionHint}>Tap to mark absent. Present by default.</Text>
              {players.map(gp => {
                const p = gp.players;
                const isPresent = present[gp.player_id] !== false;
                const initials = [p?.first_name?.[0], p?.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?';
                return (
                  <TouchableOpacity
                    key={gp.player_id}
                    style={[styles.fdAttRow, !isPresent && { opacity: 0.45 }]}
                    onPress={() => togglePresent(gp.player_id)}
                    activeOpacity={0.7}
                  >
                    {p?.avatar_url
                      ? <Image source={{ uri: p.avatar_url }} style={styles.fdAttAvatar} />
                      : <View style={styles.fdAttAvatarFallback}><Text style={styles.fdAttInitials}>{initials}</Text></View>
                    }
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fdAttName}>{pName(gp)}</Text>
                      <Text style={styles.fdAttRole}>
                        {p?.role || 'Outfield'} · {gp.team ? (gp.team === 'A' ? 'Dark' : 'White') : 'Unassigned'}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 22 }}>{isPresent ? '✅' : '❌'}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {!showAttendance && (
            <View style={styles.fdInfoBox}>
              <Text style={styles.fdInfoIcon}>⏱️</Text>
              <Text style={styles.fdInfoText}>
                Attendance opens 15 minutes before kickoff.
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Start Match button */}
        <View style={styles.fdFooter}>
          <TouchableOpacity
            style={[styles.fdStartBtn, !showAttendance && styles.fdStartBtnDisabled]}
            onPress={() => onStartMatch(present)}
            disabled={!showAttendance}
          >
            <Text style={styles.fdStartBtnText}>
              {showAttendance ? '▶ Hit Start Match' : `Available ${minsUntil > 60 ? 'at kickoff' : `in ${Math.ceil(minsUntil)} min`}`}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Upcoming Fixtures Tab ────────────────────────────────────────────────────
function BookingsTab({ refereeId }) {
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [selectedGame, setSelectedGame] = useState(null);
  const [detailGame, setDetailGame] = useState(null);
  const [matchGame, setMatchGame] = useState(null);
  const [initialPresent, setInitialPresent] = useState({});

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

  async function handleCheckIn(game) {
    const { error } = await supabase
      .from('game_referees')
      .update({ checked_in: true, checked_in_at: new Date().toISOString() })
      .eq('game_id', game.id)
      .eq('referee_id', refereeId);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      queryClient.invalidateQueries(['refFixturesScore', refereeId]);
      queryClient.invalidateQueries(['refFixtures', refereeId]);
    }
  }

  if (isLoading) return <View style={styles.center}><ActivityIndicator color={colors.gold} size="large" /></View>;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.list}>

        {fixtures.length > 0 && (
          <>
            <Text style={styles.scoreSection}>{t('referee.yourFixtures')}</Text>
            {fixtures.map(item => {
              const kickoff = new Date(item.kickoff_time);
              const now = new Date();
              const minsUntil = (kickoff - now) / (1000 * 60);
              const showCheckIn = minsUntil <= 60 && minsUntil > -30; // within 1 hr before or 30 min after kickoff
              const isCheckedIn = item.checked_in;

              return (
                <View key={item.id} style={[styles.gameCard, { borderColor: colors.gold, flexDirection: 'column' }]}>
                  <TouchableOpacity
                    style={styles.gameCardInner}
                    onPress={() => setDetailGame(item)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.gameCardLeft}>
                      <Text style={styles.gameCardTitle} numberOfLines={1}>{item.location?.split(',')[0]}</Text>
                      <Text style={styles.gameCardMeta}>{item.format} · {formatDate(item.kickoff_time)}</Text>
                      <Text style={styles.gameCardPlayers}>👥 {item.game_players?.length || 0} players</Text>
                    </View>
                    <View style={styles.gameCardRight}>
                      <Text style={styles.arrowIcon}>›</Text>
                    </View>
                  </TouchableOpacity>

                  {showCheckIn && (
                    <View style={styles.checkInRow}>
                      {isCheckedIn ? (
                        <View style={styles.checkedInBadge}>
                          <Text style={styles.checkedInText}>✅ {t('referee.checkedIn')}</Text>
                        </View>
                      ) : (
                        <TouchableOpacity style={styles.checkInBtn} onPress={() => handleCheckIn(item)}>
                          <Text style={styles.checkInBtnText}>📍 {t('referee.imHere')}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}

        {otherGames.length > 0 && (
          <>
            <Text style={styles.scoreSection}>{t('referee.otherGames')}</Text>
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
            <Text style={styles.emptyTitle}>{t('referee.noGames')}</Text>
            <Text style={styles.emptySub}>{t('referee.noGamesSub')}</Text>
          </View>
        )}
      </ScrollView>

      {/* Fixture Detail Modal */}
      {detailGame && (
        <FixtureDetailModal
          game={detailGame}
          visible={!!detailGame}
          onClose={() => setDetailGame(null)}
          onStartMatch={(present) => {
            setInitialPresent(present);
            setMatchGame(detailGame);
            setDetailGame(null);
          }}
        />
      )}

      {/* Match Dashboard Modal */}
      {matchGame && (
        <MatchModal
          game={matchGame}
          visible={!!matchGame}
          initialPresent={initialPresent}
          onClose={() => setMatchGame(null)}
          onSaved={() => {
            queryClient.invalidateQueries(['refFixturesScore', refereeId]);
            queryClient.invalidateQueries(['refereeGames']);
            setMatchGame(null);
          }}
        />
      )}

      {/* Other games — still open directly to MatchModal */}
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
  const { t } = useLanguage();
  const [activeSection, setActiveSection] = useState('Feed');

  const TAB_LABELS = {
    Feed:     t('referee.tabFeed'),
    Fixtures: 'Fixtures',
    Rankings: t('referee.tabRankings'),
    Profile:  t('referee.tabProfile'),
  };

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
              {TAB_LABELS[s]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeSection === 'Feed'     && <FeedTab refereeId={player?.id} />}
      {activeSection === 'Fixtures' && <BookingsTab refereeId={player?.id} />}
      {activeSection === 'Rankings' && <RefereeRankingsTab currentRefereeId={player?.id} />}
      {activeSection === 'Profile'  && <ProfileTab player={player} />}
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
  gameCardInner: { flexDirection: 'row', alignItems: 'center' },

  // Check-in
  // ── Fixture Detail Modal ──
  fdContainer: { flex: 1, backgroundColor: colors.dark },
  fdHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.darkCard,
    borderBottomWidth: 1, borderBottomColor: colors.darkBorder,
    paddingTop: 54, paddingBottom: spacing.md, paddingHorizontal: spacing.md,
  },
  fdTitle: { color: colors.white, fontWeight: '800', fontSize: 16 },
  fdMeta: { color: colors.gray, fontSize: 12, marginTop: 2 },
  fdScroll: { padding: spacing.md, paddingBottom: 120 },
  fdCountdownBox: {
    backgroundColor: colors.darkCard,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.darkBorder,
    padding: spacing.lg, alignItems: 'center', marginBottom: spacing.md,
  },
  fdCountdownLabel: { color: colors.gray, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  fdCountdown: { color: colors.gold, fontSize: 48, fontWeight: '900', letterSpacing: -1 },
  fdPlayerCount: { color: colors.gray, fontSize: 12, marginTop: 6 },
  fdSection: {
    backgroundColor: colors.darkCard,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.darkBorder,
    padding: spacing.md, marginBottom: spacing.md,
  },
  fdSectionTitle: {
    color: colors.gold, fontSize: 11, fontWeight: '800',
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: spacing.sm,
  },
  fdSectionHint: { color: colors.gray, fontSize: 12, marginBottom: spacing.sm },
  fdTeamsRow: { flexDirection: 'row', gap: 8 },
  fdTeamCol: { flex: 1 },
  fdTeamDark: { color: colors.white, fontWeight: '700', fontSize: 13, marginBottom: 8 },
  fdTeamBright: { color: colors.gold, fontWeight: '700', fontSize: 13, marginBottom: 8, textAlign: 'right' },
  fdNoTeam: { color: colors.gray, fontSize: 12, fontStyle: 'italic' },
  fdPlayerRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  fdPlayerName: { color: colors.grayLight, fontSize: 12, flex: 1 },
  fdPlayerRating: { color: colors.gold, fontSize: 10, fontWeight: '700' },
  fdTeamAvg: { color: colors.gray, fontSize: 11, marginTop: 6 },
  fdVsDivider: { width: 28, alignItems: 'center', justifyContent: 'center' },
  fdVs: { color: colors.gray, fontWeight: '800', fontSize: 12 },
  fdAttRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.darkBorder,
  },
  fdAttAvatar: { width: 36, height: 36, borderRadius: 18 },
  fdAttAvatarFallback: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center',
  },
  fdAttInitials: { color: colors.gold, fontWeight: '700', fontSize: 13 },
  fdAttName: { color: colors.white, fontWeight: '600', fontSize: 13 },
  fdAttRole: { color: colors.gray, fontSize: 11, marginTop: 1 },
  fdInfoBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.darkCard,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.darkBorder,
    padding: spacing.md, marginBottom: spacing.md,
  },
  fdInfoIcon: { fontSize: 24 },
  fdInfoText: { color: colors.gray, fontSize: 13, flex: 1, lineHeight: 18 },
  fdFooter: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.darkCard,
    borderTopWidth: 1, borderTopColor: colors.darkBorder,
    padding: spacing.md, paddingBottom: 32,
  },
  fdStartBtn: {
    backgroundColor: colors.gold, borderRadius: radius.lg,
    paddingVertical: 16, alignItems: 'center',
  },
  fdStartBtnDisabled: { backgroundColor: colors.darkBorder },
  fdStartBtnText: { color: colors.dark, fontWeight: '800', fontSize: 16 },

  checkInRow: {
    borderTopWidth: 1,
    borderTopColor: colors.darkBorder,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
  },
  checkInBtn: {
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  checkInBtnText: { color: colors.dark, fontWeight: 'bold', fontSize: 15 },
  checkedInBadge: {
    backgroundColor: 'rgba(76,175,80,0.12)',
    borderWidth: 1,
    borderColor: colors.success,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  checkedInText: { color: colors.success, fontWeight: 'bold', fontSize: 14 },

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

  // Language + Sign Out
  langRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  langBtn: {
    flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.darkBorder, alignItems: 'center',
  },
  langBtnActive: { borderColor: colors.gold, backgroundColor: 'rgba(232,184,75,0.1)' },
  langBtnText: { color: colors.gray, fontSize: 13, fontWeight: '600' },
  langBtnTextActive: { color: colors.gold },
  signOutBtn: {
    marginBottom: spacing.xl, marginHorizontal: spacing.md,
    padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.error, alignItems: 'center',
  },
  signOutBtnText: { color: colors.error, fontWeight: '700', fontSize: 15 },

  // Referee Rankings
  rankingsContent: { padding: spacing.md, paddingBottom: 80 },
  rankingsHeader: { alignItems: 'center', marginBottom: spacing.lg },
  rankingsTitle: { color: colors.gold, fontSize: 20, fontWeight: 'bold', letterSpacing: 0.5 },
  rankRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
  },
  rankRowData: {
    backgroundColor: colors.darkCard, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.darkBorder,
    marginBottom: spacing.xs, paddingVertical: spacing.sm,
  },
  rankRowMe: { borderColor: colors.gold, backgroundColor: 'rgba(232,184,75,0.07)' },
  rankCol: { color: colors.gray, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  rankColRank: { width: 44, alignItems: 'center', justifyContent: 'center' },
  rankColStat: { width: 52, textAlign: 'center' },
  rankMedal: { fontSize: 20 },
  rankNum: { color: colors.grayLight, fontSize: 15, fontWeight: 'bold' },
  rankAvatar: { width: 36, height: 36, borderRadius: 18 },
  rankAvatarFallback: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.darkBorder, alignItems: 'center', justifyContent: 'center',
  },
  rankAvatarText: { color: colors.gold, fontSize: 13, fontWeight: 'bold' },
  rankName: { color: colors.white, fontSize: 14, fontWeight: '600' },
  rankYouLabel: { color: colors.gold, fontSize: 10, fontWeight: '600', marginTop: 1 },
  rankStatVal: { color: colors.grayLight, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  rankStatPts: { color: colors.white, fontSize: 15, fontWeight: 'bold', textAlign: 'center' },

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
  phaseSubtitle: { color: colors.gray, fontSize: 12, paddingHorizontal: spacing.md, marginBottom: spacing.sm, lineHeight: 17 },
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

  // Referee Notes
  refNotesBox: {
    marginTop: spacing.lg,
    backgroundColor: colors.dark,
    borderWidth: 1,
    borderColor: colors.gold + '55',
    borderRadius: 10,
    padding: spacing.md,
  },
  refNotesLabel: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  refNotesHint: {
    color: colors.gray,
    fontSize: 11,
    marginBottom: spacing.sm,
    lineHeight: 15,
  },
  refNotesInput: {
    backgroundColor: colors.darkCard,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    borderRadius: 8,
    color: colors.white,
    fontSize: 13,
    padding: spacing.sm,
    minHeight: 90,
    lineHeight: 20,
  },
  refNotesCount: {
    color: colors.gray,
    fontSize: 10,
    textAlign: 'right',
    marginTop: 4,
  },

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

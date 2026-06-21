import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, ScrollView, Modal, Alert, Share,
  TextInput, KeyboardAvoidingView, Platform, ImageBackground,
  Image, AppState,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { colors, spacing, radius } from '../theme';

const SUPABASE_FUNCTIONS_URL = 'https://zprtghdcmiavtoaltlld.supabase.co/functions/v1';
const useStripe = Platform.OS !== 'web'
  ? require('@stripe/stripe-react-native').useStripe
  : () => ({ initPaymentSheet: async () => ({}), presentPaymentSheet: async () => ({}) });

const TEAMS_SELECT = 'id, name, player_ids, avg_rating, registration_type, captain_id, invite_code';

async function fetchTournaments() {
  const { data, error } = await supabase
    .from('tournaments')
    .select(`*, tournament_teams(${TEAMS_SELECT}), field:fields(name, photo_url)`)
    .order('kickoff_date', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchTournamentDetail(id) {
  const { data, error } = await supabase
    .from('tournaments')
    .select(`*, tournament_teams(${TEAMS_SELECT}), field:fields(name, photo_url)`)
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'UPL-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function fetchTournamentMatches(tournamentId) {
  const { data, error } = await supabase
    .from('tournament_matches')
    .select('id, tournament_id, round, match_number, team_a_id, team_b_id, score_a, score_b, winner_id, status, kickoff_time, field_number, referee_id, team_a:team_a_id(id, name), team_b:team_b_id(id, name), referee:referee_id(id, first_name, last_name, name)')
    .eq('tournament_id', tournamentId)
    .order('round', { ascending: true })
    .order('match_number', { ascending: true });
  if (error) throw error;
  return data || [];
}

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  }) + ' · ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function StatusBadge({ status }) {
  const config = {
    upcoming: { label: 'Open', color: colors.success },
    active: { label: 'Live', color: colors.gold },
    completed: { label: 'Ended', color: colors.gray },
  };
  const { label, color } = config[status] || config.upcoming;
  return (
    <View style={[styles.statusBadge, { borderColor: color }]}>
      <Text style={[styles.statusText, { color }]}>{label}</Text>
    </View>
  );
}

// Parse "6v6" → 6
function playersPerSide(format) {
  const n = parseInt(format);
  return isNaN(n) ? 6 : n;
}

function CapacityBar({ registeredTeams, maxTeams, format }) {
  const total = maxTeams || 8;
  const pct = Math.min((registeredTeams / total) * 100, 100);
  const isFull = registeredTeams >= total;
  const perTeam = playersPerSide(format) + 1; // +1 sub
  return (
    <View>
      <View style={styles.capTrack}>
        <View style={[styles.capFill, { width: `${pct}%`, backgroundColor: isFull ? colors.error : colors.gold }]} />
      </View>
      <Text style={styles.capText}>
        {registeredTeams} / {total} teams · {perTeam} players per team (incl. sub)
      </Text>
    </View>
  );
}

function TournamentCard({ tournament, onPress, playerId }) {
  const registeredTeams = tournament.tournament_teams?.length || 0;
  const maxTeams = tournament.max_teams || 8;
  const isFull = registeredTeams >= maxTeams;
  const isRegistered = tournament.tournament_teams?.some(
    t => Array.isArray(t.player_ids) && t.player_ids.includes(playerId)
  );
  const hoursUntil = tournament.kickoff_date
    ? (new Date(tournament.kickoff_date) - new Date()) / (1000 * 60 * 60)
    : Infinity;
  const locked = hoursUntil <= 24;

  const btnLabel = isRegistered ? 'View Tournament →' : isFull ? 'Full' : locked ? '⏳ Waitlist Available' : 'View & Register →';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      {/* Hero Banner */}
      <ImageBackground
        source={require('../../assets/summer-series-bg.jpg')}
        style={styles.heroBanner}
        resizeMode="cover"
      >
        <LinearGradient
          colors={['rgba(5,5,18,0.35)', 'rgba(5,5,18,0.7)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.heroContent}>
          <Text style={styles.heroIcon}>🏆</Text>
          <Text style={styles.heroTitle}>{tournament.name}</Text>
          <View style={styles.heroBadgeRow}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>{tournament.format}</Text>
            </View>
            <StatusBadge status={tournament.status} />
            {isRegistered && (
              <View style={[styles.heroBadge, { borderColor: colors.success }]}>
                <Text style={[styles.heroBadgeText, { color: colors.success }]}>Joined</Text>
              </View>
            )}
          </View>
        </View>
      </ImageBackground>

      {/* Meta */}
      <View style={styles.cardBody}>
        <View style={styles.metaRow}>
          <View style={styles.metaChip}>
            <Text style={styles.metaIcon}>💰</Text>
            <Text style={styles.metaText}>${tournament.entry_fee}</Text>
          </View>
          {tournament.prize_money > 0 && (
            <View style={[styles.metaChip, styles.metaChipGold]}>
              <Text style={styles.metaIcon}>🏆</Text>
              <Text style={[styles.metaText, { color: '#F5C518', fontWeight: '700' }]}>${tournament.prize_money}</Text>
            </View>
          )}
          <View style={styles.metaChip}>
            <Text style={styles.metaIcon}>📅</Text>
            <Text style={styles.metaText}>
              {new Date(tournament.kickoff_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </Text>
          </View>
          <View style={styles.metaChip}>
            <Text style={styles.metaIcon}>🏟️</Text>
            <Text style={styles.metaText}>{tournament.field_count} field{tournament.field_count > 1 ? 's' : ''}</Text>
          </View>
          <View style={styles.metaChip}>
            <Text style={styles.metaIcon}>⏱️</Text>
            <Text style={styles.metaText}>{tournament.game_duration}min</Text>
          </View>
        </View>

        <CapacityBar registeredTeams={registeredTeams} maxTeams={maxTeams} format={tournament.format} />

        <Text style={styles.venueText} numberOfLines={1}>📍 {tournament.venue}</Text>

        <View style={styles.registerBtnRow}>
          <TouchableOpacity
            style={[styles.registerBtn, isFull && !isRegistered && styles.registerBtnFull]}
            onPress={onPress}
          >
            <Text style={[styles.registerBtnText, isFull && !isRegistered && styles.registerBtnTextFull]}>
              {btnLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function BracketView({ matches, isAdmin, onScorePress, onAssignRef }) {
  if (!matches || matches.length === 0) {
    return (
      <View style={styles.bracketEmpty}>
        <Text style={styles.bracketEmptyText}>
          {'Bracket not generated yet.' + (isAdmin ? ' Use "Generate Bracket" in the Admin panel → tap the cup.' : '')}
        </Text>
      </View>
    );
  }

  const rounds = {};
  matches.forEach(m => {
    if (!rounds[m.round]) rounds[m.round] = [];
    rounds[m.round].push(m);
  });
  const roundNums = Object.keys(rounds).map(Number).sort((a, b) => a - b);
  const totalRounds = roundNums.length;

  function getRoundLabel(round) {
    const remaining = totalRounds - round + 1;
    if (remaining === 1) return 'Final';
    if (remaining === 2) return 'Semi-Finals';
    if (remaining === 3) return 'Quarter-Finals';
    return `Round ${round}`;
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.bracketRow}>
        {roundNums.map(roundNum => {
          const roundMatches = rounds[roundNum].sort((a, b) => a.match_number - b.match_number);
          return (
            <View key={roundNum} style={styles.bracketColumn}>
              <Text style={styles.bracketRoundLabel}>{getRoundLabel(roundNum)}</Text>
              {roundMatches.map(match => {
                const canEdit = isAdmin && match.team_a_id && match.team_b_id && match.status !== 'completed';
                return (
                  <TouchableOpacity
                    key={match.id}
                    style={[
                      styles.bracketMatch,
                      match.status === 'completed' && styles.bracketMatchDone,
                      match.status === 'bye' && styles.bracketMatchBye,
                    ]}
                    onPress={() => canEdit && onScorePress(match)}
                    activeOpacity={canEdit ? 0.7 : 1}
                  >
                    {match.status === 'bye' ? (
                      <View style={styles.bracketByeRow}>
                        <Text style={styles.bracketByeTeam} numberOfLines={1}>
                          {match.team_a?.name || match.team_b?.name || 'BYE'}
                        </Text>
                        <Text style={styles.bracketByeLabel}>BYE</Text>
                      </View>
                    ) : (
                      <>
                        {match.kickoff_time && (
                          <Text style={styles.bracketTime}>
                            {new Date(match.kickoff_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                            {match.field_number ? `  · F${match.field_number}` : ''}
                          </Text>
                        )}
                        <View style={[
                          styles.bracketTeamRow,
                          match.winner_id && match.winner_id === match.team_a_id && styles.bracketWinnerRow,
                        ]}>
                          <Text style={styles.bracketTeamText} numberOfLines={1}>
                            {match.team_a?.name || 'TBD'}
                          </Text>
                          {match.score_a != null && (
                            <Text style={[styles.bracketScore, match.winner_id === match.team_a_id && styles.bracketScoreWinner]}>
                              {match.score_a}
                            </Text>
                          )}
                        </View>
                        <View style={styles.bracketMatchDivider} />
                        <View style={[
                          styles.bracketTeamRow,
                          match.winner_id && match.winner_id === match.team_b_id && styles.bracketWinnerRow,
                        ]}>
                          <Text style={styles.bracketTeamText} numberOfLines={1}>
                            {match.team_b?.name || 'TBD'}
                          </Text>
                          {match.score_b != null && (
                            <Text style={[styles.bracketScore, match.winner_id === match.team_b_id && styles.bracketScoreWinner]}>
                              {match.score_b}
                            </Text>
                          )}
                        </View>
                        {match.referee ? (
                          <Text style={styles.bracketRefText}>🟨 {[match.referee.first_name, match.referee.last_name].filter(Boolean).join(' ') || match.referee.name}</Text>
                        ) : isAdmin && match.team_a_id && match.team_b_id && match.status !== 'completed' ? (
                          <TouchableOpacity onPress={() => onAssignRef?.(match)} style={styles.bracketAssignRef}>
                            <Text style={styles.bracketAssignRefText}>+ Assign Ref</Text>
                          </TouchableOpacity>
                        ) : null}
                        {canEdit && match.referee_id && (
                          <Text style={styles.bracketEditHint}>tap to manage match</Text>
                        )}
                      </>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function RegisterModal({ tournament, visible, onClose, onDone, waitlistMode }) {
  const { player } = useAuth();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [type, setType] = useState('solo');
  const [teamMode, setTeamMode] = useState('create');
  const [teamName, setTeamName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [registering, setRegistering] = useState(false);

  const teamSize = playersPerSide(tournament?.format || '6v6') + 1; // +1 sub
  const entryFee = tournament?.entry_fee || 0;

  // Fee: solo = per person, create team = per person × full team size, join = per person
  function getTotalAmount() {
    if (type === 'solo') return entryFee;
    if (type === 'team' && teamMode === 'create') return entryFee * teamSize;
    return entryFee; // join team = individual share
  }

  async function handleRegister() {
    setRegistering(true);
    try {
      const total = getTotalAmount();
      let paymentIntentId = null;

      // ── Stripe payment ────────────────────────────────────────────────
      if (total > 0) {
        const { data: { session } } = await supabase.auth.getSession();

        const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/create-payment-intent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({
            amount: total,          // dollars — Edge Function multiplies by 100
            currency: 'usd',
            playerId: player.id,
            gameTitle: tournament.name,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.clientSecret) throw new Error(json.error || 'Payment setup failed');

        const { error: initError } = await initPaymentSheet({
          merchantDisplayName: 'Urban PL',
          paymentIntentClientSecret: json.clientSecret,
          applePay: { merchantCountryCode: 'US' },
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

        const { error: presentError } = await presentPaymentSheet();
        if (presentError) {
          if (presentError.code !== 'Canceled') Alert.alert('Payment failed', presentError.message);
          setRegistering(false);
          return;
        }
        paymentIntentId = json.clientSecret.split('_secret_')[0];
      }

      // ── Guard: already registered? ───────────────────────────────────
      const { data: existing } = await supabase
        .from('tournament_teams')
        .select('id')
        .eq('tournament_id', tournament.id)
        .contains('player_ids', [player.id])
        .maybeSingle();
      if (existing) {
        Alert.alert('Already Registered', 'You are already registered for this tournament.');
        setRegistering(false);
        return;
      }

      // ── DB registration ───────────────────────────────────────────────
      if (type === 'solo') {
        const regType = waitlistMode ? 'waitlist' : 'solo_draft';
        const { error } = await supabase.from('tournament_teams').insert({
          tournament_id: tournament.id,
          name: `${player.first_name || player.name || 'Player'}'s Team`,
          player_ids: [player.id],
          avg_rating: player.rating || 5.0,
          registration_type: regType,
          captain_id: player.id,
        });
        if (error) throw error;

      } else if (teamMode === 'create') {
        if (!teamName.trim()) { Alert.alert('Missing', 'Enter a team name.'); setRegistering(false); return; }
        const code = generateInviteCode();
        const { error } = await supabase.from('tournament_teams').insert({
          tournament_id: tournament.id,
          name: teamName.trim(),
          player_ids: [player.id],
          avg_rating: player.rating || 5.0,
          registration_type: 'team',
          invite_code: code,
          captain_id: player.id,
        });
        if (error) throw error;

        // Show invite code AFTER payment and DB write succeed
        setTimeout(() => {
          Alert.alert(
            '✅ Team Created!',
            `Your invite code:\n\n${code}\n\nShare it so teammates can join.`,
            [
              { text: 'Share Code', onPress: () => Share.share({ message: `Join my team "${teamName.trim()}" at ${tournament.name} on Urban PL!\n\nUse invite code: ${code}` }) },
              { text: 'Done' },
            ]
          );
        }, 300);

      } else {
        // Join team
        const code = inviteCode.trim().toUpperCase();
        if (!code) { Alert.alert('Missing', 'Enter an invite code.'); setRegistering(false); return; }
        const { data: team, error: findError } = await supabase
          .from('tournament_teams')
          .select('id, player_ids, avg_rating, name')
          .eq('invite_code', code)
          .eq('tournament_id', tournament.id)
          .maybeSingle();
        if (findError || !team) {
          Alert.alert('Not Found', 'No team with that code. Double-check and try again.');
          setRegistering(false);
          return;
        }
        const maxPlayers = playersPerSide(tournament.format) + 1;
        if ((team.player_ids?.length || 0) >= maxPlayers) {
          Alert.alert('Team Full', `This team already has ${maxPlayers} players.`);
          setRegistering(false);
          return;
        }
        if (team.player_ids?.includes(player.id)) {
          Alert.alert('Already Joined', 'You are already on this team.');
          setRegistering(false);
          return;
        }
        const newIds = [...(team.player_ids || []), player.id];
        const newAvg = ((team.avg_rating || 5.0) * (team.player_ids?.length || 0) + (player.rating || 5.0)) / newIds.length;
        const { error: updateError } = await supabase
          .from('tournament_teams')
          .update({ player_ids: newIds, avg_rating: parseFloat(newAvg.toFixed(2)) })
          .eq('id', team.id);
        if (updateError) throw updateError;

        setTimeout(() => Alert.alert('✅ Joined!', `You've joined "${team.name}"!`), 300);
      }

      // ── Save payment record ───────────────────────────────────────────
      if (paymentIntentId) {
        const { error: payErr } = await supabase.from('payments').insert({
          player_id: player.id,
          game_id: null,
          tournament_id: tournament.id,
          amount: getTotalAmount(),
          currency: 'usd',
          stripe_payment_intent_id: paymentIntentId,
          status: 'succeeded',
        });
        if (payErr) {
          console.warn('Payment record save failed:', payErr.message);
          // Payment went through Stripe — don't block registration, but warn
          Alert.alert('⚠️ Note', `Payment processed but record could not be saved (${payErr.message}). Contact support for refund if needed.`);
        }
      }

      // Send tournament booking confirmation email (fire and forget)
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const registeredTeamName = type === 'solo'
          ? `${player.first_name || player.name}'s Team`
          : type === 'create' ? teamName.trim() : 'Your Team';
        fetch(`${SUPABASE_FUNCTIONS_URL}/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({
            type: 'tournament_booking',
            to: player.email,
            firstName: player.first_name || player.name || 'Player',
            tournament,
            teamName: registeredTeamName,
          }),
        });
      } catch (_) {}

      onDone();
      onClose();

    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setRegistering(false);
    }
  }

  const totalAmount = getTotalAmount();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Register for {tournament?.name}</Text>

          {/* Solo / Team tabs */}
          <View style={styles.typeSwitcher}>
            <TouchableOpacity
              style={[styles.typeBtn, type === 'solo' && styles.typeBtnActive]}
              onPress={() => setType('solo')}
            >
              <Text style={[styles.typeBtnText, type === 'solo' && styles.typeBtnTextActive]}>Solo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeBtn, type === 'team' && styles.typeBtnActive]}
              onPress={() => setType('team')}
            >
              <Text style={[styles.typeBtnText, type === 'team' && styles.typeBtnTextActive]}>Team</Text>
            </TouchableOpacity>
          </View>

          {type === 'solo' ? (
            <View style={styles.modalInfo}>
              <Text style={styles.modalInfoText}>
                🎲 You'll be auto-drafted into a balanced team 48 hours before the tournament. Teams are balanced by skill rating.
              </Text>
            </View>
          ) : (
            <>
              {/* Create / Join sub-tabs */}
              <View style={styles.teamSubSwitcher}>
                <TouchableOpacity
                  style={[styles.teamSubBtn, teamMode === 'create' && styles.teamSubBtnActive]}
                  onPress={() => setTeamMode('create')}
                >
                  <Text style={[styles.teamSubBtnText, teamMode === 'create' && styles.teamSubBtnTextActive]}>
                    Create Team
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.teamSubBtn, teamMode === 'join' && styles.teamSubBtnActive]}
                  onPress={() => setTeamMode('join')}
                >
                  <Text style={[styles.teamSubBtnText, teamMode === 'join' && styles.teamSubBtnTextActive]}>
                    Join Team
                  </Text>
                </TouchableOpacity>
              </View>

              {teamMode === 'create' ? (
                <View style={styles.modalInfo}>
                  <Text style={styles.modalInfoText}>
                    👑 You'll be the captain. After registering you'll get an invite code to share with your teammates.
                  </Text>
                  <TextInput
                    style={styles.teamNameInput}
                    placeholder="Team name"
                    placeholderTextColor={colors.gray}
                    value={teamName}
                    onChangeText={setTeamName}
                  />
                </View>
              ) : (
                <View style={styles.modalInfo}>
                  <Text style={styles.modalInfoText}>
                    🔑 Your captain shared a code with you. Enter it below to join their team.
                  </Text>
                  <TextInput
                    style={styles.teamNameInput}
                    placeholder="e.g. UPL-4X9K"
                    placeholderTextColor={colors.gray}
                    value={inviteCode}
                    onChangeText={setInviteCode}
                    autoCapitalize="characters"
                  />
                </View>
              )}
            </>
          )}

          {/* Booking Summary */}
          <View style={styles.bookingSummary}>
            <Text style={styles.bookingTitle}>Booking Summary</Text>
            <View style={styles.bookingRow}>
              <Text style={styles.bookingKey}>Tournament</Text>
              <Text style={styles.bookingVal}>{tournament?.name}</Text>
            </View>
            <View style={styles.bookingRow}>
              <Text style={styles.bookingKey}>Format</Text>
              <Text style={styles.bookingVal}>{tournament?.format}</Text>
            </View>
            <View style={styles.bookingRow}>
              <Text style={styles.bookingKey}>Date</Text>
              <Text style={styles.bookingVal}>
                {tournament ? new Date(tournament.kickoff_date).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric'
                }) : ''}
              </Text>
            </View>
            {type === 'team' && teamMode === 'create' && (
              <View style={styles.bookingRow}>
                <Text style={styles.bookingKey}>Players</Text>
                <Text style={styles.bookingVal}>{teamSize} (${entryFee} × {teamSize})</Text>
              </View>
            )}
            <View style={[styles.bookingRow, styles.bookingRowTotal]}>
              <Text style={styles.bookingKeyTotal}>Total</Text>
              <Text style={styles.bookingValTotal}>
                {totalAmount === 0 ? 'FREE' : `$${totalAmount}`}
              </Text>
            </View>
          </View>

          {/* Cancellation Policy */}
          <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: colors.darkBorder }}>
            <Text style={{ color: colors.grayLight, fontSize: 11, fontWeight: 'bold', marginBottom: 6 }}>Cancellation Policy</Text>
            <Text style={{ color: colors.gray, fontSize: 10, lineHeight: 16 }}>
              {'• > 5 hours before kickoff → Full refund\n• 3–5 hours → Game credit only (if replacement found)\n• < 3 hours → No refund'}
            </Text>
            <Text style={{ color: colors.gray, fontSize: 10, marginTop: 6, lineHeight: 16 }}>
              ⚠️ This event is subject to reaching the minimum number of players and a confirmed referee before it's officially confirmed.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.confirmBtn, registering && styles.confirmBtnDisabled]}
            onPress={handleRegister}
            disabled={registering}
          >
            {registering
              ? <ActivityIndicator color={colors.dark} />
              : <Text style={styles.confirmBtnText}>
                  {totalAmount === 0
                    ? (type === 'solo' ? 'Confirm & Register →' : teamMode === 'create' ? 'Create Team →' : 'Join Team →')
                    : (type === 'solo' ? `Pay $${totalAmount} & Register →` : teamMode === 'create' ? `Pay $${totalAmount} & Create Team →` : `Pay $${totalAmount} & Join →`)
                  }
                </Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Tournament Match Modal (full live match flow) ───────────────────────────
function formatMatchTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function TournamentMatchModal({ match, tournament, visible, onClose, onSave }) {
  const gameDuration = tournament?.game_duration || 20;
  const halfSecs = Math.floor(gameDuration / 2) * 60;
  const breakSecs = 2 * 60;

  const [loading, setLoading] = useState(true);
  const [playersA, setPlayersA] = useState([]);
  const [playersB, setPlayersB] = useState([]);
  const [phase, setPhase] = useState('attendance');
  const [present, setPresent] = useState({});
  const [goals, setGoals] = useState({});
  const [cards, setCards] = useState({});
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');
  const [timeLeft, setTimeLeft] = useState(halfSecs);
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const intervalRef = useRef(null);
  const endTimeRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  // Fetch players for both teams
  useEffect(() => {
    if (!visible || !match) return;
    setPhase('attendance');
    setGoals({});
    setCards({});
    setScoreA('');
    setScoreB('');
    setTimeLeft(halfSecs);
    setRunning(false);
    setLoading(true);

    (async () => {
      const teamAId = match.team_a_id;
      const teamBId = match.team_b_id;
      const { data: teams } = await supabase
        .from('tournament_teams')
        .select('id, name, player_ids')
        .in('id', [teamAId, teamBId].filter(Boolean));

      const teamA = teams?.find(t => t.id === teamAId);
      const teamB = teams?.find(t => t.id === teamBId);
      const allIds = [...(teamA?.player_ids || []), ...(teamB?.player_ids || [])];

      if (allIds.length > 0) {
        const { data: playerRows } = await supabase
          .from('players')
          .select('id, first_name, last_name, name, avatar_url, role, rating')
          .in('id', allIds);
        const map = {};
        (playerRows || []).forEach(p => { map[p.id] = p; });
        setPlayersA((teamA?.player_ids || []).map(id => map[id]).filter(Boolean));
        setPlayersB((teamB?.player_ids || []).map(id => map[id]).filter(Boolean));
        const pres = {};
        allIds.forEach(id => { pres[id] = true; });
        setPresent(pres);
      }
      setLoading(false);
    })();
  }, [match?.id, visible]);

  // Wall-clock timer
  useEffect(() => {
    if (running) {
      if (!endTimeRef.current) endTimeRef.current = Date.now() + timeLeft * 1000;
      intervalRef.current = setInterval(() => {
        const remaining = Math.max(0, Math.round((endTimeRef.current - Date.now()) / 1000));
        setTimeLeft(remaining);
        if (remaining <= 0) {
          clearInterval(intervalRef.current);
          endTimeRef.current = null;
          setRunning(false);
        }
      }, 500);
    } else {
      clearInterval(intervalRef.current);
      endTimeRef.current = null;
    }
    return () => clearInterval(intervalRef.current);
  }, [running]);

  // AppState listener
  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if ((appStateRef.current === 'background' || appStateRef.current === 'inactive') && nextState === 'active') {
        if (endTimeRef.current) {
          const remaining = Math.max(0, Math.round((endTimeRef.current - Date.now()) / 1000));
          setTimeLeft(remaining);
          if (remaining <= 0) { endTimeRef.current = null; setRunning(false); }
        }
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, []);

  // Auto end-half when timer hits 0
  useEffect(() => {
    if (timeLeft === 0 && (phase === 'first_half' || phase === 'break' || phase === 'second_half')) {
      handleEndHalf();
    }
  }, [timeLeft]);

  function togglePresent(pid) { setPresent(p => ({ ...p, [pid]: !p[pid] })); }
  function adjustGoals(pid, delta) { setGoals(g => ({ ...g, [pid]: Math.max(0, (g[pid] || 0) + delta) })); }
  function adjustCards(pid, type, delta) {
    setCards(c => {
      const cur = c[pid] || { yellow: 0, red: 0 };
      return { ...c, [pid]: { ...cur, [type]: Math.max(0, cur[type] + delta) } };
    });
  }

  function handleStartMatch() {
    setPhase('first_half');
    setTimeLeft(halfSecs);
    setRunning(true);
  }

  function handleEndHalf() {
    setRunning(false);
    if (phase === 'first_half') {
      Alert.alert('⏱ Half Time!', `${Math.round(breakSecs / 60)} minute break.`, [
        { text: 'Start Break', onPress: () => { setPhase('break'); setTimeLeft(breakSecs); setRunning(true); } },
      ]);
    } else if (phase === 'break') {
      Alert.alert('▶️ Second Half', 'Ready to kick off?', [
        { text: 'Start 2nd Half', onPress: () => { setPhase('second_half'); setTimeLeft(halfSecs); setRunning(true); } },
      ]);
    } else if (phase === 'second_half') {
      const calcA = playersA.filter(p => present[p.id]).reduce((s, p) => s + (goals[p.id] || 0), 0);
      const calcB = playersB.filter(p => present[p.id]).reduce((s, p) => s + (goals[p.id] || 0), 0);
      setScoreA(String(calcA));
      setScoreB(String(calcB));
      setPhase('final');
    }
  }

  async function handleSave() {
    const a = parseInt(scoreA) || 0;
    const b = parseInt(scoreB) || 0;
    if (a === b) { Alert.alert('No Draws', 'Knockout — one team must win.'); return; }
    setSubmitting(true);

    // Save per-player stats
    const allPresent = [...presentA, ...presentB];
    const statsRows = allPresent.map(p => {
      const c = cards[p.id] || { yellow: 0, red: 0 };
      const teamId = presentA.includes(p) ? match.team_a_id : match.team_b_id;
      return {
        tournament_id: match.tournament_id,
        match_id: match.id,
        player_id: p.id,
        team_id: teamId,
        goals: goals[p.id] || 0,
        yellow_cards: c.yellow,
        red_cards: c.red,
      };
    }).filter(s => s.goals > 0 || s.yellow_cards > 0 || s.red_cards > 0);

    if (statsRows.length > 0) {
      await supabase.from('tournament_player_stats')
        .upsert(statsRows, { onConflict: 'match_id,player_id' })
        .then(({ error }) => { if (error) console.warn('Stats save error:', error.message); });
    }

    await onSave(match, a, b);
    setSubmitting(false);
    Alert.alert('✅ Match Complete!', 'Scores saved, winner advances.', [
      { text: 'Done', onPress: onClose },
    ]);
  }

  if (!match) return null;
  const teamAName = match.team_a?.name || 'Team A';
  const teamBName = match.team_b?.name || 'Team B';
  const presentA = playersA.filter(p => present[p.id]);
  const presentB = playersB.filter(p => present[p.id]);

  const phaseLabel = phase === 'first_half' ? '1st Half'
    : phase === 'break' ? 'Half Time'
    : phase === 'second_half' ? '2nd Half' : '';
  const phaseColor = phase === 'break' ? colors.gray : colors.gold;

  function playerName(p) {
    return [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.name || 'Player';
  }

  function renderPlayerRow(p, team) {
    const c = cards[p.id] || { yellow: 0, red: 0 };
    const g = goals[p.id] || 0;
    return (
      <View key={p.id} style={tmStyles.playerRow}>
        <View style={tmStyles.playerInfo}>
          {p.avatar_url
            ? <Image source={{ uri: p.avatar_url }} style={tmStyles.avatar} />
            : <View style={tmStyles.avatarFallback}><Text style={tmStyles.avatarText}>{(p.first_name?.[0] || '?').toUpperCase()}</Text></View>
          }
          <Text style={tmStyles.playerName} numberOfLines={1}>{playerName(p)}</Text>
        </View>
        <View style={tmStyles.statBtns}>
          <TouchableOpacity onPress={() => adjustGoals(p.id, 1)} style={tmStyles.statBtn}>
            <Text style={tmStyles.statBtnText}>⚽+</Text>
          </TouchableOpacity>
          {g > 0 && (
            <TouchableOpacity onPress={() => adjustGoals(p.id, -1)}>
              <Text style={tmStyles.goalCount}>{g}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => adjustCards(p.id, 'yellow', c.yellow > 0 ? -1 : 1)} style={tmStyles.statBtn}>
            <Text style={tmStyles.statBtnText}>🟡{c.yellow > 0 ? ` ${c.yellow}` : ''}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => adjustCards(p.id, 'red', c.red > 0 ? -1 : 1)} style={tmStyles.statBtn}>
            <Text style={tmStyles.statBtnText}>🔴{c.red > 0 ? ` ${c.red}` : ''}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={tmStyles.container}>
        {/* Header */}
        <View style={tmStyles.header}>
          <TouchableOpacity onPress={onClose}><Text style={tmStyles.closeBtn}>✕</Text></TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={tmStyles.headerTitle} numberOfLines={1}>{teamAName} vs {teamBName}</Text>
            <Text style={tmStyles.headerMeta}>{tournament?.format} · {gameDuration}min match</Text>
          </View>
        </View>

        {loading ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator color={colors.gold} size="large" />
          </View>
        ) : phase === 'attendance' ? (
          <View style={{ flex: 1 }}>
            <Text style={tmStyles.phaseTitle}>📋 Take Attendance</Text>
            <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 120 }}>
              <Text style={tmStyles.teamHeader}>{teamAName}</Text>
              {playersA.map(p => (
                <TouchableOpacity key={p.id} style={[tmStyles.attRow, !present[p.id] && { opacity: 0.4 }]} onPress={() => togglePresent(p.id)}>
                  {p.avatar_url
                    ? <Image source={{ uri: p.avatar_url }} style={tmStyles.avatar} />
                    : <View style={tmStyles.avatarFallback}><Text style={tmStyles.avatarText}>{(p.first_name?.[0] || '?').toUpperCase()}</Text></View>
                  }
                  <Text style={tmStyles.attName}>{playerName(p)}</Text>
                  <Text style={{ fontSize: 20 }}>{present[p.id] ? '✅' : '❌'}</Text>
                </TouchableOpacity>
              ))}
              <Text style={[tmStyles.teamHeader, { marginTop: spacing.md }]}>{teamBName}</Text>
              {playersB.map(p => (
                <TouchableOpacity key={p.id} style={[tmStyles.attRow, !present[p.id] && { opacity: 0.4 }]} onPress={() => togglePresent(p.id)}>
                  {p.avatar_url
                    ? <Image source={{ uri: p.avatar_url }} style={tmStyles.avatar} />
                    : <View style={tmStyles.avatarFallback}><Text style={tmStyles.avatarText}>{(p.first_name?.[0] || '?').toUpperCase()}</Text></View>
                  }
                  <Text style={tmStyles.attName}>{playerName(p)}</Text>
                  <Text style={{ fontSize: 20 }}>{present[p.id] ? '✅' : '❌'}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={tmStyles.footer}>
              <Text style={tmStyles.footerHint}>{presentA.length + presentB.length} present</Text>
              <TouchableOpacity style={tmStyles.startBtn} onPress={handleStartMatch}>
                <Text style={tmStyles.startBtnText}>▶ Start Match</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (phase === 'first_half' || phase === 'break' || phase === 'second_half') ? (
          <View style={{ flex: 1 }}>
            <View style={tmStyles.timerBlock}>
              <Text style={[tmStyles.timerPhase, { color: phaseColor }]}>{phaseLabel}</Text>
              <Text style={tmStyles.timerDisplay}>{formatMatchTime(timeLeft)}</Text>
              <View style={tmStyles.timerBtns}>
                <TouchableOpacity
                  style={[tmStyles.timerBtn, { backgroundColor: running ? colors.darkBorder : colors.success }]}
                  onPress={() => setRunning(r => !r)}
                >
                  <Text style={tmStyles.timerBtnText}>{running ? '⏸ Pause' : '▶ Resume'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[tmStyles.timerBtn, { backgroundColor: colors.error }]} onPress={handleEndHalf}>
                  <Text style={tmStyles.timerBtnText}>
                    {phase === 'first_half' ? 'End Half →' : phase === 'break' ? 'Start 2nd →' : 'End Match →'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            {phase !== 'break' ? (
              <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 20 }}>
                <Text style={tmStyles.teamHeader}>{teamAName}</Text>
                {presentA.map(p => renderPlayerRow(p, 'A'))}
                <Text style={[tmStyles.teamHeader, { marginTop: spacing.md }]}>{teamBName}</Text>
                {presentB.map(p => renderPlayerRow(p, 'B'))}
              </ScrollView>
            ) : (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ fontSize: 48 }}>☕</Text>
                <Text style={{ color: colors.grayLight, fontSize: 18, fontWeight: 'bold', marginTop: 12 }}>Half Time</Text>
              </View>
            )}
          </View>
        ) : phase === 'final' ? (
          <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 120 }}>
            <Text style={tmStyles.phaseTitle}>🏁 Full Time</Text>
            <Text style={{ color: colors.gray, fontSize: 12, marginBottom: spacing.md }}>
              Scores auto-calculated from goals. Adjust if needed, then confirm.
            </Text>
            <View style={tmStyles.finalScoreRow}>
              <View style={tmStyles.finalScoreBox}>
                <Text style={tmStyles.finalScoreLabel}>{teamAName}</Text>
                <TextInput style={tmStyles.finalScoreInput} value={scoreA} onChangeText={setScoreA}
                  keyboardType="number-pad" maxLength={2} placeholder="0" placeholderTextColor={colors.gray} />
              </View>
              <Text style={{ color: colors.gray, fontSize: 24, fontWeight: 'bold' }}>—</Text>
              <View style={tmStyles.finalScoreBox}>
                <Text style={tmStyles.finalScoreLabel}>{teamBName}</Text>
                <TextInput style={tmStyles.finalScoreInput} value={scoreB} onChangeText={setScoreB}
                  keyboardType="number-pad" maxLength={2} placeholder="0" placeholderTextColor={colors.gray} />
              </View>
            </View>
            <Text style={{ color: colors.grayLight, fontSize: 13, fontWeight: 'bold', marginTop: spacing.lg, marginBottom: spacing.sm }}>
              Player Stats
            </Text>
            {[...presentA.map(p => ({ p, team: teamAName })), ...presentB.map(p => ({ p, team: teamBName }))].map(({ p, team }) => {
              const g = goals[p.id] || 0;
              const c = cards[p.id] || { yellow: 0, red: 0 };
              return (
                <View key={p.id} style={tmStyles.finalStatRow}>
                  <Text style={{ color: colors.gray, fontSize: 10, width: 60 }} numberOfLines={1}>{team}</Text>
                  <Text style={{ color: colors.grayLight, fontSize: 12, flex: 1 }} numberOfLines={1}>{playerName(p)}</Text>
                  {g > 0 && <Text style={{ color: colors.gold, fontSize: 12 }}>⚽{g} </Text>}
                  {c.yellow > 0 && <Text style={{ fontSize: 12 }}>🟡{c.yellow} </Text>}
                  {c.red > 0 && <Text style={{ fontSize: 12 }}>🔴{c.red}</Text>}
                </View>
              );
            })}
          </ScrollView>
        ) : null}

        {phase === 'final' && (
          <View style={tmStyles.footer}>
            <TouchableOpacity
              style={[tmStyles.startBtn, submitting && { opacity: 0.6 }]}
              onPress={handleSave} disabled={submitting}
            >
              {submitting
                ? <ActivityIndicator color={colors.dark} />
                : <Text style={tmStyles.startBtnText}>✓ Confirm & Close Match</Text>
              }
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const tmStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.dark },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 56 : 24,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.darkBorder,
  },
  closeBtn: { color: colors.grayLight, fontSize: 22, fontWeight: 'bold' },
  headerTitle: { color: colors.white, fontSize: 16, fontWeight: 'bold' },
  headerMeta: { color: colors.gray, fontSize: 12 },
  phaseTitle: { color: colors.grayLight, fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginTop: spacing.md },
  teamHeader: { color: colors.gold, fontSize: 13, fontWeight: 'bold', marginBottom: spacing.xs, letterSpacing: 0.5 },
  attRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.darkBorder,
  },
  attName: { color: colors.grayLight, fontSize: 14, flex: 1 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.darkBorder, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: colors.grayLight, fontSize: 14, fontWeight: 'bold' },
  footer: {
    borderTopWidth: 1, borderTopColor: colors.darkBorder,
    padding: spacing.md, paddingBottom: Platform.OS === 'ios' ? 34 : spacing.md,
  },
  footerHint: { color: colors.gray, fontSize: 12, textAlign: 'center', marginBottom: spacing.sm },
  startBtn: { backgroundColor: colors.gold, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  startBtnText: { color: colors.dark, fontWeight: 'bold', fontSize: 16 },
  timerBlock: { alignItems: 'center', paddingVertical: spacing.md },
  timerPhase: { fontSize: 13, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.xs },
  timerDisplay: { color: colors.white, fontSize: 56, fontWeight: 'bold', fontVariant: ['tabular-nums'] },
  timerBtns: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  timerBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: radius.md },
  timerBtnText: { color: colors.white, fontWeight: 'bold', fontSize: 14 },
  playerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.darkBorder,
  },
  playerInfo: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  playerName: { color: colors.grayLight, fontSize: 13 },
  statBtns: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statBtn: { backgroundColor: colors.darkCard, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  statBtnText: { fontSize: 13 },
  goalCount: { color: colors.gold, fontWeight: 'bold', fontSize: 14, minWidth: 16, textAlign: 'center' },
  finalScoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, marginVertical: spacing.md },
  finalScoreBox: { alignItems: 'center', gap: spacing.xs },
  finalScoreLabel: { color: colors.grayLight, fontSize: 13, fontWeight: '600' },
  finalScoreInput: {
    backgroundColor: colors.darkCard, color: colors.white, fontSize: 36, fontWeight: 'bold',
    textAlign: 'center', width: 80, height: 60, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.darkBorder,
  },
  finalStatRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.darkBorder,
  },
});

function RefAssignModal({ match, visible, onClose, onAssigned }) {
  const [referees, setReferees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(null);

  useEffect(() => {
    if (!visible || !match) return;
    setLoading(true);
    // Fetch referees who accepted this tournament
    supabase
      .from('tournament_referees')
      .select('referee_id, players:referee_id(id, first_name, last_name, name, avatar_url)')
      .eq('tournament_id', match.tournament_id)
      .eq('status', 'accepted')
      .then(({ data }) => {
        const refs = (data || []).map(r => r.players).filter(Boolean);
        setReferees(refs);
        setLoading(false);
      });
  }, [visible, match?.id]);

  async function handleAssign(refId) {
    setAssigning(refId);
    const { error } = await supabase
      .from('tournament_matches')
      .update({ referee_id: refId })
      .eq('id', match.id);
    setAssigning(null);
    if (error) { Alert.alert('Error', error.message); return; }
    onAssigned();
  }

  if (!match) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { maxHeight: '70%' }]}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Assign Referee</Text>
          <Text style={{ color: colors.gray, fontSize: 12, marginBottom: spacing.md }}>
            {match.team_a?.name || 'Team A'} vs {match.team_b?.name || 'Team B'}
          </Text>
          {loading ? (
            <ActivityIndicator color={colors.gold} />
          ) : referees.length === 0 ? (
            <Text style={{ color: colors.gray, fontSize: 13, textAlign: 'center' }}>No referees have accepted this tournament yet.{'\n'}Referees can volunteer from their Feed tab.</Text>
          ) : (
            <ScrollView>
              {referees.map(ref => {
                const refName = [ref.first_name, ref.last_name].filter(Boolean).join(' ') || ref.name;
                return (
                  <TouchableOpacity
                    key={ref.id}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.darkBorder, gap: spacing.sm }}
                    onPress={() => handleAssign(ref.id)}
                    disabled={assigning === ref.id}
                  >
                    {ref.avatar_url
                      ? <Image source={{ uri: ref.avatar_url }} style={{ width: 36, height: 36, borderRadius: 18 }} />
                      : <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.darkBorder, justifyContent: 'center', alignItems: 'center' }}>
                          <Text style={{ color: colors.grayLight, fontWeight: 'bold' }}>{(ref.first_name?.[0] || '?').toUpperCase()}</Text>
                        </View>
                    }
                    <Text style={{ color: colors.grayLight, fontSize: 14, flex: 1 }}>{refName}</Text>
                    {assigning === ref.id
                      ? <ActivityIndicator color={colors.gold} size="small" />
                      : <Text style={{ color: colors.gold, fontSize: 13, fontWeight: 'bold' }}>Assign</Text>
                    }
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
          <TouchableOpacity style={{ marginTop: spacing.md, alignItems: 'center', paddingVertical: 10 }} onPress={onClose}>
            <Text style={{ color: colors.gray, fontSize: 14 }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function TournamentDetail({ tournament: tournamentProp, onBack, onRegisterDone, isAdmin }) {
  const queryClient = useQueryClient();
  const { player } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [showScoreModal, setShowScoreModal] = useState(false);
  const [scoringMatch, setScoringMatch] = useState(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [showRefModal, setShowRefModal] = useState(false);
  const [assigningMatch, setAssigningMatch] = useState(null);

  // Always keep tournament data fresh so registration status is accurate
  const { data: tournament = tournamentProp, refetch: refetchTournament } = useQuery({
    queryKey: ['tournamentDetail', tournamentProp.id],
    queryFn: () => fetchTournamentDetail(tournamentProp.id),
    initialData: tournamentProp,
  });

  const [checkingIn, setCheckingIn] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);

  // Check-in status
  const { data: checkinData } = useQuery({
    queryKey: ['tournament_checkin', tournament.id, player?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('tournament_checkins')
        .select('id')
        .eq('tournament_id', tournament.id)
        .eq('player_id', player.id)
        .maybeSingle();
      return !!data;
    },
    enabled: !!player?.id,
  });

  useEffect(() => {
    if (checkinData != null) setCheckedIn(checkinData);
  }, [checkinData]);

  async function handleCheckIn() {
    if (checkingIn || checkedIn) return;
    setCheckingIn(true);
    const { error } = await supabase
      .from('tournament_checkins')
      .upsert({ tournament_id: tournament.id, player_id: player.id }, { onConflict: 'tournament_id,player_id' });
    setCheckingIn(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setCheckedIn(true);
  }

  const registeredTeams = tournament.tournament_teams?.length || 0;
  const maxTeams = tournament.max_teams || 8;
  const isFull = registeredTeams >= maxTeams;

  // Lock registration 24h before kickoff
  const hoursUntilKickoff = tournament.kickoff_date
    ? (new Date(tournament.kickoff_date) - new Date()) / (1000 * 60 * 60)
    : Infinity;
  const registrationLocked = hoursUntilKickoff <= 24;

  // Find if the current player is already in any registered team
  const myTeam = tournament.tournament_teams?.find(
    t => Array.isArray(t.player_ids) && t.player_ids.includes(player?.id)
  );
  const isRegistered = !!myTeam;
  const isWaitlisted = myTeam?.registration_type === 'waitlist';
  const isCaptain = myTeam?.captain_id === player?.id;
  const isSolo = myTeam?.registration_type === 'solo_draft';

  async function handleWithdraw() {
    const title = isSolo || isCaptain ? 'Withdraw Team' : 'Leave Team';
    const msg = isSolo
      ? 'This will remove your solo entry from the tournament.'
      : isCaptain
        ? `You are the captain. This will disband "${myTeam.name}" and remove all members from the tournament.`
        : `This will remove you from "${myTeam.name}".`;

    Alert.alert(title, msg + '\n\nAre you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: title, style: 'destructive', onPress: async () => {
          setWithdrawing(true);
          try {
            // Use myTeam directly — avoids RLS issues on SELECT
            if (isSolo || isCaptain || (myTeam.player_ids?.length ?? 0) <= 1) {
              const { error: e } = await supabase
                .from('tournament_teams')
                .delete()
                .eq('id', myTeam.id);
              if (e) throw e;
            } else {
              const newIds = (myTeam.player_ids || []).filter(id => id !== player.id);
              const { error: e } = await supabase
                .from('tournament_teams')
                .update({ player_ids: newIds })
                .eq('id', myTeam.id);
              if (e) throw e;
            }

            queryClient.invalidateQueries(['tournaments']);
            queryClient.invalidateQueries(['tournamentDetail', tournamentProp.id]);
            refetchTournament();
            onRegisterDone();
          } catch (err) {
            Alert.alert('Error', err.message);
          } finally {
            setWithdrawing(false);
          }
        },
      },
    ]);
  }

  const { data: matches = [], refetch: refetchMatches } = useQuery({
    queryKey: ['tournament_matches', tournament.id],
    queryFn: () => fetchTournamentMatches(tournament.id),
  });

  const { data: topScorers = [] } = useQuery({
    queryKey: ['tournament_top_scorers', tournament.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tournament_player_stats')
        .select('player_id, goals, players(first_name, last_name, name, avatar_url), tournament_teams(name)')
        .eq('tournament_id', tournament.id)
        .gt('goals', 0)
        .order('goals', { ascending: false })
        .limit(20);
      if (error) return [];
      // Aggregate goals per player across matches
      const map = {};
      (data || []).forEach(row => {
        if (!map[row.player_id]) {
          const p = row.players;
          map[row.player_id] = {
            id: row.player_id,
            name: [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.name || 'Player',
            avatar_url: p?.avatar_url,
            team: row.tournament_teams?.name || '',
            goals: 0,
          };
        }
        map[row.player_id].goals += row.goals;
      });
      return Object.values(map).sort((a, b) => b.goals - a.goals).slice(0, 3);
    },
  });

  async function handleSaveScore(match, scoreA, scoreB) {
    const winnerId = scoreA > scoreB ? match.team_a_id : match.team_b_id;

    const { error } = await supabase
      .from('tournament_matches')
      .update({ score_a: scoreA, score_b: scoreB, winner_id: winnerId, status: 'completed' })
      .eq('id', match.id);

    if (error) { Alert.alert('Error', error.message); return; }

    const nextRound = match.round + 1;
    const nextMatchNum = Math.ceil(match.match_number / 2);
    const isTeamASlot = match.match_number % 2 === 1;

    const { data: nextMatch } = await supabase
      .from('tournament_matches')
      .select('id')
      .eq('tournament_id', match.tournament_id)
      .eq('round', nextRound)
      .eq('match_number', nextMatchNum)
      .maybeSingle();

    if (nextMatch) {
      await supabase
        .from('tournament_matches')
        .update(isTeamASlot ? { team_a_id: winnerId } : { team_b_id: winnerId })
        .eq('id', nextMatch.id);
    }

    refetchMatches();
  }

  return (
    <ScrollView style={styles.detailContainer} contentContainerStyle={styles.detailContent}>

      {/* Back */}
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Text style={styles.backBtnText}>← Back</Text>
      </TouchableOpacity>

      {/* Hero — photo banner */}
      <ImageBackground
        source={require('../../assets/summer-series-bg.jpg')}
        style={styles.detailHero}
        resizeMode="cover"
        imageStyle={{ borderRadius: 16 }}
      >
        <LinearGradient
          colors={['rgba(5,5,18,0.45)', 'rgba(5,5,18,0.82)']}
          style={[StyleSheet.absoluteFill, { borderRadius: 16 }]}
        />
        <View style={styles.heroContent}>
          <Text style={styles.heroIcon}>🏆</Text>
          <Text style={styles.detailHeroTitle}>{tournament.name}</Text>
          <View style={styles.heroBadgeRow}>
            <View style={styles.heroBadge}><Text style={styles.heroBadgeText}>{tournament.format}</Text></View>
            <StatusBadge status={tournament.status} />
          </View>
        </View>
      </ImageBackground>

      {/* Stat Cards */}
      <View style={styles.statCardsRow}>
        {[
          { label: 'Entry Fee', value: `$${tournament.entry_fee}`, icon: '💰' },
          tournament.prize_money > 0 ? { label: 'Prize Pool', value: `$${tournament.prize_money}`, icon: '🏆', gold: true } : null,
          { label: 'Teams', value: `${registeredTeams}/${maxTeams}`, icon: '👥' },
          { label: 'Game Time', value: tournament.game_duration ? `${tournament.game_duration}min` : tournament.format, icon: '⏱️' },
          { label: 'Per Team', value: `${playersPerSide(tournament.format) + 1}p`, icon: '🏃' },
        ].filter(Boolean).map(stat => (
          <View key={stat.label} style={[styles.statCard, stat.gold && { borderColor: '#F5C518' }]}>
            <Text style={styles.statCardIcon}>{stat.icon}</Text>
            <Text style={[styles.statCardVal, stat.gold && { color: '#F5C518' }]}>{stat.value}</Text>
            <Text style={styles.statCardLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {/* Date & Venue */}
      <View style={styles.detailSection}>
        <Text style={styles.detailSectionTitle}>📅 When & Where</Text>
        <Text style={styles.detailText}>{formatDate(tournament.kickoff_date)}</Text>
        <Text style={styles.detailText}>📍 {tournament.venue}</Text>
      </View>

      {/* Bracket */}
      <View style={styles.detailSection}>
        <Text style={styles.detailSectionTitle}>🗂️ Bracket</Text>
        <BracketView
          matches={matches}
          isAdmin={isAdmin}
          onScorePress={match => { setScoringMatch(match); setShowScoreModal(true); }}
          onAssignRef={match => { setAssigningMatch(match); setShowRefModal(true); }}
        />
      </View>

      {/* Top Scorers */}
      {topScorers.length > 0 && (
        <View style={styles.detailSection}>
          <Text style={styles.detailSectionTitle}>⚽ Top Scorers</Text>
          <View style={styles.scorersTable}>
            <View style={styles.scorersHeader}>
              <Text style={[styles.scorersHeaderText, { flex: 0, width: 28 }]}>#</Text>
              <Text style={[styles.scorersHeaderText, { flex: 1 }]}>Player</Text>
              <Text style={[styles.scorersHeaderText, { flex: 0, width: 50, textAlign: 'center' }]}>Team</Text>
              <Text style={[styles.scorersHeaderText, { flex: 0, width: 40, textAlign: 'center' }]}>⚽</Text>
            </View>
            {topScorers.map((s, i) => (
              <View key={s.id} style={styles.scorersRow}>
                <Text style={[styles.scorersRank, i === 0 && { color: colors.gold }]}>
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
                </Text>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  {s.avatar_url
                    ? <Image source={{ uri: s.avatar_url }} style={styles.scorerAvatar} />
                    : <View style={styles.scorerAvatarFallback}><Text style={styles.scorerAvatarText}>{(s.name[0] || '?').toUpperCase()}</Text></View>
                  }
                  <Text style={styles.scorerName} numberOfLines={1}>{s.name}</Text>
                </View>
                <Text style={styles.scorerTeam} numberOfLines={1}>{s.team}</Text>
                <Text style={styles.scorerGoals}>{s.goals}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Teams */}
      <View style={styles.detailSection}>
        <Text style={styles.detailSectionTitle}>
          👕 Registered Teams ({tournament.tournament_teams?.length || 0})
        </Text>
        {tournament.tournament_teams?.length > 0
          ? tournament.tournament_teams.map(team => (
            <View key={team.id} style={styles.teamRow}>
              <View style={styles.teamAvatar}>
                <Text style={styles.teamAvatarText}>{(team.name || 'T')[0]}</Text>
              </View>
              <View style={styles.teamInfo}>
                <Text style={styles.teamName}>{team.name || 'Unnamed Team'}</Text>
                <Text style={styles.teamMeta}>
                  {team.player_ids?.length || 0} players · ⭐ {team.avg_rating?.toFixed(1) || '—'}
                </Text>
              </View>
              <View style={styles.teamTypeBadge}>
                <Text style={styles.teamTypeText}>
                  {team.registration_type === 'solo_draft' ? 'Draft' : 'Team'}
                </Text>
              </View>
            </View>
          ))
          : (
            <Text style={styles.noTeamsText}>
              No teams registered yet. Be the first!
            </Text>
          )
        }
      </View>

      {/* Capacity */}
      <View style={styles.detailSection}>
        <CapacityBar registeredTeams={registeredTeams} maxTeams={maxTeams} format={tournament.format} />
      </View>

      {/* Registration status badge */}
      {isRegistered && (
        <View style={[styles.registeredBanner, isWaitlisted && { borderColor: '#e8a832' }]}>
          <Text style={styles.registeredBannerIcon}>{isWaitlisted ? '⏳' : '✓'}</Text>
          <View>
            <Text style={styles.registeredBannerTitle}>
              {isWaitlisted ? 'Waitlisted'
                : isSolo ? 'Registered (Solo Draft)'
                : isCaptain ? `Captain · ${myTeam.name}`
                : `Team · ${myTeam.name}`}
            </Text>
            <Text style={styles.registeredBannerSub}>
              {isWaitlisted
                ? 'Registration is locked. Admin will approve your entry if a spot opens.'
                : isSolo
                  ? "You'll be drafted into a team before kickoff."
                  : isCaptain
                    ? `${myTeam.player_ids?.length || 1} / ${playersPerSide(tournament.format) + 1} players joined`
                    : "You're on the roster."}
            </Text>
          </View>
        </View>
      )}

      {/* Check-in — within 60 min of kickoff */}
      {isRegistered && !isWaitlisted && hoursUntilKickoff <= 1 && hoursUntilKickoff > -0.5 && (
        checkedIn ? (
          <View style={{ backgroundColor: 'rgba(76,175,80,0.1)', borderWidth: 1, borderColor: colors.success, borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: spacing.md }}>
            <Text style={{ color: colors.success, fontWeight: 'bold', fontSize: 15 }}>✅ You're checked in!</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={{ backgroundColor: colors.gold, borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: spacing.md, opacity: checkingIn ? 0.7 : 1 }}
            onPress={handleCheckIn}
            disabled={checkingIn}
          >
            {checkingIn
              ? <ActivityIndicator color={colors.dark} size="small" />
              : <Text style={{ color: colors.dark, fontWeight: 'bold', fontSize: 16 }}>📍 I'm Here!</Text>
            }
          </TouchableOpacity>
        )
      )}

      {/* Register + Share CTAs */}
      <View style={styles.cupActions}>
        {isRegistered ? (
          <TouchableOpacity
            style={[styles.bigRegisterBtn, styles.withdrawBtn]}
            onPress={handleWithdraw}
            disabled={withdrawing}
          >
            {withdrawing
              ? <ActivityIndicator color="#e05555" />
              : <Text style={[styles.bigRegisterBtnText, styles.withdrawBtnText]}>
                  {isWaitlisted ? '✕ Leave Waitlist' : isSolo || isCaptain ? '✕ Withdraw Team' : '✕ Leave Team'}
                </Text>
            }
          </TouchableOpacity>
        ) : registrationLocked ? (
          <TouchableOpacity
            style={[styles.bigRegisterBtn, { backgroundColor: '#e8a832' }]}
            onPress={() => setShowModal(true)}
          >
            <Text style={styles.bigRegisterBtnText}>⏳ Join Waitlist</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.bigRegisterBtn, isFull && styles.bigRegisterBtnFull]}
            onPress={() => !isFull && setShowModal(true)}
            disabled={isFull}
          >
            <Text style={styles.bigRegisterBtnText}>
              {isFull ? 'Tournament Full' : tournament.entry_fee > 0 ? `Register — $${tournament.entry_fee}` : 'Register — Free'}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.cupShareBtn}
          onPress={() => {
            const date = tournament.kickoff_date
              ? new Date(tournament.kickoff_date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
              : '';
            const registeredTeams = tournament.tournament_teams?.length || 0;
            const maxTeams = tournament.max_teams || 8;
            const spotsLeft = maxTeams - registeredTeams;
            Share.share({
              message: [
                `🏆 Join me at ${tournament.name} on Urban PL!`,
                ``,
                `📍 ${tournament.venue}`,
                `📅 ${date}`,
                `⚽ Format: ${tournament.format}`,
                `💰 Entry: $${tournament.entry_fee}`,
                `👥 ${spotsLeft} team spot${spotsLeft !== 1 ? 's' : ''} left`,
                ``,
                `Download Urban PL and register your team! 🟩`,
              ].join('\n'),
              title: `Join ${tournament.name}!`,
            });
          }}
        >
          <Text style={styles.cupShareBtnText}>📤</Text>
        </TouchableOpacity>
      </View>

      <RegisterModal
        tournament={tournament}
        visible={showModal}
        onClose={() => setShowModal(false)}
        onDone={onRegisterDone}
        waitlistMode={registrationLocked}
      />

      <TournamentMatchModal
        match={scoringMatch}
        tournament={tournament}
        visible={showScoreModal}
        onClose={() => { setShowScoreModal(false); setScoringMatch(null); }}
        onSave={handleSaveScore}
      />

      <RefAssignModal
        match={assigningMatch}
        visible={showRefModal}
        onClose={() => { setShowRefModal(false); setAssigningMatch(null); }}
        onAssigned={() => { refetchMatches(); setShowRefModal(false); setAssigningMatch(null); }}
      />

    </ScrollView>
  );
}

export default function CupsScreen() {
  const [selectedTournament, setSelectedTournament] = useState(null);
  const { player } = useAuth();
  const queryClient = useQueryClient();

  const { data: tournaments, isLoading, isError, refetch } = useQuery({
    queryKey: ['tournaments'],
    queryFn: fetchTournaments,
  });

  async function onRegisterDone() {
    queryClient.invalidateQueries(['tournaments']);
    if (selectedTournament) {
      const updated = await fetchTournamentDetail(selectedTournament.id);
      setSelectedTournament(updated);
    }
  }

  if (selectedTournament) {
    return (
      <TournamentDetail
        tournament={selectedTournament}
        onBack={() => setSelectedTournament(null)}
        onRegisterDone={onRegisterDone}
        isAdmin={player?.is_admin}
      />
    );
  }

  return (
    <View style={styles.container}>
      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.gold} size="large" />
        </View>
      )}

      {isError && (
        <View style={styles.center}>
          <Text style={styles.errorText}>Failed to load tournaments</Text>
          <TouchableOpacity onPress={refetch} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {!isLoading && !isError && tournaments?.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🏆</Text>
          <Text style={styles.emptyText}>No tournaments yet</Text>
          <Text style={styles.emptySubText}>Check back soon!</Text>
        </View>
      )}

      {!isLoading && !isError && tournaments?.length > 0 && (
        <FlatList
          data={tournaments}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
renderItem={({ item }) => (
            <TournamentCard
              tournament={item}
              playerId={player?.id}
              onPress={() => setSelectedTournament(item)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.dark },
  listContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  errorText: { color: colors.error, marginBottom: spacing.md },
  retryBtn: { padding: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.darkCard, borderRadius: radius.md },
  retryText: { color: colors.gold },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyText: { color: colors.white, fontSize: 18, fontWeight: 'bold' },
  emptySubText: { color: colors.gray, fontSize: 13, marginTop: spacing.xs },

  // Card
  card: {
    backgroundColor: colors.darkCard,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.darkBorder,
  },

  // Hero
  heroBanner: {
    height: 140,
    backgroundColor: '#0a2a0a',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailHero: {
    height: 160,
    backgroundColor: '#0a2a0a',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.lg,
    marginBottom: spacing.md,
  },
  heroGrid: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  heroGridLine: { width: 1, backgroundColor: 'rgba(201,168,76,0.1)' },
  heroContent: { alignItems: 'center', zIndex: 1 },
  heroIcon: { fontSize: 32, marginBottom: spacing.xs },
  heroTitle: { color: colors.white, fontWeight: 'bold', fontSize: 16, textAlign: 'center', paddingHorizontal: spacing.md },
  detailHeroTitle: { color: colors.white, fontWeight: 'bold', fontSize: 20, textAlign: 'center', paddingHorizontal: spacing.md },
  heroBadgeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  heroBadge: {
    backgroundColor: 'rgba(26,26,46,0.85)',
    borderRadius: radius.sm,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
  },
  heroBadgeText: { color: colors.gold, fontSize: 11, fontWeight: 'bold' },
  statusBadge: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
  },
  statusText: { fontSize: 11, fontWeight: 'bold' },

  // Card body
  cardBody: { padding: spacing.md, gap: spacing.sm },
  metaRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.dark,
    borderRadius: radius.sm,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
  },
  metaChipGold: { borderWidth: 1, borderColor: 'rgba(245,197,24,0.4)', backgroundColor: 'rgba(245,197,24,0.08)' },
  metaIcon: { fontSize: 12 },
  metaText: { color: colors.grayLight, fontSize: 12 },
  capTrack: {
    height: 4,
    backgroundColor: colors.darkBorder,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  capFill: { height: '100%', borderRadius: 2 },
  capText: { color: colors.gray, fontSize: 11 },
  venueText: { color: colors.gray, fontSize: 12 },
  registerBtnRow: { marginTop: spacing.xs },
  registerBtn: {
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    padding: spacing.sm,
    alignItems: 'center',
  },
  registerBtnFull: { backgroundColor: colors.darkBorder },
  registerBtnText: { color: colors.dark, fontWeight: 'bold', fontSize: 14 },
  registerBtnTextFull: { color: colors.gray },

  // Detail
  detailContainer: { flex: 1, backgroundColor: colors.dark },
  detailContent: { padding: spacing.md, paddingBottom: spacing.xxl },
  backBtn: { marginBottom: spacing.md },
  backBtnText: { color: colors.gold, fontSize: 16 },
  statCardsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  statCard: {
    flex: 1,
    backgroundColor: colors.darkCard,
    borderRadius: radius.md,
    padding: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.darkBorder,
  },
  statCardIcon: { fontSize: 18, marginBottom: 4 },
  statCardVal: { color: colors.gold, fontWeight: 'bold', fontSize: 14 },
  statCardLabel: { color: colors.gray, fontSize: 10, marginTop: 2, textAlign: 'center' },
  detailSection: {
    backgroundColor: colors.darkCard,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.darkBorder,
  },
  detailSectionTitle: { color: colors.gold, fontWeight: 'bold', fontSize: 14, marginBottom: spacing.sm },
  detailText: { color: colors.grayLight, fontSize: 13, marginBottom: spacing.xs },

  // Bracket
  bracketContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bracketStage: { flex: 1, gap: spacing.xs },
  bracketStageLabel: { color: colors.gray, fontSize: 10, textAlign: 'center', marginBottom: spacing.xs, fontWeight: 'bold' },
  bracketTeam: {
    backgroundColor: colors.dark,
    borderRadius: radius.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  bracketTeamTbd: { borderStyle: 'dashed', opacity: 0.5 },
  bracketTeamFinal: { borderColor: colors.gold },
  bracketTeamNum: { color: colors.gold, fontSize: 11, fontWeight: 'bold', width: 16 },
  bracketTeamName: { color: colors.grayLight, fontSize: 11 },
  bracketArrow: { color: colors.gold, fontSize: 18, fontWeight: 'bold' },
  bracketEmpty: {
    backgroundColor: colors.dark,
    borderRadius: radius.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    borderStyle: 'dashed',
  },
  bracketEmptyText: { color: colors.gray, fontSize: 12, textAlign: 'center', lineHeight: 18 },

  // Real bracket
  bracketRow: { flexDirection: 'row', paddingBottom: spacing.sm },
  bracketColumn: { width: 130, marginRight: spacing.sm },
  bracketRoundLabel: {
    color: colors.gray, fontSize: 10, fontWeight: 'bold',
    textAlign: 'center', marginBottom: spacing.sm,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  bracketMatch: {
    backgroundColor: colors.dark,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  bracketMatchDone: { borderColor: colors.gold },
  bracketMatchBye: { borderColor: colors.darkBorder, opacity: 0.5 },
  bracketTime: { color: colors.gray, fontSize: 9, paddingHorizontal: 8, paddingTop: 5 },
  bracketByeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 8 },
  bracketByeTeam: { color: colors.grayLight, fontSize: 11, flex: 1 },
  bracketByeLabel: { color: colors.gray, fontSize: 9, fontWeight: 'bold', marginLeft: 4 },
  bracketTeamRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
  },
  bracketWinnerRow: { backgroundColor: 'rgba(201,168,76,0.1)' },
  bracketTeamText: { color: colors.grayLight, fontSize: 11, flex: 1 },
  bracketScore: { color: colors.gray, fontSize: 13, fontWeight: 'bold', marginLeft: 4 },
  bracketScoreWinner: { color: colors.gold },
  bracketMatchDivider: { height: 1, backgroundColor: colors.darkBorder },
  bracketEditHint: {
    color: colors.gold, fontSize: 9, textAlign: 'center',
    paddingVertical: 3, opacity: 0.7,
  },
  bracketRefText: {
    color: colors.gray, fontSize: 9, paddingHorizontal: 8, paddingBottom: 4,
  },
  bracketAssignRef: {
    paddingHorizontal: 8, paddingVertical: 3,
  },
  bracketAssignRefText: {
    color: '#4A90D9', fontSize: 9, fontWeight: 'bold',
  },

  // Top Scorers
  scorersTable: {
    backgroundColor: colors.darkCard, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.darkBorder, overflow: 'hidden',
  },
  scorersHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, paddingHorizontal: 10,
    borderBottomWidth: 1, borderBottomColor: colors.darkBorder,
  },
  scorersHeaderText: { color: colors.gray, fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase' },
  scorersRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 10,
    borderBottomWidth: 1, borderBottomColor: colors.darkBorder,
  },
  scorersRank: { width: 28, fontSize: 16 },
  scorerAvatar: { width: 28, height: 28, borderRadius: 14 },
  scorerAvatarFallback: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.darkBorder, justifyContent: 'center', alignItems: 'center',
  },
  scorerAvatarText: { color: colors.grayLight, fontSize: 11, fontWeight: 'bold' },
  scorerName: { color: colors.grayLight, fontSize: 12, flex: 1 },
  scorerTeam: { color: colors.gray, fontSize: 10, width: 50, textAlign: 'center' },
  scorerGoals: { color: colors.gold, fontSize: 14, fontWeight: 'bold', width: 40, textAlign: 'center' },

  // Score modal
  scoreInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
    marginTop: spacing.sm,
  },
  scoreInputBlock: { flex: 1, alignItems: 'center' },
  scoreTeamName: {
    color: colors.grayLight, fontSize: 13, textAlign: 'center',
    marginBottom: spacing.sm, fontWeight: '600',
  },
  scoreInput: {
    backgroundColor: colors.dark,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    borderRadius: radius.md,
    color: colors.gold,
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    width: 80,
    padding: spacing.sm,
  },
  scoreVs: { color: colors.gray, fontSize: 16, fontWeight: 'bold' },

  // Teams
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark,
    gap: spacing.sm,
  },
  teamAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.darkBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamAvatarText: { color: colors.gold, fontWeight: 'bold' },
  teamInfo: { flex: 1 },
  teamName: { color: colors.white, fontSize: 14, fontWeight: '600' },
  teamMeta: { color: colors.gray, fontSize: 11 },
  teamTypeBadge: {
    backgroundColor: colors.goldDim,
    borderRadius: radius.sm,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  teamTypeText: { color: colors.gold, fontSize: 10, fontWeight: 'bold' },
  noTeamsText: { color: colors.gray, fontSize: 13, fontStyle: 'italic' },

  // Cup actions row
  cupActions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  cupShareBtn: {
    width: 48, height: 48, borderRadius: radius.md,
    backgroundColor: colors.darkCard, borderWidth: 1, borderColor: colors.darkBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  cupShareBtnText: { fontSize: 20 },

  // Big register button
  bigRegisterBtn: {
    flex: 1,
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  bigRegisterBtnFull: { backgroundColor: colors.darkBorder },
  bigRegisterBtnText: { color: colors.dark, fontWeight: 'bold', fontSize: 16 },
  withdrawBtn: { backgroundColor: '#1e1010', borderWidth: 1, borderColor: '#e05555' },
  withdrawBtnText: { color: '#e05555' },
  registeredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#0d2a0d',
    borderWidth: 1,
    borderColor: colors.success,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  registeredBannerIcon: { fontSize: 22, color: colors.success },
  registeredBannerTitle: { color: colors.success, fontWeight: 'bold', fontSize: 13 },
  registeredBannerSub: { color: colors.gray, fontSize: 11, marginTop: 2 },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.darkCard,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    borderTopWidth: 1,
    borderColor: colors.darkBorder,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: colors.darkBorder,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  modalTitle: { color: colors.white, fontWeight: 'bold', fontSize: 18, marginBottom: spacing.lg },
  typeSwitcher: {
    flexDirection: 'row',
    backgroundColor: colors.dark,
    borderRadius: radius.md,
    padding: 3,
    marginBottom: spacing.md,
  },
  teamSubSwitcher: {
    flexDirection: 'row',
    backgroundColor: colors.dark,
    borderRadius: radius.sm,
    padding: 3,
    marginBottom: spacing.sm,
  },
  teamSubBtn: { flex: 1, paddingVertical: spacing.xs, alignItems: 'center', borderRadius: radius.sm },
  teamSubBtnActive: { backgroundColor: 'rgba(201,168,76,0.2)', borderWidth: 1, borderColor: colors.gold },
  teamSubBtnText: { color: colors.gray, fontSize: 13 },
  teamSubBtnTextActive: { color: colors.gold, fontWeight: 'bold' },
  teamNameInput: {
    marginTop: spacing.sm,
    backgroundColor: colors.darkCard,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    borderRadius: radius.md,
    color: colors.white,
    padding: spacing.sm,
    fontSize: 15,
  },
  typeBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm },
  typeBtnActive: { backgroundColor: colors.gold },
  typeBtnText: { color: colors.gray, fontWeight: '600' },
  typeBtnTextActive: { color: colors.dark, fontWeight: 'bold' },
  modalInfo: {
    backgroundColor: colors.dark,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  modalInfoText: { color: colors.grayLight, fontSize: 13, lineHeight: 20 },
  bookingSummary: {
    backgroundColor: colors.dark,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bookingTitle: { color: colors.gold, fontWeight: 'bold', fontSize: 13, marginBottom: spacing.sm },
  bookingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.darkCard,
  },
  bookingRowTotal: { borderBottomWidth: 0, marginTop: spacing.xs },
  bookingKey: { color: colors.gray, fontSize: 13 },
  bookingVal: { color: colors.white, fontSize: 13 },
  bookingKeyTotal: { color: colors.grayLight, fontSize: 14, fontWeight: 'bold' },
  bookingValTotal: { color: colors.gold, fontSize: 16, fontWeight: 'bold' },
  confirmBtn: {
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  confirmBtnDisabled: { opacity: 0.6 },
  confirmBtnText: { color: colors.dark, fontWeight: 'bold', fontSize: 16 },
  cancelBtn: { alignItems: 'center', padding: spacing.sm },
  cancelBtnText: { color: colors.gray, fontSize: 14 },
});

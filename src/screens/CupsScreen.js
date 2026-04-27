import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, ScrollView, Modal, Alert, Share,
  TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { colors, spacing, radius } from '../theme';

async function fetchTournaments() {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*, tournament_teams(id, name, player_ids, avg_rating, registration_type)')
    .order('kickoff_date', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchTournamentDetail(id) {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*, tournament_teams(id, name, player_ids, avg_rating, registration_type)')
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
    .select('id, tournament_id, round, match_number, team_a_id, team_b_id, score_a, score_b, winner_id, status, team_a:team_a_id(id, name), team_b:team_b_id(id, name)')
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

function TournamentCard({ tournament, onPress }) {
  const registeredTeams = tournament.tournament_teams?.length || 0;
  const maxTeams = tournament.max_teams || 8;
  const isFull = registeredTeams >= maxTeams;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      {/* Hero Banner */}
      <View style={styles.heroBanner}>
        <View style={styles.heroGrid}>
          {[...Array(5)].map((_, i) => (
            <View key={i} style={styles.heroGridLine} />
          ))}
        </View>
        <View style={styles.heroContent}>
          <Text style={styles.heroIcon}>🏆</Text>
          <Text style={styles.heroTitle}>{tournament.name}</Text>
          <View style={styles.heroBadgeRow}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>{tournament.format}</Text>
            </View>
            <StatusBadge status={tournament.status} />
          </View>
        </View>
      </View>

      {/* Meta */}
      <View style={styles.cardBody}>
        <View style={styles.metaRow}>
          <View style={styles.metaChip}>
            <Text style={styles.metaIcon}>💰</Text>
            <Text style={styles.metaText}>${tournament.entry_fee}</Text>
          </View>
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
            style={[styles.registerBtn, isFull && styles.registerBtnFull]}
            onPress={onPress}
          >
            <Text style={[styles.registerBtnText, isFull && styles.registerBtnTextFull]}>
              {isFull ? 'Full' : 'View & Register →'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function BracketView({ matches, isAdmin, onScorePress }) {
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
                    style={[styles.bracketMatch, match.status === 'completed' && styles.bracketMatchDone]}
                    onPress={() => canEdit && onScorePress(match)}
                    activeOpacity={canEdit ? 0.7 : 1}
                  >
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
                    {canEdit && (
                      <Text style={styles.bracketEditHint}>tap to score</Text>
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

function RegisterModal({ tournament, visible, onClose, onDone }) {
  const { player } = useAuth();
  const [type, setType] = useState('solo');
  const [teamMode, setTeamMode] = useState('create');
  const [teamName, setTeamName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [registering, setRegistering] = useState(false);

  async function handleRegister() {
    setRegistering(true);

    if (type === 'solo') {
      const { error } = await supabase.from('tournament_teams').insert({
        tournament_id: tournament.id,
        name: `${player.name || 'Player'}'s Team`,
        player_ids: [player.id],
        avg_rating: player.rating || 5.0,
        registration_type: 'solo_draft',
      });
      setRegistering(false);
      if (error) { Alert.alert('Error', error.message); return; }
      onDone(); onClose();

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
      setRegistering(false);
      if (error) { Alert.alert('Error', error.message); return; }
      onDone(); onClose();
      Alert.alert(
        '✅ Team Created!',
        `Your invite code:\n\n${code}\n\nShare it so teammates can join.`,
        [
          { text: 'Share Code', onPress: () => Share.share({ message: `Join my team "${teamName.trim()}" at ${tournament.name} on Urban PL!\n\nUse invite code: ${code}` }) },
          { text: 'Done' },
        ]
      );

    } else {
      const code = inviteCode.trim().toUpperCase();
      if (!code) { Alert.alert('Missing', 'Enter an invite code.'); setRegistering(false); return; }
      const { data: team, error: findError } = await supabase
        .from('tournament_teams')
        .select('id, player_ids, avg_rating, name')
        .eq('invite_code', code)
        .eq('tournament_id', tournament.id)
        .maybeSingle();
      if (findError || !team) {
        setRegistering(false);
        Alert.alert('Not Found', 'No team with that code. Double-check and try again.');
        return;
      }
      const maxPlayers = playersPerSide(tournament.format) + 1;
      if ((team.player_ids?.length || 0) >= maxPlayers) {
        setRegistering(false);
        Alert.alert('Team Full', `This team already has ${maxPlayers} players.`);
        return;
      }
      if (team.player_ids?.includes(player.id)) {
        setRegistering(false);
        Alert.alert('Already Joined', 'You are already on this team.');
        return;
      }
      const newIds = [...(team.player_ids || []), player.id];
      const newAvg = ((team.avg_rating || 5.0) * (team.player_ids?.length || 0) + (player.rating || 5.0)) / newIds.length;
      const { error: updateError } = await supabase
        .from('tournament_teams')
        .update({ player_ids: newIds, avg_rating: parseFloat(newAvg.toFixed(2)) })
        .eq('id', team.id);
      setRegistering(false);
      if (updateError) { Alert.alert('Error', updateError.message); return; }
      Alert.alert('✅ Joined!', `You've joined "${team.name}"!`);
      onDone(); onClose();
    }
  }

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
            <View style={[styles.bookingRow, styles.bookingRowTotal]}>
              <Text style={styles.bookingKeyTotal}>Entry Fee</Text>
              <Text style={styles.bookingValTotal}>${tournament?.entry_fee}</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.confirmBtn, registering && styles.confirmBtnDisabled]}
            onPress={handleRegister}
            disabled={registering}
          >
            {registering
              ? <ActivityIndicator color={colors.dark} />
              : <Text style={styles.confirmBtnText}>
                  {type === 'solo' ? 'Confirm & Register →' : teamMode === 'create' ? 'Create Team →' : 'Join Team →'}
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

function ScoreModal({ match, visible, onClose, onSave }) {
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (match) {
      setScoreA(match.score_a != null ? String(match.score_a) : '');
      setScoreB(match.score_b != null ? String(match.score_b) : '');
    }
  }, [match?.id]);

  async function handleSave() {
    const a = parseInt(scoreA);
    const b = parseInt(scoreB);
    if (isNaN(a) || isNaN(b) || a < 0 || b < 0) {
      Alert.alert('Invalid', 'Enter valid scores (0 or more).');
      return;
    }
    if (a === b) {
      Alert.alert('Invalid', 'No draws in knockout — one team must win.');
      return;
    }
    setSaving(true);
    await onSave(match, a, b);
    setSaving(false);
    onClose();
  }

  if (!match) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Enter Match Result</Text>
          <View style={styles.scoreInputRow}>
            <View style={styles.scoreInputBlock}>
              <Text style={styles.scoreTeamName} numberOfLines={2}>
                {match.team_a?.name || 'Team A'}
              </Text>
              <TextInput
                style={styles.scoreInput}
                value={scoreA}
                onChangeText={setScoreA}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={colors.gray}
              />
            </View>
            <Text style={styles.scoreVs}>vs</Text>
            <View style={styles.scoreInputBlock}>
              <Text style={styles.scoreTeamName} numberOfLines={2}>
                {match.team_b?.name || 'Team B'}
              </Text>
              <TextInput
                style={styles.scoreInput}
                value={scoreB}
                onChangeText={setScoreB}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={colors.gray}
              />
            </View>
          </View>
          <TouchableOpacity
            style={[styles.confirmBtn, saving && styles.confirmBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color={colors.dark} />
              : <Text style={styles.confirmBtnText}>Save Result →</Text>
            }
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TournamentDetail({ tournament, onBack, onRegisterDone, isAdmin }) {
  const queryClient = useQueryClient();
  const registeredTeams = tournament.tournament_teams?.length || 0;
  const maxTeams = tournament.max_teams || 8;
  const isFull = registeredTeams >= maxTeams;
  const [showModal, setShowModal] = useState(false);
  const [showScoreModal, setShowScoreModal] = useState(false);
  const [scoringMatch, setScoringMatch] = useState(null);

  const { data: matches = [], refetch: refetchMatches } = useQuery({
    queryKey: ['tournament_matches', tournament.id],
    queryFn: () => fetchTournamentMatches(tournament.id),
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

      {/* Hero */}
      <View style={styles.detailHero}>
        <View style={styles.heroGrid}>
          {[...Array(5)].map((_, i) => <View key={i} style={styles.heroGridLine} />)}
        </View>
        <View style={styles.heroContent}>
          <Text style={styles.heroIcon}>🏆</Text>
          <Text style={styles.detailHeroTitle}>{tournament.name}</Text>
          <View style={styles.heroBadgeRow}>
            <View style={styles.heroBadge}><Text style={styles.heroBadgeText}>{tournament.format}</Text></View>
            <StatusBadge status={tournament.status} />
          </View>
        </View>
      </View>

      {/* Stat Cards */}
      <View style={styles.statCardsRow}>
        {[
          { label: 'Entry Fee', value: `$${tournament.entry_fee}`, icon: '💰' },
          { label: 'Teams', value: `${registeredTeams}/${maxTeams}`, icon: '👥' },
          { label: 'Game Time', value: tournament.game_duration ? `${tournament.game_duration}min` : tournament.format, icon: '⏱️' },
          { label: 'Per Team', value: `${playersPerSide(tournament.format) + 1}p`, icon: '🏃' },
        ].map(stat => (
          <View key={stat.label} style={styles.statCard}>
            <Text style={styles.statCardIcon}>{stat.icon}</Text>
            <Text style={styles.statCardVal}>{stat.value}</Text>
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
        />
      </View>

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

      {/* Register + Share CTAs */}
      <View style={styles.cupActions}>
        <TouchableOpacity
          style={[styles.bigRegisterBtn, isFull && styles.bigRegisterBtnFull]}
          onPress={() => !isFull && setShowModal(true)}
          disabled={isFull}
        >
          <Text style={styles.bigRegisterBtnText}>
            {isFull ? 'Tournament Full' : `Register — $${tournament.entry_fee}`}
          </Text>
        </TouchableOpacity>

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
      />

      <ScoreModal
        match={scoringMatch}
        visible={showScoreModal}
        onClose={() => { setShowScoreModal(false); setScoringMatch(null); }}
        onSave={handleSaveScore}
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

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, ScrollView, Modal, Alert,
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

function BracketView({ teams }) {
  if (!teams || teams.length === 0) {
    return (
      <View style={styles.bracketEmpty}>
        <Text style={styles.bracketEmptyText}>
          Bracket will be generated 48hrs before kickoff once teams are confirmed.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.bracketContainer}>
      <View style={styles.bracketStage}>
        <Text style={styles.bracketStageLabel}>Group Stage</Text>
        {teams.slice(0, 4).map((team, i) => (
          <View key={team.id} style={styles.bracketTeam}>
            <Text style={styles.bracketTeamNum}>{i + 1}</Text>
            <Text style={styles.bracketTeamName}>{team.name || 'TBD'}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.bracketArrow}>→</Text>
      <View style={styles.bracketStage}>
        <Text style={styles.bracketStageLabel}>Semi-Finals</Text>
        {['SF 1', 'SF 2'].map(sf => (
          <View key={sf} style={[styles.bracketTeam, styles.bracketTeamTbd]}>
            <Text style={styles.bracketTeamName}>{sf}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.bracketArrow}>→</Text>
      <View style={styles.bracketStage}>
        <Text style={styles.bracketStageLabel}>Final</Text>
        <View style={[styles.bracketTeam, styles.bracketTeamFinal]}>
          <Text style={styles.bracketTeamName}>🏆 Final</Text>
        </View>
      </View>
    </View>
  );
}

function RegisterModal({ tournament, visible, onClose, onRegister }) {
  const [type, setType] = useState('solo');
  const [teamName, setTeamName] = useState('');
  const [registering, setRegistering] = useState(false);

  async function handleRegister() {
    setRegistering(true);
    await onRegister(type, teamName);
    setRegistering(false);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Register for {tournament?.name}</Text>

          {/* Type Switcher */}
          <View style={styles.typeSwitcher}>
            <TouchableOpacity
              style={[styles.typeBtn, type === 'solo' && styles.typeBtnActive]}
              onPress={() => setType('solo')}
            >
              <Text style={[styles.typeBtnText, type === 'solo' && styles.typeBtnTextActive]}>
                Solo
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeBtn, type === 'team' && styles.typeBtnActive]}
              onPress={() => setType('team')}
            >
              <Text style={[styles.typeBtnText, type === 'team' && styles.typeBtnTextActive]}>
                Team
              </Text>
            </TouchableOpacity>
          </View>

          {type === 'solo' ? (
            <View style={styles.modalInfo}>
              <Text style={styles.modalInfoText}>
                🎲 You'll be auto-drafted into a balanced team 48 hours before the tournament.
                Teams are assigned by skill rating for fair matchups.
              </Text>
            </View>
          ) : (
            <View style={styles.modalInfo}>
              <Text style={styles.modalInfoText}>
                👥 Register as a team. Enter your team name below.
              </Text>
            </View>
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
              : <Text style={styles.confirmBtnText}>Confirm & Register →</Text>
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

function TournamentDetail({ tournament, onBack, onRegister }) {
  const registeredTeams = tournament.tournament_teams?.length || 0;
  const maxTeams = tournament.max_teams || 8;
  const isFull = registeredTeams >= maxTeams;
  const [showModal, setShowModal] = useState(false);

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
        <BracketView teams={tournament.tournament_teams} />
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

      {/* Register CTA */}
      <TouchableOpacity
        style={[styles.bigRegisterBtn, isFull && styles.bigRegisterBtnFull]}
        onPress={() => !isFull && setShowModal(true)}
        disabled={isFull}
      >
        <Text style={styles.bigRegisterBtnText}>
          {isFull ? 'Tournament Full' : `Register — $${tournament.entry_fee}`}
        </Text>
      </TouchableOpacity>

      <RegisterModal
        tournament={tournament}
        visible={showModal}
        onClose={() => setShowModal(false)}
        onRegister={(type, teamName) => onRegister(tournament, type, teamName)}
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

  async function handleRegister(tournament, type, teamName) {
    const { error } = await supabase.from('tournament_teams').insert({
      tournament_id: tournament.id,
      name: type === 'solo' ? `${player.name || 'Player'}'s Team` : teamName,
      player_ids: [player.id],
      avg_rating: player.rating || 5.0,
      registration_type: type === 'solo' ? 'solo_draft' : 'team',
    });

    if (error) {
      console.log('Registration error:', error.message);
    } else {
      queryClient.invalidateQueries(['tournaments']);
      if (selectedTournament) {
        const updated = await fetchTournamentDetail(selectedTournament.id);
        setSelectedTournament(updated);
      }
    }
  }

  if (selectedTournament) {
    return (
      <TournamentDetail
        tournament={selectedTournament}
        onBack={() => setSelectedTournament(null)}
        onRegister={handleRegister}
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

  // Big register button
  bigRegisterBtn: {
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

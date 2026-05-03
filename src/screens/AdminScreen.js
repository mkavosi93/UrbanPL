import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Modal, KeyboardAvoidingView,
  Platform, Linking,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { colors, spacing, radius } from '../theme';

// Generate a 60-minute signed URL for a private referee ID doc and open it
async function viewRefereeId(storagePath) {
  if (!storagePath) { Alert.alert('No ID', 'This referee has not uploaded an ID document.'); return; }
  const { data, error } = await supabase.storage
    .from('referee-ids')
    .createSignedUrl(storagePath, 3600); // 1-hour expiry
  if (error || !data?.signedUrl) {
    Alert.alert('Error', 'Could not load ID document. ' + (error?.message || ''));
    return;
  }
  Linking.openURL(data.signedUrl);
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLOTS = ['AM', 'PM', 'EVE'];
const SLOT_LABELS = { AM: 'Morning', PM: 'Afternoon', EVE: 'Evening' };
const FORMATS = ['5v5', '6v6', '7v7', '8v8', '11v11'];
const GAME_STATUSES = ['open', 'active', 'completed', 'cancelled'];
const CUP_STATUSES  = ['upcoming', 'active', 'completed', 'cancelled'];
const SECTIONS = ['Dashboard', 'Reports', 'Availability', 'New Game', 'New Cup', 'Payments', 'Referees'];

// ─── Fetch helpers ────────────────────────────────────────────────────────────
async function fetchAvailabilities() {
  const { data, error } = await supabase
    .from('players')
    .select('id, first_name, last_name, name, availability');
  if (error) throw error;
  return data || [];
}

async function fetchRecentGames() {
  const { data, error } = await supabase
    .from('games')
    .select('*, game_players(player_id), game_referees(status, players(first_name, last_name, name))')
    .order('kickoff_time', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data || [];
}

async function fetchRecentCups() {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*')
    .order('kickoff_date', { ascending: false })
    .limit(10);
  if (error) throw error;
  return data || [];
}

async function fetchPayments() {
  const { data, error } = await supabase
    .from('payments')
    .select('*, players(first_name, last_name, name), games(location, format, kickoff_time)')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

async function fetchReferees() {
  const { data, error } = await supabase
    .from('players')
    .select('id, first_name, last_name, name, email, referee_cert, referee_experience, referee_formats, referee_id_url, referee_selfie_url, referee_approved, created_at')
    .eq('role', 'Referee')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function fetchRefereePayouts() {
  const { data, error } = await supabase
    .from('game_referees')
    .select('*, players(id, first_name, last_name, name, referee_id_url), games(id, location, format, kickoff_time, referee_pay, status)')
    .eq('status', 'accepted');
  if (error) throw error;
  // Only show completed games
  return (data || []).filter(r => r.games?.status === 'completed');
}

async function fetchMatchReports() {
  const { data, error } = await supabase
    .from('games')
    .select(`
      id, location, format, kickoff_time, score_a, score_b, completed_at, referee_notes,
      game_player_stats(
        team, goals, won, yellow_cards, red_cards, is_goalkeeper, goals_conceded,
        players(id, first_name, last_name, name, role)
      ),
      game_players(player_id, team),
      game_referees(status, players(first_name, last_name, name))
    `)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

function calcPoints(s) {
  let pts = 0;
  if (s.won) pts += 3;
  pts += (s.goals || 0);
  if (s.is_goalkeeper) {
    if ((s.goals_conceded || 0) === 0) pts += 3;
    else if ((s.goals_conceded || 0) < 2) pts += 1;
  }
  pts -= (s.yellow_cards || 0);
  pts -= (s.red_cards || 0) * 3;
  return Math.max(0, pts);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toDateStr(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toTimeStr(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function statusColor(s) {
  if (s === 'open') return colors.success;
  if (s === 'active') return colors.gold;
  if (s === 'completed') return colors.gray;
  return '#e05';
}

// ─── Edit Game Modal ──────────────────────────────────────────────────────────
function EditGameModal({ game, visible, onClose, onSaved }) {
  const [location, setLocation]         = useState(game?.location || '');
  const [format, setFormat]             = useState(game?.format   || '6v6');
  const [date, setDate]                 = useState(toDateStr(game?.kickoff_time));
  const [time, setTime]                 = useState(toTimeStr(game?.kickoff_time));
  const [spots, setSpots]               = useState(String(game?.total_spots || ''));
  const [fee, setFee]                   = useState(String(game?.entry_fee   || '0'));
  const [status, setStatus]             = useState(game?.status   || 'open');
  const [refPay, setRefPay]             = useState(String(game?.referee_pay || '0'));
  const [refsNeeded, setRefsNeeded]     = useState(String(game?.referees_needed || '1'));
  const [saving, setSaving]             = useState(false);

  // Re-seed fields when game changes (different row tapped)
  React.useEffect(() => {
    if (game) {
      setLocation(game.location || '');
      setFormat(game.format || '6v6');
      setDate(toDateStr(game.kickoff_time));
      setTime(toTimeStr(game.kickoff_time));
      setSpots(String(game.total_spots || ''));
      setFee(String(game.entry_fee || '0'));
      setStatus(game.status || 'open');
      setRefPay(String(game.referee_pay || '0'));
      setRefsNeeded(String(game.referees_needed || '1'));
    }
  }, [game?.id]);

  async function handleSave() {
    if (!location.trim()) { Alert.alert('Missing', 'Please enter a location.'); return; }
    if (!date.trim() || !time.trim()) { Alert.alert('Missing', 'Enter date (YYYY-MM-DD) and time (HH:MM).'); return; }
    const kickoff = new Date(`${date.trim()}T${time.trim()}:00`);
    if (isNaN(kickoff.getTime())) { Alert.alert('Invalid', 'Check date/time format.'); return; }

    setSaving(true);
    const { data: updated, error } = await supabase
      .from('games')
      .update({
        location: location.trim(),
        format,
        kickoff_time: kickoff.toISOString(),
        total_spots: parseInt(spots) || game.total_spots,
        entry_fee: parseFloat(fee) || 0,
        status,
        referee_pay: parseFloat(refPay) || 0,
        referees_needed: parseInt(refsNeeded) || 1,
      })
      .eq('id', game.id)
      .select();
    setSaving(false);

    if (error) { Alert.alert('Error', error.message); }
    else if (!updated?.length) { Alert.alert('Permission Denied', 'Update blocked. Add an RLS UPDATE policy for admins in Supabase.'); }
    else { Alert.alert('✅ Saved', 'Game updated.'); onSaved?.(); onClose(); }
  }

  function handleDelete() {
    Alert.alert(
      'Delete Game?',
      'This will permanently remove the game and all its registrations.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from('games').delete().eq('id', game.id);
            if (error) Alert.alert('Error', error.message);
            else { onSaved?.(); onClose(); }
          },
        },
      ]
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        {/* Header */}
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
            <Text style={styles.modalCloseText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>✏️ Edit Game</Text>
          <TouchableOpacity onPress={handleSave} style={styles.modalSaveBtn} disabled={saving}>
            {saving
              ? <ActivityIndicator color={colors.dark} size="small" />
              : <Text style={styles.modalSaveText}>Save</Text>
            }
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">

            {/* Game ID */}
            <View style={styles.gameIdBox}>
              <Text style={styles.gameIdBoxLabel}>GAME ID</Text>
              <Text selectable style={styles.gameIdBoxValue}>{game?.id}</Text>
            </View>

            <Text style={styles.formLabel}>Location / Venue</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Riverside Park, Field 3"
              placeholderTextColor={colors.gray}
              value={location}
              onChangeText={setLocation}
            />

            <Text style={styles.formLabel}>Format</Text>
            <View style={styles.chipRow}>
              {FORMATS.map(f => (
                <TouchableOpacity
                  key={f}
                  style={[styles.chip, format === f && styles.chipActive]}
                  onPress={() => setFormat(f)}
                >
                  <Text style={[styles.chipText, format === f && styles.chipTextActive]}>{f}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.formLabel}>Status</Text>
            <View style={styles.chipRow}>
              {GAME_STATUSES.map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, status === s && styles.chipActive]}
                  onPress={() => setStatus(s)}
                >
                  <Text style={[styles.chipText, status === s && styles.chipTextActive]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.formLabel}>Date <Text style={styles.formHint}>(YYYY-MM-DD)</Text></Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 2025-06-15"
              placeholderTextColor={colors.gray}
              value={date}
              onChangeText={setDate}
              keyboardType="numbers-and-punctuation"
            />

            <Text style={styles.formLabel}>Kickoff Time <Text style={styles.formHint}>(24h, HH:MM)</Text></Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 19:00"
              placeholderTextColor={colors.gray}
              value={time}
              onChangeText={setTime}
              keyboardType="numbers-and-punctuation"
            />

            <View style={styles.twoCol}>
              <View style={styles.twoColField}>
                <Text style={styles.formLabel}>Total Spots</Text>
                <TextInput
                  style={styles.input}
                  placeholder="10"
                  placeholderTextColor={colors.gray}
                  value={spots}
                  onChangeText={setSpots}
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.twoColField}>
                <Text style={styles.formLabel}>Entry Fee ($)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={colors.gray}
                  value={fee}
                  onChangeText={setFee}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <View style={styles.twoCol}>
              <View style={styles.twoColField}>
                <Text style={styles.formLabel}>Referee Pay ($)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={colors.gray}
                  value={refPay}
                  onChangeText={setRefPay}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.twoColField}>
                <Text style={styles.formLabel}>Refs Needed</Text>
                <TextInput
                  style={styles.input}
                  placeholder="1"
                  placeholderTextColor={colors.gray}
                  value={refsNeeded}
                  onChangeText={setRefsNeeded}
                  keyboardType="number-pad"
                />
              </View>
            </View>

            {/* Registered players count (read-only info) */}
            {game && (
              <View style={styles.infoBox}>
                <Text style={styles.infoBoxText}>
                  👥 {game.game_players?.length || 0} / {game.total_spots} players registered
                </Text>
              </View>
            )}

            <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
              <Text style={styles.deleteBtnText}>🗑️ Delete Game</Text>
            </TouchableOpacity>

          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Edit Cup Modal ───────────────────────────────────────────────────────────
function EditCupModal({ cup, visible, onClose, onSaved }) {
  const [name, setName]             = useState(cup?.name    || '');
  const [venue, setVenue]           = useState(cup?.venue   || '');
  const [format, setFormat]         = useState(cup?.format  || '6v6');
  const [date, setDate]             = useState(toDateStr(cup?.kickoff_date));
  const [time, setTime]             = useState(toTimeStr(cup?.kickoff_date));
  const [maxTeams, setMaxTeams]     = useState(String(cup?.max_teams  || '8'));
  const [fee, setFee]               = useState(String(cup?.entry_fee  || '0'));
  const [status, setStatus]         = useState(cup?.status  || 'upcoming');
  const [refPay, setRefPay]         = useState(String(cup?.referee_pay || '0'));
  const [refsNeeded, setRefsNeeded] = useState(String(cup?.referees_needed || '1'));
  const [saving, setSaving]         = useState(false);
  const [generating, setGenerating] = useState(false);

  React.useEffect(() => {
    if (cup) {
      setName(cup.name || '');
      setVenue(cup.venue || '');
      setFormat(cup.format || '6v6');
      setDate(toDateStr(cup.kickoff_date));
      setTime(toTimeStr(cup.kickoff_date));
      setMaxTeams(String(cup.max_teams || '8'));
      setFee(String(cup.entry_fee || '0'));
      setStatus(cup.status || 'upcoming');
      setRefPay(String(cup.referee_pay || '0'));
      setRefsNeeded(String(cup.referees_needed || '1'));
    }
  }, [cup?.id]);

  async function handleSave() {
    if (!name.trim()) { Alert.alert('Missing', 'Please enter a cup name.'); return; }
    if (!date.trim() || !time.trim()) { Alert.alert('Missing', 'Enter date and time.'); return; }
    const kickoff = new Date(`${date.trim()}T${time.trim()}:00`);
    if (isNaN(kickoff.getTime())) { Alert.alert('Invalid', 'Check date/time format.'); return; }

    setSaving(true);
    const { error } = await supabase
      .from('tournaments')
      .update({
        name: name.trim(),
        venue: venue.trim(),
        format,
        kickoff_date: kickoff.toISOString(),
        max_teams: parseInt(maxTeams) || 8,
        entry_fee: parseFloat(fee) || 0,
        status,
        referee_pay: parseFloat(refPay) || 0,
        referees_needed: parseInt(refsNeeded) || 1,
      })
      .eq('id', cup.id);
    setSaving(false);

    if (error) { Alert.alert('Error', error.message); }
    else { Alert.alert('✅ Saved', 'Cup updated.'); onSaved?.(); onClose(); }
  }

  async function generateBracket() {
    setGenerating(true);

    const { data: teams, error } = await supabase
      .from('tournament_teams')
      .select('id, name, avg_rating')
      .eq('tournament_id', cup.id)
      .order('avg_rating', { ascending: false });

    if (error) {
      Alert.alert('Error', error.message);
      setGenerating(false);
      return;
    }

    const count = teams.length;
    if (![4, 8, 16].includes(count)) {
      Alert.alert(
        'Cannot Generate',
        `Need exactly 4, 8, or 16 registered teams. Currently ${count} team${count !== 1 ? 's' : ''}.`
      );
      setGenerating(false);
      return;
    }

    const { data: existing } = await supabase
      .from('tournament_matches')
      .select('id')
      .eq('tournament_id', cup.id)
      .limit(1);

    if (existing?.length > 0) {
      Alert.alert('Already Exists', 'A bracket has already been generated for this cup.');
      setGenerating(false);
      return;
    }

    const totalRounds = Math.log2(count);
    const matchesToInsert = [];

    for (let i = 0; i < count / 2; i++) {
      matchesToInsert.push({
        tournament_id: cup.id,
        round: 1,
        match_number: i + 1,
        team_a_id: teams[i].id,
        team_b_id: teams[count - 1 - i].id,
        status: 'scheduled',
      });
    }

    for (let r = 2; r <= totalRounds; r++) {
      const matchCount = count / Math.pow(2, r);
      for (let m = 1; m <= matchCount; m++) {
        matchesToInsert.push({
          tournament_id: cup.id,
          round: r,
          match_number: m,
          status: 'scheduled',
        });
      }
    }

    const { error: insertError } = await supabase
      .from('tournament_matches')
      .insert(matchesToInsert);

    setGenerating(false);

    if (insertError) {
      Alert.alert('Error', insertError.message);
    } else {
      Alert.alert('✅ Bracket Generated', `${count}-team knockout bracket is ready!`);
      onSaved?.();
    }
  }

  function handleDelete() {
    Alert.alert(
      'Delete Cup?',
      'This will permanently remove this cup.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from('tournaments').delete().eq('id', cup.id);
            if (error) Alert.alert('Error', error.message);
            else { onSaved?.(); onClose(); }
          },
        },
      ]
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
            <Text style={styles.modalCloseText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>✏️ Edit Cup</Text>
          <TouchableOpacity onPress={handleSave} style={styles.modalSaveBtn} disabled={saving}>
            {saving
              ? <ActivityIndicator color={colors.dark} size="small" />
              : <Text style={styles.modalSaveText}>Save</Text>
            }
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">

            <Text style={styles.formLabel}>Cup Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Urban PL Summer Cup 2025"
              placeholderTextColor={colors.gray}
              value={name}
              onChangeText={setName}
            />

            <Text style={styles.formLabel}>Venue</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Central Sports Complex"
              placeholderTextColor={colors.gray}
              value={venue}
              onChangeText={setVenue}
            />

            <Text style={styles.formLabel}>Format</Text>
            <View style={styles.chipRow}>
              {FORMATS.map(f => (
                <TouchableOpacity
                  key={f}
                  style={[styles.chip, format === f && styles.chipActive]}
                  onPress={() => setFormat(f)}
                >
                  <Text style={[styles.chipText, format === f && styles.chipTextActive]}>{f}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.formLabel}>Status</Text>
            <View style={styles.chipRow}>
              {CUP_STATUSES.map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, status === s && styles.chipActive]}
                  onPress={() => setStatus(s)}
                >
                  <Text style={[styles.chipText, status === s && styles.chipTextActive]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.formLabel}>Date <Text style={styles.formHint}>(YYYY-MM-DD)</Text></Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 2025-07-20"
              placeholderTextColor={colors.gray}
              value={date}
              onChangeText={setDate}
              keyboardType="numbers-and-punctuation"
            />

            <Text style={styles.formLabel}>Start Time <Text style={styles.formHint}>(24h, HH:MM)</Text></Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 09:00"
              placeholderTextColor={colors.gray}
              value={time}
              onChangeText={setTime}
              keyboardType="numbers-and-punctuation"
            />

            <View style={styles.twoCol}>
              <View style={styles.twoColField}>
                <Text style={styles.formLabel}>Max Teams</Text>
                <TextInput
                  style={styles.input}
                  placeholder="8"
                  placeholderTextColor={colors.gray}
                  value={maxTeams}
                  onChangeText={setMaxTeams}
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.twoColField}>
                <Text style={styles.formLabel}>Entry Fee ($)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={colors.gray}
                  value={fee}
                  onChangeText={setFee}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <View style={styles.twoCol}>
              <View style={styles.twoColField}>
                <Text style={styles.formLabel}>Referee Pay ($)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={colors.gray}
                  value={refPay}
                  onChangeText={setRefPay}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.twoColField}>
                <Text style={styles.formLabel}>Refs Needed</Text>
                <TextInput
                  style={styles.input}
                  placeholder="1"
                  placeholderTextColor={colors.gray}
                  value={refsNeeded}
                  onChangeText={setRefsNeeded}
                  keyboardType="number-pad"
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.generateBracketBtn, generating && { opacity: 0.6 }]}
              onPress={generateBracket}
              disabled={generating}
            >
              {generating
                ? <ActivityIndicator color={colors.dark} size="small" />
                : <Text style={styles.generateBracketBtnText}>⚡ Generate Bracket</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
              <Text style={styles.deleteBtnText}>🗑️ Delete Cup</Text>
            </TouchableOpacity>

          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Availability Heatmap ─────────────────────────────────────────────────────
function AvailabilityHeatmap({ players }) {
  const scores = {};
  let maxScore = 1;

  DAYS.forEach(day => {
    SLOTS.forEach(slot => {
      const key = `${day}_${slot}`;
      let score = 0;
      players.forEach(p => {
        const val = p.availability?.[key];
        if (val === 'Available') score += 2;
        else if (val === 'Maybe') score += 1;
      });
      scores[key] = score;
      if (score > maxScore) maxScore = score;
    });
  });

  function getCellColor(day, slot) {
    const score = scores[`${day}_${slot}`] || 0;
    const intensity = score / maxScore;
    if (intensity === 0) return colors.darkCard;
    if (intensity < 0.33) return 'rgba(201,168,76,0.2)';
    if (intensity < 0.66) return 'rgba(201,168,76,0.55)';
    return colors.gold;
  }

  function getCellCount(day, slot) {
    const key = `${day}_${slot}`;
    let avail = 0, maybe = 0;
    players.forEach(p => {
      const val = p.availability?.[key];
      if (val === 'Available') avail++;
      else if (val === 'Maybe') maybe++;
    });
    return { avail, maybe };
  }

  const [selected, setSelected] = useState(null);
  const selData = selected ? getCellCount(selected.day, selected.slot) : null;

  const allSlots = [];
  DAYS.forEach(day => SLOTS.forEach(slot => {
    allSlots.push({ day, slot, score: scores[`${day}_${slot}`] || 0 });
  }));
  const top3 = [...allSlots].sort((a, b) => b.score - a.score).slice(0, 3);

  return (
    <View>
      <View style={styles.bestTimesRow}>
        <Text style={styles.bestTimesLabel}>🏆 Best Times</Text>
        {top3.map((s, i) => (
          <View key={i} style={styles.bestTimeChip}>
            <Text style={styles.bestTimeText}>{s.day} {s.slot}</Text>
            <Text style={styles.bestTimeCount}>{getCellCount(s.day, s.slot).avail} available</Text>
          </View>
        ))}
      </View>

      <View style={styles.heatmapCard}>
        <View style={styles.heatHeaderRow}>
          <View style={{ width: 36 }} />
          {SLOTS.map(slot => (
            <Text key={slot} style={styles.heatSlotHeader}>{slot}</Text>
          ))}
        </View>
        {DAYS.map(day => (
          <View key={day} style={styles.heatRow}>
            <Text style={styles.heatDayLabel}>{day}</Text>
            {SLOTS.map(slot => {
              const { avail } = getCellCount(day, slot);
              const isSelected = selected?.day === day && selected?.slot === slot;
              return (
                <TouchableOpacity
                  key={slot}
                  style={[
                    styles.heatCell,
                    { backgroundColor: getCellColor(day, slot) },
                    isSelected && styles.heatCellSelected,
                  ]}
                  onPress={() => setSelected(isSelected ? null : { day, slot })}
                >
                  {avail > 0 && <Text style={styles.heatCellCount}>{avail}</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}

        <View style={styles.heatLegend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.darkCard, borderColor: colors.darkBorder }]} />
            <Text style={styles.legendText}>None</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: 'rgba(201,168,76,0.2)' }]} />
            <Text style={styles.legendText}>Low</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: 'rgba(201,168,76,0.55)' }]} />
            <Text style={styles.legendText}>Medium</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.gold }]} />
            <Text style={styles.legendText}>High</Text>
          </View>
        </View>
      </View>

      {selected && (
        <View style={styles.selectionDetail}>
          <Text style={styles.selectionTitle}>
            {selected.day} · {SLOT_LABELS[selected.slot]}
          </Text>
          <Text style={styles.selectionStat}>
            ✅ {selData.avail} available · 🤔 {selData.maybe} maybe
          </Text>
          <Text style={styles.selectionHint}>
            Tap "New Game" to schedule a game at this time
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Create Game Form ─────────────────────────────────────────────────────────
function CreateGameForm({ onCreated }) {
  const [location, setLocation]         = useState('');
  const [format, setFormat]             = useState('6v6');
  const [date, setDate]                 = useState('');
  const [time, setTime]                 = useState('');
  const [spots, setSpots]               = useState('');
  const [fee, setFee]                   = useState('0');
  const [refPay, setRefPay]             = useState('0');
  const [refsNeeded, setRefsNeeded]     = useState('1');
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState('');
  const [success, setSuccess]           = useState('');

  async function handleCreate() {
    setError(''); setSuccess('');
    if (!location.trim()) { setError('Please enter a location.'); return; }
    if (!date.trim() || !time.trim()) { setError('Please enter date (YYYY-MM-DD) and time (HH:MM).'); return; }
    if (!spots || isNaN(parseInt(spots))) { setError('Please enter total spots.'); return; }

    const kickoff = new Date(`${date.trim()}T${time.trim()}:00`);
    if (isNaN(kickoff.getTime())) {
      setError('Invalid date/time. Use: Date → 2025-06-15  Time → 19:00');
      return;
    }

    setSaving(true);

    // Auto-geocode location using free Nominatim API
    let latitude = null, longitude = null;
    try {
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location.trim())}&format=json&limit=1`,
        { headers: { 'User-Agent': 'UrbanPL/1.0' } }
      );
      const geoData = await geoRes.json();
      if (geoData.length > 0) {
        latitude  = parseFloat(geoData[0].lat);
        longitude = parseFloat(geoData[0].lon);
      }
    } catch (e) {
      console.warn('Geocoding failed:', e.message);
    }

    const { error: dbError } = await supabase.from('games').insert({
      location: location.trim(),
      format,
      kickoff_time: kickoff.toISOString(),
      total_spots: parseInt(spots),
      entry_fee: parseFloat(fee) || 0,
      referee_pay: parseFloat(refPay) || 0,
      referees_needed: parseInt(refsNeeded) || 1,
      status: 'open',
      teams_balanced: false,
      latitude,
      longitude,
    });
    setSaving(false);

    if (dbError) {
      console.error('Create game error:', dbError);
      setError(dbError.message);
    } else {
      setSuccess(`✅ Game created! ${format} at ${location.trim()} on ${kickoff.toLocaleDateString()}`);
      setLocation(''); setDate(''); setTime(''); setSpots(''); setFee('0');
      setRefPay('0'); setRefsNeeded('1');
      onCreated?.();
    }
  }

  return (
    <View style={styles.formCard}>
      <Text style={styles.formTitle}>⚽ Create New Game</Text>

      <Text style={styles.formLabel}>Location / Venue</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Riverside Park, Field 3"
        placeholderTextColor={colors.gray}
        value={location}
        onChangeText={setLocation}
      />

      <Text style={styles.formLabel}>Format</Text>
      <View style={styles.chipRow}>
        {FORMATS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.chip, format === f && styles.chipActive]}
            onPress={() => setFormat(f)}
          >
            <Text style={[styles.chipText, format === f && styles.chipTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.formLabel}>Date <Text style={styles.formHint}>(YYYY-MM-DD)</Text></Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 2025-06-15"
        placeholderTextColor={colors.gray}
        value={date}
        onChangeText={setDate}
        keyboardType="numbers-and-punctuation"
      />

      <Text style={styles.formLabel}>Kickoff Time <Text style={styles.formHint}>(24h, HH:MM)</Text></Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 19:00"
        placeholderTextColor={colors.gray}
        value={time}
        onChangeText={setTime}
        keyboardType="numbers-and-punctuation"
      />

      <View style={styles.twoCol}>
        <View style={styles.twoColField}>
          <Text style={styles.formLabel}>Total Spots</Text>
          <TextInput
            style={styles.input}
            placeholder="10"
            placeholderTextColor={colors.gray}
            value={spots}
            onChangeText={setSpots}
            keyboardType="number-pad"
          />
        </View>
        <View style={styles.twoColField}>
          <Text style={styles.formLabel}>Entry Fee ($)</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor={colors.gray}
            value={fee}
            onChangeText={setFee}
            keyboardType="decimal-pad"
          />
        </View>
      </View>

      <View style={styles.twoCol}>
        <View style={styles.twoColField}>
          <Text style={styles.formLabel}>Referee Pay ($)</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor={colors.gray}
            value={refPay}
            onChangeText={setRefPay}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={styles.twoColField}>
          <Text style={styles.formLabel}>Refs Needed</Text>
          <TextInput
            style={styles.input}
            placeholder="1"
            placeholderTextColor={colors.gray}
            value={refsNeeded}
            onChangeText={setRefsNeeded}
            keyboardType="number-pad"
          />
        </View>
      </View>

      {error ? <Text style={styles.formError}>⚠️ {error}</Text> : null}
      {success ? <Text style={styles.formSuccess}>{success}</Text> : null}

      <TouchableOpacity
        style={[styles.createBtn, saving && { opacity: 0.6 }]}
        onPress={handleCreate}
        disabled={saving}
      >
        {saving
          ? <ActivityIndicator color={colors.dark} />
          : <Text style={styles.createBtnText}>Create Game</Text>
        }
      </TouchableOpacity>
    </View>
  );
}

// ─── Create Cup Form ──────────────────────────────────────────────────────────
function CreateCupForm({ onCreated }) {
  const [name, setName]             = useState('');
  const [venue, setVenue]           = useState('');
  const [format, setFormat]         = useState('6v6');
  const [date, setDate]             = useState('');
  const [time, setTime]             = useState('');
  const [maxTeams, setMaxTeams]     = useState('');
  const [fee, setFee]               = useState('0');
  const [refPay, setRefPay]         = useState('0');
  const [refsNeeded, setRefsNeeded] = useState('1');
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [success, setSuccess]       = useState('');

  async function handleCreate() {
    setError(''); setSuccess('');
    if (!name.trim()) { setError('Please enter a cup name.'); return; }
    if (!venue.trim()) { setError('Please enter a venue.'); return; }
    if (!date.trim() || !time.trim()) { setError('Please enter date (YYYY-MM-DD) and time (HH:MM).'); return; }

    const kickoff = new Date(`${date.trim()}T${time.trim()}:00`);
    if (isNaN(kickoff.getTime())) {
      setError('Invalid date/time. Use: Date → 2025-07-20  Time → 10:00');
      return;
    }

    setSaving(true);
    const { error: dbError } = await supabase.from('tournaments').insert({
      name: name.trim(),
      venue: venue.trim(),
      format,
      kickoff_date: kickoff.toISOString(),
      max_teams: parseInt(maxTeams) || 8,
      entry_fee: parseFloat(fee) || 0,
      referee_pay: parseFloat(refPay) || 0,
      referees_needed: parseInt(refsNeeded) || 1,
      status: 'upcoming',
    });
    setSaving(false);

    if (dbError) {
      console.error('Create cup error:', dbError);
      setError(dbError.message);
    } else {
      setSuccess(`✅ Cup created! ${name.trim()} on ${kickoff.toLocaleDateString()}`);
      setName(''); setVenue(''); setDate(''); setTime(''); setMaxTeams(''); setFee('0');
      setRefPay('0'); setRefsNeeded('1');
      onCreated?.();
    }
  }

  return (
    <View style={styles.formCard}>
      <Text style={styles.formTitle}>🏆 Create New Cup</Text>

      <Text style={styles.formLabel}>Cup Name</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Urban PL Summer Cup 2025"
        placeholderTextColor={colors.gray}
        value={name}
        onChangeText={setName}
      />

      <Text style={styles.formLabel}>Venue</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Central Sports Complex"
        placeholderTextColor={colors.gray}
        value={venue}
        onChangeText={setVenue}
      />

      <Text style={styles.formLabel}>Format</Text>
      <View style={styles.chipRow}>
        {FORMATS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.chip, format === f && styles.chipActive]}
            onPress={() => setFormat(f)}
          >
            <Text style={[styles.chipText, format === f && styles.chipTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.formLabel}>Date <Text style={styles.formHint}>(YYYY-MM-DD)</Text></Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 2025-07-20"
        placeholderTextColor={colors.gray}
        value={date}
        onChangeText={setDate}
        keyboardType="numbers-and-punctuation"
      />

      <Text style={styles.formLabel}>Start Time <Text style={styles.formHint}>(24h, HH:MM)</Text></Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 09:00"
        placeholderTextColor={colors.gray}
        value={time}
        onChangeText={setTime}
        keyboardType="numbers-and-punctuation"
      />

      <View style={styles.twoCol}>
        <View style={styles.twoColField}>
          <Text style={styles.formLabel}>Max Teams</Text>
          <TextInput
            style={styles.input}
            placeholder="8"
            placeholderTextColor={colors.gray}
            value={maxTeams}
            onChangeText={setMaxTeams}
            keyboardType="number-pad"
          />
        </View>
        <View style={styles.twoColField}>
          <Text style={styles.formLabel}>Entry Fee ($)</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor={colors.gray}
            value={fee}
            onChangeText={setFee}
            keyboardType="decimal-pad"
          />
        </View>
      </View>

      <View style={styles.twoCol}>
        <View style={styles.twoColField}>
          <Text style={styles.formLabel}>Referee Pay ($)</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor={colors.gray}
            value={refPay}
            onChangeText={setRefPay}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={styles.twoColField}>
          <Text style={styles.formLabel}>Refs Needed</Text>
          <TextInput
            style={styles.input}
            placeholder="1"
            placeholderTextColor={colors.gray}
            value={refsNeeded}
            onChangeText={setRefsNeeded}
            keyboardType="number-pad"
          />
        </View>
      </View>

      {error ? <Text style={styles.formError}>⚠️ {error}</Text> : null}
      {success ? <Text style={styles.formSuccess}>{success}</Text> : null}

      <TouchableOpacity
        style={[styles.createBtn, saving && { opacity: 0.6 }]}
        onPress={handleCreate}
        disabled={saving}
      >
        {saving
          ? <ActivityIndicator color={colors.dark} />
          : <Text style={styles.createBtnText}>Create Cup</Text>
        }
      </TouchableOpacity>
    </View>
  );
}

// ─── Match Reports Panel ──────────────────────────────────────────────────────
function MatchReportsPanel() {
  const [expanded, setExpanded] = useState(null);

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['matchReports'],
    queryFn: fetchMatchReports,
  });

  function pName(p) {
    return [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.name || 'Unknown';
  }
  function shortName(p) {
    const fn = p?.first_name || '';
    const ln = p?.last_name || '';
    return ln ? `${fn} ${ln[0]}.` : (p?.name || 'Unknown');
  }
  function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  if (isLoading) return <ActivityIndicator color={colors.gold} size="large" style={{ marginTop: 60 }} />;
  if (reports.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 36, marginBottom: 12 }}>📋</Text>
        <Text style={styles.emptyText}>No completed matches yet</Text>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.mrHeading}>Match Reports</Text>
      <Text style={styles.mrSubheading}>{reports.length} completed game{reports.length !== 1 ? 's' : ''}</Text>

      {reports.map(g => {
        const isOpen = expanded === g.id;
        const acceptedRef = g.game_referees?.find(r => r.status === 'accepted');
        const refName = acceptedRef ? pName(acceptedRef.players) : null;
        const sA = g.score_a ?? '–', sB = g.score_b ?? '–';
        const hasNotes = !!g.referee_notes?.trim();

        // Merge team from game_players as fallback if stats.team is null
        const teamMap = {};
        (g.game_players || []).forEach(gp => { teamMap[gp.player_id] = gp.team; });
        const stats = (g.game_player_stats || []).map(s => ({
          ...s, team: s.team || teamMap[s.players?.id] || null,
        }));

        const darkStats  = stats.filter(s => s.team === 'A');
        const whiteStats = stats.filter(s => s.team === 'B');
        const scorers    = stats.filter(s => (s.goals || 0) > 0)
          .sort((a, b) => b.goals - a.goals);

        // Result label
        const darkWon  = (g.score_a ?? 0) > (g.score_b ?? 0);
        const whiteWon = (g.score_b ?? 0) > (g.score_a ?? 0);
        const draw     = !darkWon && !whiteWon && g.score_a != null;
        const resultLabel = darkWon ? '🖤 Dark Win' : whiteWon ? '🤍 White Win' : draw ? 'Draw' : '';
        const resultColor = darkWon ? colors.white : whiteWon ? '#ddd' : colors.gold;

        return (
          <TouchableOpacity
            key={g.id}
            style={styles.mrCard}
            onPress={() => setExpanded(isOpen ? null : g.id)}
            activeOpacity={0.8}
          >
            {/* ── Header ── */}
            <View style={styles.mrCardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.mrVenue} numberOfLines={1}>{g.location?.split(',')[0]}</Text>
                <Text style={styles.mrMeta}>{g.format} · {formatDate(g.completed_at || g.kickoff_time)}</Text>
              </View>
              {resultLabel ? <Text style={[styles.mrResultLabel, { color: resultColor }]}>{resultLabel}</Text> : null}
              <Text style={styles.mrChevron}>{isOpen ? '▲' : '▼'}</Text>
            </View>

            {/* ── Score ── */}
            <View style={styles.mrScoreRow}>
              <View style={styles.mrScoreBox}>
                <Text style={styles.mrScoreTeam}>🖤 Dark</Text>
                <Text style={[styles.mrScoreNum, darkWon && { color: colors.gold }]}>{sA}</Text>
              </View>
              <Text style={styles.mrScoreDash}>—</Text>
              <View style={styles.mrScoreBox}>
                <Text style={[styles.mrScoreNum, whiteWon && { color: colors.gold }]}>{sB}</Text>
                <Text style={styles.mrScoreTeam}>White 🤍</Text>
              </View>
            </View>

            {/* ── Referee + notes badge ── */}
            <View style={styles.mrRefRow}>
              <Text style={styles.mrRefLabel}>🟨 Referee: </Text>
              <Text style={styles.mrRefName}>{refName || 'Unassigned'}</Text>
              {hasNotes && <Text style={styles.mrNotesBadge}>📋 Notes</Text>}
            </View>

            {/* ── Expanded detail ── */}
            {isOpen && (
              <View style={styles.mrDetail}>

                {/* Teams side-by-side */}
                <View style={styles.mrTeamsRow}>
                  {/* Dark */}
                  <View style={styles.mrTeamCol}>
                    <Text style={styles.mrTeamHeader}>🖤 Dark</Text>
                    {darkStats.length === 0
                      ? <Text style={styles.mrNoStats}>No data</Text>
                      : darkStats.map((s, i) => (
                        <View key={i} style={styles.mrPlayerLine}>
                          <Text style={styles.mrPlayerName} numberOfLines={1}>{shortName(s.players)}</Text>
                          <View style={styles.mrPlayerIcons}>
                            {(s.goals || 0) > 0 && <Text style={styles.mrIcon}>⚽{s.goals}</Text>}
                            {(s.yellow_cards || 0) > 0 && <Text style={styles.mrIcon}>🟡</Text>}
                            {(s.red_cards || 0) > 0 && <Text style={styles.mrIcon}>🔴</Text>}
                            {s.is_goalkeeper && <Text style={styles.mrGKBadge}>GK</Text>}
                          </View>
                        </View>
                      ))
                    }
                  </View>

                  <View style={styles.mrTeamDivider} />

                  {/* White */}
                  <View style={[styles.mrTeamCol, { alignItems: 'flex-end' }]}>
                    <Text style={[styles.mrTeamHeader, { textAlign: 'right' }]}>White 🤍</Text>
                    {whiteStats.length === 0
                      ? <Text style={[styles.mrNoStats, { textAlign: 'right' }]}>No data</Text>
                      : whiteStats.map((s, i) => (
                        <View key={i} style={[styles.mrPlayerLine, { flexDirection: 'row-reverse' }]}>
                          <Text style={[styles.mrPlayerName, { textAlign: 'right' }]} numberOfLines={1}>{shortName(s.players)}</Text>
                          <View style={[styles.mrPlayerIcons, { marginRight: 4, marginLeft: 0 }]}>
                            {(s.goals || 0) > 0 && <Text style={styles.mrIcon}>⚽{s.goals}</Text>}
                            {(s.yellow_cards || 0) > 0 && <Text style={styles.mrIcon}>🟡</Text>}
                            {(s.red_cards || 0) > 0 && <Text style={styles.mrIcon}>🔴</Text>}
                            {s.is_goalkeeper && <Text style={styles.mrGKBadge}>GK</Text>}
                          </View>
                        </View>
                      ))
                    }
                  </View>
                </View>

                {/* Goal scorers */}
                {scorers.length > 0 && (
                  <View style={styles.mrScorerBox}>
                    <Text style={styles.mrDetailTitle}>⚽ Goal Scorers</Text>
                    {scorers.map((s, i) => (
                      <View key={i} style={styles.mrScorerRow}>
                        <Text style={[styles.mrScorerTeamDot,
                          { color: s.team === 'A' ? colors.white : colors.gray }]}>●</Text>
                        <Text style={styles.mrScorerName}>{pName(s.players)}</Text>
                        <Text style={styles.mrScorerGoals}>
                          {s.goals} goal{s.goals !== 1 ? 's' : ''}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Points awarded */}
                {stats.length > 0 && (
                  <View style={styles.mrPointsBox}>
                    <Text style={styles.mrDetailTitle}>🏅 Points Awarded</Text>
                    {/* Table header */}
                    <View style={styles.mrPointsHeader}>
                      <Text style={[styles.mrPointsCell, { flex: 2 }]}>Player</Text>
                      <Text style={styles.mrPointsCell}>Win</Text>
                      <Text style={styles.mrPointsCell}>Goals</Text>
                      <Text style={styles.mrPointsCell}>GK</Text>
                      <Text style={styles.mrPointsCell}>Cards</Text>
                      <Text style={[styles.mrPointsCell, { color: colors.gold }]}>Total</Text>
                    </View>
                    {stats.map((s, i) => {
                      const winPts   = s.won ? 3 : 0;
                      const goalPts  = s.goals || 0;
                      const gkPts    = s.is_goalkeeper
                        ? ((s.goals_conceded || 0) === 0 ? 3 : (s.goals_conceded || 0) < 2 ? 1 : 0)
                        : 0;
                      const cardPts  = -((s.yellow_cards || 0) + (s.red_cards || 0) * 3);
                      const total    = Math.max(0, winPts + goalPts + gkPts + cardPts);
                      return (
                        <View key={i} style={[styles.mrPointsRow, i % 2 === 0 && styles.mrPointsRowAlt]}>
                          <Text style={[styles.mrPointsCell, { flex: 2 }]} numberOfLines={1}>
                            {shortName(s.players)}
                          </Text>
                          <Text style={styles.mrPointsCell}>{winPts > 0 ? `+${winPts}` : '–'}</Text>
                          <Text style={styles.mrPointsCell}>{goalPts > 0 ? `+${goalPts}` : '–'}</Text>
                          <Text style={styles.mrPointsCell}>{gkPts > 0 ? `+${gkPts}` : '–'}</Text>
                          <Text style={styles.mrPointsCell}>{cardPts < 0 ? cardPts : '–'}</Text>
                          <Text style={[styles.mrPointsCell, { color: colors.gold, fontWeight: '800' }]}>
                            {total}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Referee notes */}
                {hasNotes && (
                  <View style={styles.mrNotesBox}>
                    <Text style={styles.mrNotesTitle}>📋 Referee Notes</Text>
                    <Text style={styles.mrNotesText}>{g.referee_notes}</Text>
                  </View>
                )}

                <Text selectable style={styles.mrGameId}>ID: {g.id}</Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ games, cups, onEditGame, onEditCup }) {
  const openGames   = games?.filter(g => g.status === 'open').length || 0;
  const totalSignups = games?.reduce((acc, g) => acc + (g.game_players?.length || 0), 0) || 0;
  const activeCups  = cups?.filter(c => c.status === 'upcoming' || c.status === 'active').length || 0;

  return (
    <View>
      {/* Stats */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statCardValue}>{openGames}</Text>
          <Text style={styles.statCardLabel}>Open Games</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statCardValue}>{totalSignups}</Text>
          <Text style={styles.statCardLabel}>Sign-ups</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statCardValue}>{activeCups}</Text>
          <Text style={styles.statCardLabel}>Active Cups</Text>
        </View>
      </View>

      {/* Games list */}
      <Text style={styles.dashSectionTitle}>Games  <Text style={styles.dashHint}>tap to edit</Text></Text>
      {(!games || games.length === 0) && (
        <Text style={styles.emptyText}>No games yet</Text>
      )}
      {games?.map(g => {
        const acceptedRef = g.game_referees?.find(r => r.status === 'accepted');
        const refName = acceptedRef?.players
          ? ([acceptedRef.players.first_name, acceptedRef.players.last_name].filter(Boolean).join(' ') || acceptedRef.players.name)
          : null;
        return (
          <TouchableOpacity key={g.id} style={styles.dashRow} onPress={() => onEditGame(g)} activeOpacity={0.7}>
            <View style={{ flex: 1 }}>
              <View style={styles.dashRowTitleRow}>
                <Text style={styles.dashRowTitle} numberOfLines={1}>{g.location?.split(',')[0]}</Text>
                <TouchableOpacity
                  style={styles.gameIdChip}
                  onPress={e => { e.stopPropagation?.(); Alert.alert('Game ID', g.id, [{ text: 'OK' }]); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.gameIdChipText}>#{g.id.slice(0, 8)}</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.dashRowMeta}>
                {g.format} · {new Date(g.kickoff_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </Text>
              <View style={[styles.refPill, refName ? styles.refPillConfirmed : styles.refPillMissing]}>
                <Text style={[styles.refPillText, { color: refName ? colors.success : '#ff6b6b' }]}>
                  {refName ? `🟢 ${refName}` : '🔴 No referee'}
                </Text>
              </View>
            </View>
            <View style={[styles.statusBadge, { borderColor: statusColor(g.status) }]}>
              <Text style={[styles.statusText, { color: statusColor(g.status) }]}>{g.status}</Text>
            </View>
            <Text style={styles.dashCount}>{g.game_players?.length || 0}/{g.total_spots}</Text>
            <Text style={styles.editIcon}>›</Text>
          </TouchableOpacity>
        );
      })}

      {/* Cups list */}
      <Text style={[styles.dashSectionTitle, { marginTop: spacing.lg }]}>Cups  <Text style={styles.dashHint}>tap to edit</Text></Text>
      {(!cups || cups.length === 0) && (
        <Text style={styles.emptyText}>No cups yet</Text>
      )}
      {cups?.map(c => (
        <TouchableOpacity key={c.id} style={styles.dashRow} onPress={() => onEditCup(c)} activeOpacity={0.7}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dashRowTitle} numberOfLines={1}>{c.name}</Text>
            <Text style={styles.dashRowMeta}>
              {c.format} · {new Date(c.kickoff_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </Text>
          </View>
          <View style={[styles.statusBadge, { borderColor: statusColor(c.status) }]}>
            <Text style={[styles.statusText, { color: statusColor(c.status) }]}>{c.status}</Text>
          </View>
          <Text style={styles.editIcon}>›</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Payments Panel ───────────────────────────────────────────────────────────
function PaymentsPanel() {
  const [tab, setTab] = useState('income');
  const queryClient = useQueryClient();

  const { data: payments = [], isLoading: loadingPayments } = useQuery({
    queryKey: ['adminPayments'],
    queryFn: fetchPayments,
  });

  const { data: refPayouts = [], isLoading: loadingPayouts, refetch: refetchPayouts } = useQuery({
    queryKey: ['adminRefPayouts'],
    queryFn: fetchRefereePayouts,
  });

  const totalIncome = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const totalOwed   = refPayouts.filter(r => !r.paid).reduce((sum, r) => sum + (r.games?.referee_pay || 0), 0);
  const totalPaid   = refPayouts.filter(r => r.paid).reduce((sum, r) => sum + (r.games?.referee_pay || 0), 0);

  async function markPaid(payout) {
    await supabase
      .from('referee_payouts')
      .upsert({
        referee_id: payout.referee_id,
        game_id: payout.game_id,
        amount: payout.games?.referee_pay || 0,
        paid: true,
        paid_at: new Date().toISOString(),
      }, { onConflict: 'referee_id,game_id' });
    queryClient.invalidateQueries(['adminRefPayouts']);
  }

  function playerName(p) {
    return [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.name || 'Unknown';
  }

  return (
    <View>
      {/* Summary cards */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statCardValue}>${totalIncome.toFixed(2)}</Text>
          <Text style={styles.statCardLabel}>Total Collected</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statCardValue, { color: '#ff6b6b' }]}>${totalOwed.toFixed(2)}</Text>
          <Text style={styles.statCardLabel}>Owed to Refs</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statCardValue, { color: colors.success }]}>${totalPaid.toFixed(2)}</Text>
          <Text style={styles.statCardLabel}>Refs Paid Out</Text>
        </View>
      </View>

      {/* Tab toggle */}
      <View style={styles.payTabRow}>
        <TouchableOpacity
          style={[styles.payTab, tab === 'income' && styles.payTabActive]}
          onPress={() => setTab('income')}
        >
          <Text style={[styles.payTabText, tab === 'income' && styles.payTabTextActive]}>
            💳 Income ({payments.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.payTab, tab === 'payouts' && styles.payTabActive]}
          onPress={() => setTab('payouts')}
        >
          <Text style={[styles.payTabText, tab === 'payouts' && styles.payTabTextActive]}>
            🟨 Ref Payouts ({refPayouts.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Income list */}
      {tab === 'income' && (
        loadingPayments
          ? <ActivityIndicator color={colors.gold} style={{ marginTop: 40 }} />
          : payments.length === 0
            ? <Text style={styles.emptyText}>No payments yet</Text>
            : payments.map(p => (
                <View key={p.id} style={styles.payRow}>
                  <View style={styles.payRowLeft}>
                    <Text style={styles.payRowName} numberOfLines={1}>
                      {playerName(p.players)}
                    </Text>
                    <Text style={styles.payRowMeta} numberOfLines={1}>
                      {p.games?.location?.split(',')[0]} · {p.games?.format}
                    </Text>
                    <Text style={styles.payRowDate}>
                      {new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                  <View style={styles.payAmountBadge}>
                    <Text style={styles.payAmount}>+${Number(p.amount).toFixed(2)}</Text>
                    <Text style={styles.payStatus}>{p.status}</Text>
                  </View>
                </View>
              ))
      )}

      {/* Referee payouts list */}
      {tab === 'payouts' && (
        loadingPayouts
          ? <ActivityIndicator color={colors.gold} style={{ marginTop: 40 }} />
          : refPayouts.length === 0
            ? <Text style={styles.emptyText}>No completed games with referees yet</Text>
            : refPayouts.map((r, i) => {
                const isPaid = r.paid;
                const amount = r.games?.referee_pay || 0;
                return (
                  <View key={i} style={styles.payRow}>
                    <View style={styles.payRowLeft}>
                      <Text style={styles.payRowName} numberOfLines={1}>
                        {playerName(r.players)}
                      </Text>
                      <Text style={styles.payRowMeta} numberOfLines={1}>
                        {r.games?.location?.split(',')[0]} · {r.games?.format}
                      </Text>
                      <Text style={styles.payRowDate}>
                        {r.games?.kickoff_time
                          ? new Date(r.games.kickoff_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : ''}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      <Text style={[styles.payAmount, { color: isPaid ? colors.success : '#ff6b6b' }]}>
                        ${amount.toFixed(2)}
                      </Text>
                      <TouchableOpacity onPress={() => viewRefereeId(r.players?.referee_id_url)}>
                        <Text style={styles.viewIdBtn}>🪪 View ID</Text>
                      </TouchableOpacity>
                      {isPaid
                        ? <View style={styles.paidBadge}>
                            <Text style={styles.paidBadgeText}>✓ Paid</Text>
                          </View>
                        : <TouchableOpacity style={styles.markPaidBtn} onPress={() => markPaid(r)}>
                            <Text style={styles.markPaidBtnText}>Mark Paid</Text>
                          </TouchableOpacity>
                      }
                    </View>
                  </View>
                );
              })
      )}
    </View>
  );
}

// ─── Referees Panel ───────────────────────────────────────────────────────────
function RefereesPanel() {
  const queryClient = useQueryClient();
  const { data: referees = [], isLoading } = useQuery({
    queryKey: ['adminReferees'],
    queryFn: fetchReferees,
  });

  const pending  = referees.filter(r => !r.referee_approved);
  const approved = referees.filter(r => r.referee_approved);

  async function approveReferee(ref) {
    const { error } = await supabase
      .from('players')
      .update({ referee_approved: true })
      .eq('id', ref.id);
    if (error) { Alert.alert('Error', error.message); return; }
    queryClient.invalidateQueries(['adminReferees']);
    Alert.alert('✅ Approved', `${ref.first_name} ${ref.last_name} can now accept games.`);
  }

  async function rejectReferee(ref) {
    Alert.alert(
      'Reject Referee',
      `Remove ${ref.first_name} ${ref.last_name}'s referee account? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            await supabase.from('players').delete().eq('id', ref.id);
            queryClient.invalidateQueries(['adminReferees']);
          },
        },
      ]
    );
  }

  function refName(r) {
    return [r.first_name, r.last_name].filter(Boolean).join(' ') || r.name || 'Unknown';
  }

  if (isLoading) return <ActivityIndicator color={colors.gold} style={{ marginTop: 40 }} />;

  return (
    <View>
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={[styles.statCardValue, { color: '#ff6b6b' }]}>{pending.length}</Text>
          <Text style={styles.statCardLabel}>Pending Review</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statCardValue, { color: colors.success }]}>{approved.length}</Text>
          <Text style={styles.statCardLabel}>Approved</Text>
        </View>
      </View>

      {/* Pending referees */}
      {pending.length > 0 && (
        <>
          <Text style={styles.dashSectionTitle}>⏳ Pending Approval</Text>
          {pending.map(r => (
            <View key={r.id} style={[styles.dashRow, { flexDirection: 'column', alignItems: 'stretch', gap: spacing.sm }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dashRowTitle}>{refName(r)}</Text>
                  <Text style={styles.dashRowMeta}>{r.email}</Text>
                  <Text style={styles.dashRowMeta}>
                    {r.referee_cert} · {r.referee_experience} · {(r.referee_formats || []).join(', ')}
                  </Text>
                </View>
              </View>
              {/* View buttons */}
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TouchableOpacity
                  style={styles.refViewBtn}
                  onPress={() => viewRefereeId(r.referee_selfie_url)}
                >
                  <Text style={styles.refViewBtnText}>🤳 View Selfie</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.refViewBtn}
                  onPress={() => viewRefereeId(r.referee_id_url)}
                >
                  <Text style={styles.refViewBtnText}>🪪 View ID</Text>
                </TouchableOpacity>
              </View>
              {/* Approve / Reject */}
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TouchableOpacity
                  style={[styles.refActionBtn, { backgroundColor: colors.success }]}
                  onPress={() => approveReferee(r)}
                >
                  <Text style={styles.refActionBtnText}>✅ Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.refActionBtn, { backgroundColor: '#ff6b6b' }]}
                  onPress={() => rejectReferee(r)}
                >
                  <Text style={styles.refActionBtnText}>❌ Reject</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </>
      )}

      {/* Approved referees */}
      {approved.length > 0 && (
        <>
          <Text style={[styles.dashSectionTitle, { marginTop: spacing.lg }]}>✅ Approved Referees</Text>
          {approved.map(r => (
            <View key={r.id} style={styles.dashRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.dashRowTitle}>{refName(r)}</Text>
                <Text style={styles.dashRowMeta}>{r.referee_cert} · {r.referee_experience}</Text>
              </View>
              <TouchableOpacity onPress={() => viewRefereeId(r.referee_selfie_url)}>
                <Text style={styles.viewIdBtn}>🤳 Selfie</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.gray, marginHorizontal: spacing.xs }}>|</Text>
              <TouchableOpacity onPress={() => viewRefereeId(r.referee_id_url)}>
                <Text style={styles.viewIdBtn}>🪪 ID</Text>
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}

      {referees.length === 0 && (
        <Text style={styles.emptyText}>No referees have signed up yet</Text>
      )}
    </View>
  );
}

// ─── Main Admin Screen ────────────────────────────────────────────────────────
export default function AdminScreen() {
  const { player } = useAuth();
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState('Dashboard');

  // Edit modals
  const [editingGame, setEditingGame] = useState(null);
  const [editingCup,  setEditingCup]  = useState(null);

  const { data: availabilities, isLoading: loadingAvail } = useQuery({
    queryKey: ['adminAvailabilities'],
    queryFn: fetchAvailabilities,
    enabled: activeSection === 'Availability',
  });

  const { data: games } = useQuery({
    queryKey: ['adminGames'],
    queryFn: fetchRecentGames,
  });

  const { data: cups } = useQuery({
    queryKey: ['adminCups'],
    queryFn: fetchRecentCups,
  });

  function invalidateAll() {
    queryClient.invalidateQueries(['adminGames']);
    queryClient.invalidateQueries(['adminCups']);
    queryClient.invalidateQueries(['games']);
  }

  if (!player?.is_admin) {
    return (
      <View style={styles.center}>
        <Text style={styles.lockIcon}>🔒</Text>
        <Text style={styles.lockText}>Admin Access Only</Text>
        <Text style={styles.lockSub}>Contact your administrator for access.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Section tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabBarContent}
      >
        {SECTIONS.map(s => (
          <TouchableOpacity
            key={s}
            style={[styles.tabBtn, activeSection === s && styles.tabBtnActive]}
            onPress={() => setActiveSection(s)}
          >
            <Text style={[styles.tabBtnText, activeSection === s && styles.tabBtnTextActive]}>
              {s === 'Dashboard'    ? '📊 Dashboard'
                : s === 'Reports'      ? '📋 Reports'
                : s === 'Availability' ? '📅 Availability'
                : s === 'New Game'     ? '⚽ New Game'
                : s === 'New Cup'      ? '🏆 New Cup'
                : s === 'Payments'     ? '💳 Payments'
                : '🟨 Referees'}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          {activeSection === 'Dashboard' && (
            <Dashboard
              games={games}
              cups={cups}
              onEditGame={setEditingGame}
              onEditCup={setEditingCup}
            />
          )}

          {activeSection === 'Reports' && (
            <MatchReportsPanel />
          )}

          {activeSection === 'Availability' && (
            loadingAvail
              ? <ActivityIndicator color={colors.gold} size="large" style={{ marginTop: 60 }} />
              : availabilities?.length === 0
                ? <View style={styles.center}><Text style={styles.emptyText}>No players yet</Text></View>
                : <>
                    <Text style={styles.sectionDesc}>
                      Tap any cell to see how many players are available. Brighter = more players free.
                    </Text>
                    <Text style={styles.playerCount}>
                      Based on {availabilities.length} player{availabilities.length !== 1 ? 's' : ''}
                    </Text>
                    <AvailabilityHeatmap players={availabilities} />
                  </>
          )}

          {activeSection === 'New Game' && (
            <CreateGameForm onCreated={invalidateAll} />
          )}

          {activeSection === 'New Cup' && (
            <CreateCupForm onCreated={invalidateAll} />
          )}

          {activeSection === 'Payments' && (
            <PaymentsPanel />
          )}

          {activeSection === 'Referees' && (
            <RefereesPanel />
          )}

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Edit Game Modal */}
      {editingGame && (
        <EditGameModal
          game={editingGame}
          visible={!!editingGame}
          onClose={() => setEditingGame(null)}
          onSaved={invalidateAll}
        />
      )}

      {/* Edit Cup Modal */}
      {editingCup && (
        <EditCupModal
          cup={editingCup}
          visible={!!editingCup}
          onClose={() => setEditingCup(null)}
          onSaved={invalidateAll}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.dark },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  lockIcon: { fontSize: 48, marginBottom: spacing.md },
  lockText: { color: colors.white, fontSize: 20, fontWeight: 'bold', marginBottom: spacing.xs },
  lockSub: { color: colors.gray, fontSize: 14, textAlign: 'center' },

  // Tab bar
  tabBar: { maxHeight: 52, borderBottomWidth: 1, borderBottomColor: colors.darkBorder },
  tabBarContent: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  tabBtn: {
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
    borderRadius: radius.full, borderWidth: 1,
    borderColor: colors.darkBorder, backgroundColor: colors.darkCard,
  },
  tabBtnActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  tabBtnText: { color: colors.gray, fontSize: 13 },
  tabBtnTextActive: { color: colors.dark, fontWeight: 'bold' },

  content: { padding: spacing.md, paddingBottom: 80 },
  sectionDesc: { color: colors.gray, fontSize: 13, marginBottom: spacing.xs },
  playerCount: { color: colors.gold, fontSize: 12, fontWeight: 'bold', marginBottom: spacing.md },

  // Dashboard
  statsGrid: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  statCard: {
    flex: 1, backgroundColor: colors.darkCard,
    borderRadius: radius.md, padding: spacing.md,
    alignItems: 'center', borderWidth: 1, borderColor: colors.darkBorder,
  },
  statCardValue: { color: colors.gold, fontSize: 28, fontWeight: 'bold' },
  statCardLabel: { color: colors.gray, fontSize: 11, marginTop: 4, textAlign: 'center' },
  dashSectionTitle: {
    color: colors.grayLight, fontSize: 12, fontWeight: 'bold',
    letterSpacing: 1, textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  dashHint: { color: colors.gray, fontWeight: 'normal', textTransform: 'none', letterSpacing: 0, fontSize: 11 },
  dashRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.darkCard,
    borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.sm, gap: spacing.sm,
    borderWidth: 1, borderColor: colors.darkBorder,
  },
  dashRowTitle: { color: colors.white, fontSize: 14, fontWeight: '600' },
  dashRowMeta: { color: colors.gray, fontSize: 12, marginTop: 2 },
  dashCount: { color: colors.gold, fontSize: 13, fontWeight: 'bold' },
  editIcon: { color: colors.gray, fontSize: 22, marginLeft: 2 },
  statusBadge: { borderRadius: radius.sm, borderWidth: 1, paddingVertical: 2, paddingHorizontal: spacing.sm },
  statusText: { fontSize: 11, fontWeight: 'bold' },
  refPill: { alignSelf: 'flex-start', marginTop: 4, borderRadius: radius.sm, paddingVertical: 2, paddingHorizontal: spacing.xs },
  refPillConfirmed: { backgroundColor: 'rgba(0,200,100,0.1)' },
  refPillMissing: { backgroundColor: 'rgba(255,107,107,0.1)' },
  refPillText: { fontSize: 11, fontWeight: '600' },
  viewIdBtn: { color: colors.gold, fontSize: 12, fontWeight: '600' },
  refViewBtn: {
    flex: 1, backgroundColor: colors.darkCard, borderRadius: radius.sm,
    paddingVertical: spacing.xs, alignItems: 'center',
    borderWidth: 1, borderColor: colors.darkBorder,
  },
  refViewBtnText: { color: colors.gold, fontSize: 12, fontWeight: '600' },
  refActionBtn: {
    flex: 1, borderRadius: radius.sm,
    paddingVertical: spacing.sm, alignItems: 'center',
  },
  refActionBtnText: { color: colors.dark, fontSize: 13, fontWeight: 'bold' },
  emptyText: { color: colors.gray, fontSize: 14, marginBottom: spacing.md },

  // Heatmap
  bestTimesRow: { marginBottom: spacing.md },
  bestTimesLabel: { color: colors.gold, fontWeight: 'bold', fontSize: 13, marginBottom: spacing.sm },
  bestTimeChip: {
    backgroundColor: colors.darkCard, borderRadius: radius.md,
    padding: spacing.sm, marginBottom: spacing.xs,
    borderWidth: 1, borderColor: colors.gold,
  },
  bestTimeText: { color: colors.white, fontSize: 13, fontWeight: '600' },
  bestTimeCount: { color: colors.gold, fontSize: 11, marginTop: 2 },
  heatmapCard: {
    backgroundColor: colors.darkCard, borderRadius: radius.lg,
    padding: spacing.md, borderWidth: 1, borderColor: colors.darkBorder,
    marginBottom: spacing.md,
  },
  heatHeaderRow: { flexDirection: 'row', marginBottom: spacing.xs },
  heatSlotHeader: { flex: 1, textAlign: 'center', color: colors.gray, fontSize: 11 },
  heatRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  heatDayLabel: { width: 36, color: colors.gray, fontSize: 12 },
  heatCell: {
    flex: 1, height: 36, borderRadius: radius.sm,
    marginHorizontal: 2, borderWidth: 1, borderColor: colors.darkBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  heatCellSelected: { borderColor: colors.white, borderWidth: 2 },
  heatCellCount: { color: colors.dark, fontSize: 11, fontWeight: 'bold' },
  heatLegend: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendDot: { width: 12, height: 12, borderRadius: 3, borderWidth: 1, borderColor: colors.darkBorder },
  legendText: { color: colors.gray, fontSize: 11 },
  selectionDetail: {
    backgroundColor: colors.darkCard, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.gold,
    marginBottom: spacing.md,
  },
  selectionTitle: { color: colors.gold, fontWeight: 'bold', fontSize: 15, marginBottom: 4 },
  selectionStat: { color: colors.white, fontSize: 13, marginBottom: 4 },
  selectionHint: { color: colors.gray, fontSize: 11, fontStyle: 'italic' },

  // Forms
  formCard: {
    backgroundColor: colors.darkCard, borderRadius: radius.lg,
    padding: spacing.lg, borderWidth: 1, borderColor: colors.darkBorder,
  },
  formTitle: { color: colors.gold, fontSize: 18, fontWeight: 'bold', marginBottom: spacing.lg },
  formLabel: { color: colors.grayLight, fontSize: 13, marginBottom: spacing.xs, marginTop: spacing.md },
  formHint: { color: colors.gray, fontStyle: 'italic', fontSize: 11 },
  input: {
    backgroundColor: colors.dark, borderWidth: 1, borderColor: colors.darkBorder,
    borderRadius: radius.md, color: colors.white, padding: spacing.md, fontSize: 15,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  chip: {
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
    borderRadius: radius.full, borderWidth: 1,
    borderColor: colors.darkBorder, backgroundColor: colors.dark,
  },
  chipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.gray, fontSize: 13 },
  chipTextActive: { color: colors.dark, fontWeight: 'bold' },
  twoCol: { flexDirection: 'row', gap: spacing.sm },
  twoColField: { flex: 1 },
  formError: {
    color: '#ff6b6b', fontSize: 13, marginTop: spacing.md,
    backgroundColor: 'rgba(255,80,80,0.1)', borderRadius: radius.sm,
    padding: spacing.sm, borderWidth: 1, borderColor: 'rgba(255,80,80,0.3)',
  },
  formSuccess: {
    color: colors.success, fontSize: 13, marginTop: spacing.md,
    backgroundColor: 'rgba(76,175,80,0.1)', borderRadius: radius.sm,
    padding: spacing.sm, borderWidth: 1, borderColor: 'rgba(76,175,80,0.3)',
  },
  createBtn: {
    backgroundColor: colors.gold, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', marginTop: spacing.xl,
  },
  createBtnText: { color: colors.dark, fontWeight: 'bold', fontSize: 16 },

  // Payments
  payTabRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  payTab: {
    flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.darkBorder,
    backgroundColor: colors.darkCard, alignItems: 'center',
  },
  payTabActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  payTabText: { color: colors.gray, fontSize: 12, fontWeight: '600' },
  payTabTextActive: { color: colors.dark, fontWeight: 'bold' },
  payRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.darkCard, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.darkBorder,
  },
  payRowLeft: { flex: 1, marginRight: spacing.md },
  payRowName: { color: colors.white, fontSize: 14, fontWeight: '600' },
  payRowMeta: { color: colors.gray, fontSize: 12, marginTop: 2 },
  payRowDate: { color: colors.gray, fontSize: 11, marginTop: 2 },
  payAmountBadge: { alignItems: 'flex-end' },
  payAmount: { color: colors.gold, fontSize: 16, fontWeight: 'bold' },
  payStatus: { color: colors.success, fontSize: 11, marginTop: 2 },
  paidBadge: {
    backgroundColor: 'rgba(76,175,80,0.15)', borderRadius: radius.sm,
    paddingVertical: 3, paddingHorizontal: spacing.sm,
    borderWidth: 1, borderColor: colors.success,
  },
  paidBadgeText: { color: colors.success, fontSize: 11, fontWeight: 'bold' },
  markPaidBtn: {
    backgroundColor: colors.gold, borderRadius: radius.sm,
    paddingVertical: 4, paddingHorizontal: spacing.sm,
  },
  markPaidBtnText: { color: colors.dark, fontSize: 11, fontWeight: 'bold' },

  // Edit modal
  modalContainer: { flex: 1, backgroundColor: colors.dark },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.darkBorder,
    backgroundColor: colors.darkCard,
  },
  modalTitle: { color: colors.gold, fontSize: 16, fontWeight: 'bold' },
  modalCloseBtn: { padding: spacing.xs },
  modalCloseText: { color: colors.gray, fontSize: 15 },
  modalSaveBtn: {
    backgroundColor: colors.gold, borderRadius: radius.md,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
    minWidth: 56, alignItems: 'center',
  },
  modalSaveText: { color: colors.dark, fontWeight: 'bold', fontSize: 15 },
  modalContent: { padding: spacing.md, paddingBottom: 80 },
  infoBox: {
    backgroundColor: colors.darkCard, borderRadius: radius.md,
    padding: spacing.md, marginTop: spacing.lg,
    borderWidth: 1, borderColor: colors.darkBorder,
    alignItems: 'center',
  },
  infoBoxText: { color: colors.grayLight, fontSize: 14 },
  deleteBtn: {
    marginTop: spacing.xl, padding: spacing.md,
    borderRadius: radius.md, borderWidth: 1,
    borderColor: '#e05555', alignItems: 'center',
  },
  deleteBtnText: { color: '#e05555', fontWeight: 'bold', fontSize: 15 },
  generateBracketBtn: {
    marginTop: spacing.lg, padding: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.gold, alignItems: 'center',
  },
  generateBracketBtnText: { color: colors.dark, fontWeight: 'bold', fontSize: 15 },

  // Game ID
  dashRowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 1 },
  gameIdChip: {
    backgroundColor: colors.dark,
    borderWidth: 1, borderColor: colors.darkBorder,
    borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  gameIdChipText: { color: colors.gray, fontSize: 9, fontFamily: 'monospace' },
  gameIdBox: {
    backgroundColor: colors.dark,
    borderWidth: 1, borderColor: colors.darkBorder,
    borderRadius: 8, padding: spacing.sm,
    marginBottom: spacing.md,
  },
  gameIdBoxLabel: {
    color: colors.gray, fontSize: 9, fontWeight: '700',
    letterSpacing: 1.2, marginBottom: 3,
  },
  gameIdBoxValue: {
    color: colors.gold, fontSize: 12,
    fontFamily: 'monospace', letterSpacing: 0.3,
  },
  mrGameId: {
    color: colors.darkBorder, fontSize: 9,
    fontFamily: 'monospace', marginTop: spacing.sm,
    letterSpacing: 0.3,
  },

  // ── Match Reports ────────────────────────────────────────────────────────────
  mrHeading: {
    color: colors.white, fontSize: 20, fontWeight: '800',
    marginBottom: 2,
  },
  mrSubheading: {
    color: colors.gray, fontSize: 12, marginBottom: spacing.md,
  },
  mrCard: {
    backgroundColor: colors.darkCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  mrCardHeader: {
    flexDirection: 'row', alignItems: 'flex-start',
    padding: spacing.md, paddingBottom: spacing.xs,
  },
  mrVenue: { color: colors.white, fontSize: 15, fontWeight: '700' },
  mrMeta: { color: colors.gray, fontSize: 11, marginTop: 2 },
  mrChevron: { color: colors.gold, fontSize: 16, paddingLeft: spacing.sm },
  mrScoreRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: 1, borderBottomWidth: 1,
    borderColor: colors.darkBorder,
    marginHorizontal: spacing.md,
    gap: spacing.lg,
  },
  mrScoreBox: { alignItems: 'center', flex: 1 },
  mrScoreTeam: { color: colors.gray, fontSize: 11, marginBottom: 2 },
  mrScoreNum: { color: colors.gold, fontSize: 30, fontWeight: '900' },
  mrScoreDash: { color: colors.gray, fontSize: 22, fontWeight: '300' },
  mrRefRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    flexWrap: 'wrap', gap: 6,
  },
  mrRefLabel: { color: colors.gray, fontSize: 12 },
  mrRefName: { color: colors.white, fontSize: 12, fontWeight: '600', flex: 1 },
  mrNotesBadge: {
    backgroundColor: colors.gold + '22', borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
    color: colors.gold, fontSize: 10, fontWeight: '700',
    borderWidth: 1, borderColor: colors.gold + '44',
  },
  mrDetail: {
    backgroundColor: colors.dark,
    borderTopWidth: 1, borderColor: colors.darkBorder,
    padding: spacing.md,
  },
  mrDetailTitle: {
    color: colors.gold, fontSize: 11, fontWeight: '700',
    letterSpacing: 0.8, textTransform: 'uppercase',
    marginBottom: spacing.xs, marginTop: spacing.xs,
  },
  mrNoStats: { color: colors.gray, fontSize: 12, fontStyle: 'italic', marginBottom: spacing.xs },
  mrStatRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 1, borderColor: colors.darkBorder,
    gap: 6,
  },
  mrWonDot: { width: 8, height: 8, borderRadius: 4 },
  mrStatName: { color: colors.white, fontSize: 13, flex: 1 },
  mrGKBadge: {
    color: colors.dark, backgroundColor: colors.gold,
    fontSize: 9, fontWeight: '800',
    paddingHorizontal: 5, paddingVertical: 1,
    borderRadius: 4,
  },
  mrStatGoals: { color: colors.gray, fontSize: 12 },
  mrStatCard: { fontSize: 12 },
  mrScorerBox: { marginTop: spacing.sm },
  mrScorerName: { color: colors.grayLight, fontSize: 13, paddingVertical: 2 },
  mrNotesBox: {
    marginTop: spacing.md,
    backgroundColor: colors.darkCard,
    borderRadius: 8, borderWidth: 1,
    borderColor: colors.gold + '44',
    padding: spacing.md,
  },
  mrNotesTitle: {
    color: colors.gold, fontSize: 11, fontWeight: '700',
    letterSpacing: 0.8, textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  mrNotesText: { color: colors.grayLight, fontSize: 13, lineHeight: 19 },
  mrResultLabel: { fontSize: 11, fontWeight: '700', marginRight: 6 },
  mrTeamsRow: { flexDirection: 'row', marginBottom: spacing.sm },
  mrTeamCol: { flex: 1 },
  mrTeamDivider: { width: 1, backgroundColor: colors.darkBorder, marginHorizontal: 8 },
  mrTeamHeader: { color: colors.gold, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginBottom: 6 },
  mrPlayerLine: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  mrPlayerName: { color: colors.white, fontSize: 12, flex: 1 },
  mrPlayerIcons: { flexDirection: 'row', gap: 3, marginLeft: 4 },
  mrIcon: { fontSize: 11 },
  mrScorerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, gap: 6 },
  mrScorerTeamDot: { fontSize: 10 },
  mrScorerGoals: { color: colors.gold, fontSize: 12, fontWeight: '700', marginLeft: 'auto' },
  mrPointsBox: { marginTop: spacing.sm },
  mrPointsHeader: {
    flexDirection: 'row', paddingVertical: 4,
    borderBottomWidth: 1, borderColor: colors.darkBorder,
    marginBottom: 2,
  },
  mrPointsRow: { flexDirection: 'row', paddingVertical: 5 },
  mrPointsRowAlt: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 4 },
  mrPointsCell: { flex: 1, color: colors.grayLight, fontSize: 11, textAlign: 'center' },
});

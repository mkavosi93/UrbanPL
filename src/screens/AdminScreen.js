import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Modal, KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { colors, spacing, radius } from '../theme';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLOTS = ['AM', 'PM', 'EVE'];
const SLOT_LABELS = { AM: 'Morning', PM: 'Afternoon', EVE: 'Evening' };
const FORMATS = ['5v5', '6v6', '7v7', '8v8', '11v11'];
const GAME_STATUSES = ['open', 'active', 'completed', 'cancelled'];
const CUP_STATUSES  = ['upcoming', 'active', 'completed', 'cancelled'];
const SECTIONS = ['Dashboard', 'Availability', 'New Game', 'New Cup'];

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
    .select('*, game_players(player_id)')
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
    const { error } = await supabase
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
      .eq('id', game.id);
    setSaving(false);

    if (error) { Alert.alert('Error', error.message); }
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

  async function handleCreate() {
    if (!location.trim()) { Alert.alert('Missing', 'Please enter a location.'); return; }
    if (!date.trim() || !time.trim()) { Alert.alert('Missing', 'Please enter date and time.\nFormat: YYYY-MM-DD and HH:MM'); return; }
    if (!spots || isNaN(parseInt(spots))) { Alert.alert('Missing', 'Please enter total spots.'); return; }

    const kickoff = new Date(`${date.trim()}T${time.trim()}:00`);
    if (isNaN(kickoff.getTime())) {
      Alert.alert('Invalid date/time', 'Use format: Date → 2025-06-15  Time → 19:00');
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('games').insert({
      location: location.trim(),
      format,
      kickoff_time: kickoff.toISOString(),
      total_spots: parseInt(spots),
      entry_fee: parseFloat(fee) || 0,
      referee_pay: parseFloat(refPay) || 0,
      referees_needed: parseInt(refsNeeded) || 1,
      status: 'open',
      teams_balanced: false,
    });
    setSaving(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('✅ Game Created!', `${format} at ${location.trim()} on ${kickoff.toLocaleDateString()}`);
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

  async function handleCreate() {
    if (!name.trim()) { Alert.alert('Missing', 'Please enter a cup name.'); return; }
    if (!venue.trim()) { Alert.alert('Missing', 'Please enter a venue.'); return; }
    if (!date.trim() || !time.trim()) { Alert.alert('Missing', 'Please enter date and time.'); return; }

    const kickoff = new Date(`${date.trim()}T${time.trim()}:00`);
    if (isNaN(kickoff.getTime())) {
      Alert.alert('Invalid date/time', 'Use format: Date → 2025-06-15  Time → 10:00');
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('tournaments').insert({
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

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('✅ Cup Created!', `${name.trim()} on ${kickoff.toLocaleDateString()}`);
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
      {games?.map(g => (
        <TouchableOpacity key={g.id} style={styles.dashRow} onPress={() => onEditGame(g)} activeOpacity={0.7}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dashRowTitle} numberOfLines={1}>{g.location?.split(',')[0]}</Text>
            <Text style={styles.dashRowMeta}>
              {g.format} · {new Date(g.kickoff_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
          <View style={[styles.statusBadge, { borderColor: statusColor(g.status) }]}>
            <Text style={[styles.statusText, { color: statusColor(g.status) }]}>{g.status}</Text>
          </View>
          <Text style={styles.dashCount}>{g.game_players?.length || 0}/{g.total_spots}</Text>
          <Text style={styles.editIcon}>›</Text>
        </TouchableOpacity>
      ))}

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
              {s === 'Dashboard'   ? '📊 Dashboard'
                : s === 'Availability' ? '📅 Availability'
                : s === 'New Game'     ? '⚽ New Game'
                : '🏆 New Cup'}
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
  createBtn: {
    backgroundColor: colors.gold, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', marginTop: spacing.xl,
  },
  createBtnText: { color: colors.dark, fontWeight: 'bold', fontSize: 16 },

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
});

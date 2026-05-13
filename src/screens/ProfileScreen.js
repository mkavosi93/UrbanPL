import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Image, TextInput, Modal, RefreshControl,
} from 'react-native';

import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { supabase } from '../lib/supabase';
import { colors, spacing, radius } from '../theme';

async function fetchPlayerHistory(playerId) {
  const { data, error } = await supabase
    .from('game_player_stats')
    .select(`
      goals, won, yellow_cards, red_cards, is_goalkeeper, goals_conceded,
      games(id, location, format, kickoff_time, score_a, score_b, completed_at)
    `)
    .eq('player_id', playerId);
  if (error) throw error;
  // Sort by completed_at descending client-side
  return (data || []).sort((a, b) => {
    const da = new Date(a.games?.completed_at || a.games?.kickoff_time || 0);
    const db = new Date(b.games?.completed_at || b.games?.kickoff_time || 0);
    return db - da;
  });
}

function GameHistoryList({ playerId }) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['playerHistory', playerId],
    queryFn: () => fetchPlayerHistory(playerId),
    enabled: !!playerId,
  });

  if (isLoading) return <ActivityIndicator color={colors.gold} style={{ marginTop: 40 }} />;

  if (history.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>📋</Text>
        <Text style={styles.emptyText}>No games yet</Text>
        <Text style={styles.emptySubText}>Your completed game history will appear here.</Text>
      </View>
    );
  }

  return (
    <View>
      {history.map((s, i) => {
        const g = s.games;
        if (!g) return null;
        const venue = g.location?.split(',')[0] || 'Unknown venue';
        const date = g.completed_at || g.kickoff_time;
        const dateStr = date
          ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '';
        const scoreA = g.score_a ?? '–';
        const scoreB = g.score_b ?? '–';
        const resultColor = s.won ? colors.success : '#e05555';
        const resultLabel = s.won ? 'WIN' : (g.score_a === g.score_b ? 'DRAW' : 'LOSS');
        const resultBg = s.won ? '#1a3a1a' : (g.score_a === g.score_b ? '#2a2a1a' : '#3a1a1a');

        return (
          <View key={i} style={styles.historyCard}>
            {/* Result badge + venue */}
            <View style={styles.historyCardHeader}>
              <View style={[styles.historyResultBadge, { backgroundColor: resultBg, borderColor: resultColor }]}>
                <Text style={[styles.historyResultText, { color: resultColor }]}>{resultLabel}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.historyVenue} numberOfLines={1}>{venue}</Text>
                <Text style={styles.historyMeta}>{g.format} · {dateStr}</Text>
              </View>
            </View>

            {/* Score row */}
            <View style={styles.historyScoreRow}>
              <Text style={styles.historyScoreLabel}>🖤 Dark</Text>
              <Text style={styles.historyScore}>{scoreA} — {scoreB}</Text>
              <Text style={styles.historyScoreLabel}>White 🤍</Text>
            </View>

            {/* My stats */}
            <View style={styles.historyStatsRow}>
              <View style={styles.historyStatItem}>
                <Text style={styles.historyStatVal}>{s.goals || 0}</Text>
                <Text style={styles.historyStatLbl}>⚽ Goals</Text>
              </View>
              {s.is_goalkeeper && (
                <View style={styles.historyStatItem}>
                  <Text style={styles.historyStatVal}>{s.goals_conceded || 0}</Text>
                  <Text style={styles.historyStatLbl}>🧤 Conceded</Text>
                </View>
              )}
              {s.yellow_cards > 0 && (
                <View style={styles.historyStatItem}>
                  <Text style={styles.historyStatVal}>{s.yellow_cards}</Text>
                  <Text style={styles.historyStatLbl}>🟡 Yellow</Text>
                </View>
              )}
              {s.red_cards > 0 && (
                <View style={styles.historyStatItem}>
                  <Text style={styles.historyStatVal}>{s.red_cards}</Text>
                  <Text style={styles.historyStatLbl}>🔴 Red</Text>
                </View>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLOTS = ['AM', 'PM', 'EVE'];
const SLOT_LABELS = { AM: '9am–2pm', PM: '2pm–6pm', EVE: '6pm–10pm' };

function StatBox({ label, value }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value ?? 0}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ShirtIcon({ number }) {
  return (
    <View style={styles.shirtContainer}>
      <View style={styles.shirt}>
        <View style={styles.shirtCollar} />
        <View style={styles.shirtBody}>
          <Text style={styles.shirtNumber}>{number}</Text>
        </View>
      </View>
    </View>
  );
}

function AvailabilityGrid({ availability, playerId, t }) {
  const [locked, setLocked] = useState(true);
  const [local, setLocal] = useState(availability || {});
  const [saving, setSaving] = useState(false);

  function getCellColor(day, slot) {
    const val = local[`${day}_${slot}`] || 'Off';
    if (val === 'Available') return colors.gold;
    if (val === 'Maybe') return colors.darkBorder;
    return colors.darkCard;
  }

  function toggleCell(day, slot) {
    if (locked) return;
    const key = `${day}_${slot}`;
    setLocal(prev => {
      const current = prev[key] || 'Off';
      const next = current === 'Off' ? 'Available' : current === 'Available' ? 'Maybe' : 'Off';
      return { ...prev, [key]: next };
    });
  }

  async function handleSave() {
    const count = Object.values(local).filter(v => v !== 'Off').length;
    if (count < 2) {
      Alert.alert('Too few slots', 'Please select at least 2 available time slots.');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('players')
      .update({ availability: local })
      .eq('id', playerId);
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Saved!', 'Your availability has been updated.');
      setLocked(true);
    }
  }

  function handleCancel() {
    setLocal(availability || {});
    setLocked(true);
  }

  return (
    <View style={styles.gridWrapper}>
      {/* Header row with lock/unlock button */}
      <View style={styles.gridTitleRow}>
        <Text style={styles.sectionTitle}>{t ? t('profile.availability') : 'Availability'}</Text>
        <TouchableOpacity
          style={[styles.lockBtn, !locked && styles.lockBtnActive]}
          onPress={() => locked ? setLocked(false) : handleCancel()}
        >
          <Text style={styles.lockBtnText}>{locked ? '🔒 Edit' : '✕ Cancel'}</Text>
        </TouchableOpacity>
      </View>

      {!locked && (
        <Text style={styles.gridEditHint}>
          Tap to cycle: Off → Available (gold) → Maybe (dim)
        </Text>
      )}

      <View style={styles.grid}>
        <View style={styles.gridHeaderRow}>
          <View style={{ width: 36 }} />
          {SLOTS.map(slot => (
            <Text key={slot} style={styles.gridSlotHeader}>{SLOT_LABELS[slot]}</Text>
          ))}
        </View>
        {DAYS.map(day => (
          <View key={day} style={styles.gridRow}>
            <Text style={styles.gridDayLabel}>{t ? t(`days.${day}`) : day}</Text>
            {SLOTS.map(slot => (
              <TouchableOpacity
                key={slot}
                disabled={locked}
                onPress={() => toggleCell(day, slot)}
                style={[
                  styles.gridCell,
                  { backgroundColor: getCellColor(day, slot) },
                  !locked && styles.gridCellEditable,
                ]}
              />
            ))}
          </View>
        ))}
        <View style={styles.gridLegend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.gold }]} />
            <Text style={styles.legendText}>{t ? t('profile.available') : 'Available'}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.darkBorder }]} />
            <Text style={styles.legendText}>{t ? t('profile.maybe') : 'Maybe'}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.darkCard }]} />
            <Text style={styles.legendText}>{t ? t('profile.off') : 'Off'}</Text>
          </View>
        </View>
      </View>

      {/* Save button — only when unlocked */}
      {!locked && (
        <TouchableOpacity
          style={[styles.saveAvailBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color={colors.dark} size="small" />
            : <Text style={styles.saveAvailBtnText}>💾 Save Availability</Text>
          }
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function ProfileScreen() {
  const { player, playerLoading, playerError, fetchPlayer, signOut, session } = useAuth();
  const { t, language, setLanguage } = useLanguage();
  const [activeTab, setActiveTab] = useState('Info');
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    const uid = session?.user?.id;
    if (uid) await fetchPlayer(uid);
    setRefreshing(false);
  }

  // Still loading
  if (!player && playerLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  // Player row missing or failed to load
  if (!player || playerError) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={{ fontSize: 40, marginBottom: 16 }}>⚠️</Text>
        <Text style={{ color: colors.white, fontSize: 17, fontWeight: 'bold', marginBottom: 8 }}>
          Profile Not Found
        </Text>
        <Text style={{ color: colors.gray, fontSize: 13, textAlign: 'center', marginBottom: 24, paddingHorizontal: 32 }}>
          Your account was created but your profile data is missing. This can happen if signup didn't complete fully.
        </Text>
        <TouchableOpacity
          style={{ backgroundColor: colors.gold, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 32, marginBottom: 12 }}
          onPress={handleRefresh}
        >
          <Text style={{ color: colors.dark, fontWeight: 'bold', fontSize: 15 }}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={signOut}>
          <Text style={{ color: colors.gray, fontSize: 13 }}>Sign out and try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  async function handleChangePassword() {
    if (newPassword.length < 8) {
      Alert.alert(t('profile.tooShort'), t('profile.tooShortMsg'));
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert(t('profile.mismatch'), t('profile.mismatchMsg'));
      return;
    }
    setChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPassword(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert(t('profile.success'), t('profile.successMsg'));
      setShowChangePassword(false);
      setNewPassword('');
      setConfirmPassword('');
    }
  }

  function confirmSignOut() {
    Alert.alert(t('profile.signOutTitle'), t('profile.signOutMsg'), [
      { text: t('profile.cancel'), style: 'cancel' },
      { text: t('profile.signOut'), style: 'destructive', onPress: signOut },
    ]);
  }

  const [avatarError, setAvatarError] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  async function handleChangeAvatar() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;

    setUploadingAvatar(true);
    try {
      const base64 = result.assets[0].base64;
      const filePath = `${player.id}/avatar.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, decode(base64), { contentType: 'image/jpeg', upsert: true });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
      // Add cache-buster so React Native reloads the image
      const avatarUrl = `${data.publicUrl}?t=${Date.now()}`;

      await supabase.from('players').update({ avatar_url: avatarUrl }).eq('id', player.id);
      await fetchPlayer(player.id);
      setAvatarError(false);
      Alert.alert('✅ Photo updated!', 'Your profile photo has been saved.');
    } catch (err) {
      Alert.alert('Upload failed', err.message);
    } finally {
      setUploadingAvatar(false);
    }
  }

  const fullName = [player.first_name, player.last_name].filter(Boolean).join(' ') || player.name || player.email;
  const initials = [player.first_name?.[0], player.last_name?.[0]].filter(Boolean).join('').toUpperCase() || fullName[0]?.toUpperCase() || 'U';

  const tags = [
    { label: player.role || 'Outfield', icon: '⚡' },
    { label: player.skill_level || 'Player', icon: '📊' },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.gold} />}
    >

      {/* Cover Banner */}
      <View style={styles.cover}>
        <View style={styles.pitchLines}>
          {[...Array(6)].map((_, i) => <View key={i} style={styles.pitchLine} />)}
        </View>
        <Image
          source={require('../../assets/logo.png')}
          style={styles.coverLogo}
          resizeMode="contain"
        />
        <View style={styles.coverWordmark}>
          <Text style={styles.coverWordmarkUrban}>URBAN</Text>
          <Text style={styles.coverWordmarkPL}>PL</Text>
        </View>
        <Text style={styles.coverTagline}>PICKUP LEAGUE</Text>
      </View>

      {/* Avatar */}
      <View style={styles.avatarRow}>
        <TouchableOpacity onPress={handleChangeAvatar} disabled={uploadingAvatar} activeOpacity={0.8}>
          {player.avatar_url && !avatarError ? (
            <Image
              source={{ uri: player.avatar_url }}
              style={styles.avatarImage}
              onError={() => setAvatarError(true)}
            />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          )}
          <View style={styles.avatarEditBadge}>
            {uploadingAvatar
              ? <ActivityIndicator color={colors.dark} size="small" />
              : <Text style={styles.avatarEditIcon}>📷</Text>
            }
          </View>
        </TouchableOpacity>
        <View style={styles.avatarRowRight}>
          {/* Language Toggle */}
          <View style={styles.langToggle}>
            <TouchableOpacity
              style={[styles.langBtn, language === 'en' && styles.langBtnActive]}
              onPress={() => setLanguage('en')}
            >
              <Text style={[styles.langBtnText, language === 'en' && styles.langBtnTextActive]}>EN</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.langBtn, language === 'es' && styles.langBtnActive]}
              onPress={() => setLanguage('es')}
            >
              <Text style={[styles.langBtnText, language === 'es' && styles.langBtnTextActive]}>ES</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.langBtn, language === 'pt' && styles.langBtnActive]}
              onPress={() => setLanguage('pt')}
            >
              <Text style={[styles.langBtnText, language === 'pt' && styles.langBtnTextActive]}>PT</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Name & Tags */}
      <Text style={styles.name}>{fullName}</Text>
      <Text style={styles.email}>{player.email}</Text>

      <View style={styles.tagsRow}>
        {tags.map((tag, i) => (
          <View key={i} style={styles.tag}>
            <Text style={styles.tagText}>{tag.icon} {tag.label}</Text>
          </View>
        ))}
      </View>

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <StatBox label={t('profile.points')} value={player.points ?? 0} />
        <View style={styles.statDivider} />
        <StatBox label={t('profile.goals')} value={player.goals ?? 0} />
        <View style={styles.statDivider} />
        <StatBox label={t('profile.games')} value={player.games_played ?? 0} />
        <View style={styles.statDivider} />
        <StatBox label={t('profile.wins')} value={player.wins ?? 0} />
      </View>

      {/* Sub Tabs */}
      <View style={styles.subTabs}>
        {[t('profile.info'), t('profile.history')].map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.subTab, activeTab === tab && styles.subTabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.subTabText, activeTab === tab && styles.subTabTextActive]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Info Tab */}
      {activeTab === t('profile.info') && (
        <View style={styles.tabContent}>
          <View style={styles.infoCard}>
            <Text style={styles.infoCardTitle}>{t('profile.playerDetails')}</Text>
            <View style={styles.infoRow}>
              <Text style={styles.infoKey}>{t('profile.role')}</Text>
              <Text style={styles.infoVal}>{player.role || '—'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoKey}>{t('profile.skillLevel')}</Text>
              <Text style={styles.infoVal}>{player.skill_level || '—'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoKey}>{t('profile.rating')}</Text>
              <Text style={styles.infoVal}>⭐ {player.rating ?? 5.0}</Text>
            </View>
          </View>

          <AvailabilityGrid availability={player.availability} playerId={player.id} t={t} />
        </View>
      )}

      {/* History Tab */}
      {activeTab === t('profile.history') && (
        <View style={styles.tabContent}>
          <GameHistoryList playerId={player?.id} />
        </View>
      )}

      {/* Change Password Button */}
      <TouchableOpacity style={styles.changePasswordBtn} onPress={() => setShowChangePassword(true)}>
        <Text style={styles.changePasswordText}>{t('profile.changePassword')}</Text>
      </TouchableOpacity>

      {/* Sign Out Button */}
      <TouchableOpacity style={styles.signOutFullBtn} onPress={confirmSignOut}>
        <Text style={styles.signOutFullText}>{t('profile.signOut')}</Text>
      </TouchableOpacity>

      {/* Change Password Modal */}
      <Modal visible={showChangePassword} transparent animationType="slide" onRequestClose={() => setShowChangePassword(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t('profile.changePasswordTitle')}</Text>

            <Text style={styles.modalLabel}>{t('profile.newPassword')}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder={t('profile.passwordPlaceholder')}
              placeholderTextColor={colors.gray}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
            />

            <Text style={styles.modalLabel}>{t('profile.confirmPassword')}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder={t('profile.repeatPlaceholder')}
              placeholderTextColor={colors.gray}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
            />

            <TouchableOpacity
              style={[styles.modalConfirmBtn, changingPassword && { opacity: 0.6 }]}
              onPress={handleChangePassword}
              disabled={changingPassword}
            >
              {changingPassword
                ? <ActivityIndicator color={colors.dark} />
                : <Text style={styles.modalConfirmText}>{t('profile.updatePassword')}</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowChangePassword(false)}>
              <Text style={styles.modalCancelText}>{t('profile.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.dark },
  content: { paddingBottom: spacing.xxl },
  loadingContainer: { flex: 1, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  cover: {
    height: 190, backgroundColor: colors.darkCard,
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12,
  },
  pitchLines: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'stretch',
  },
  pitchLine: { width: 1, backgroundColor: 'rgba(201, 168, 76, 0.15)' },
  coverLogo: { width: 72, height: 72, opacity: 0.9 },
  coverWordmark: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    marginTop: 6,
  },
  coverWordmarkUrban: {
    fontSize: 22,
    fontWeight: '300',
    color: colors.white,
    letterSpacing: 4,
    opacity: 0.9,
  },
  coverWordmarkPL: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.gold,
    letterSpacing: -1,
    lineHeight: 28,
  },
  coverTagline: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.gray,
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginTop: 3,
  },
  avatarRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, marginTop: -30, marginBottom: spacing.sm,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.darkBorder, borderWidth: 3, borderColor: colors.dark,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImage: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 3, borderColor: colors.gold,
  },
  avatarText: { fontSize: 28, fontWeight: 'bold', color: colors.gold },
  avatarEditBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.gold, borderWidth: 2, borderColor: colors.dark,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarEditIcon: { fontSize: 11 },
  avatarRowRight: { alignItems: 'flex-end', gap: spacing.xs },
  langToggle: {
    flexDirection: 'row',
    backgroundColor: colors.darkCard,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    padding: 3,
  },
  langBtn: {
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
  },
  langBtnActive: { backgroundColor: colors.gold },
  langBtnText: { color: colors.gray, fontSize: 12, fontWeight: '600' },
  langBtnTextActive: { color: colors.dark, fontWeight: 'bold' },
  signOutBtn: {
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.darkBorder,
  },
  signOutText: { color: colors.gray, fontSize: 13 },
  name: { fontSize: 22, fontWeight: 'bold', color: colors.white, paddingHorizontal: spacing.lg },
  email: { fontSize: 13, color: colors.gray, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  tagsRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
    paddingHorizontal: spacing.lg, marginBottom: spacing.lg,
  },
  tag: {
    paddingVertical: spacing.xs, paddingHorizontal: spacing.sm,
    backgroundColor: colors.goldDim, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.gold,
  },
  tagText: { color: colors.gold, fontSize: 12, fontWeight: '600' },
  statsRow: {
    flexDirection: 'row', marginHorizontal: spacing.lg,
    backgroundColor: colors.darkCard, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.lg,
    borderWidth: 1, borderColor: colors.darkBorder,
  },
  statBox: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 28, fontWeight: 'bold', color: colors.gold },
  statLabel: { fontSize: 11, color: colors.gray, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: colors.darkBorder },
  subTabs: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.darkBorder,
    marginHorizontal: spacing.lg, marginBottom: spacing.lg,
  },
  subTab: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center' },
  subTabActive: { borderBottomWidth: 2, borderBottomColor: colors.gold },
  subTabText: { color: colors.gray, fontSize: 14 },
  subTabTextActive: { color: colors.gold, fontWeight: 'bold' },
  tabContent: { paddingHorizontal: spacing.lg },
  infoCard: {
    backgroundColor: colors.darkCard, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.darkBorder, marginBottom: spacing.lg,
  },
  infoCardTitle: { color: colors.gold, fontWeight: 'bold', fontSize: 14, marginBottom: spacing.md },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.darkBorder,
  },
  infoKey: { color: colors.gray, fontSize: 13 },
  infoVal: { color: colors.white, fontSize: 13, fontWeight: '600' },
  sectionTitle: {
    color: colors.grayLight, fontSize: 13, fontWeight: '600',
    marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 1,
  },
  gridWrapper: { marginBottom: spacing.lg },
  gridTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  lockBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    backgroundColor: colors.darkCard,
  },
  lockBtnActive: {
    borderColor: colors.error,
    backgroundColor: 'rgba(255,59,48,0.1)',
  },
  lockBtnText: { color: colors.grayLight, fontSize: 12, fontWeight: '600' },
  gridEditHint: {
    color: colors.gold,
    fontSize: 11,
    fontStyle: 'italic',
    marginBottom: spacing.sm,
  },
  grid: { marginBottom: spacing.sm },
  gridHeaderRow: { flexDirection: 'row', marginBottom: spacing.xs },
  gridRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  gridDayLabel: { width: 36, color: colors.gray, fontSize: 12 },
  gridSlotHeader: { flex: 1, textAlign: 'center', color: colors.gray, fontSize: 9, fontWeight: '600' },
  gridCell: {
    flex: 1, height: 28, borderRadius: radius.sm,
    marginHorizontal: 2, borderWidth: 1, borderColor: colors.darkBorder,
  },
  gridCellEditable: {
    borderColor: colors.gold,
    opacity: 0.9,
  },
  gridLegend: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: colors.darkBorder },
  legendText: { color: colors.gray, fontSize: 11 },
  saveAvailBtn: {
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  saveAvailBtnText: { color: colors.dark, fontWeight: 'bold', fontSize: 15 },
  emptyState: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyIcon: { fontSize: 40, marginBottom: spacing.md },
  emptyText: { color: colors.white, fontSize: 16, fontWeight: 'bold' },
  emptySubText: { color: colors.gray, fontSize: 13, marginTop: spacing.xs },
  changePasswordBtn: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    alignItems: 'center',
    backgroundColor: colors.darkCard,
  },
  changePasswordText: { color: colors.grayLight, fontWeight: '600', fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
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
    width: 40, height: 4, backgroundColor: colors.darkBorder,
    borderRadius: 2, alignSelf: 'center', marginBottom: spacing.lg,
  },
  modalTitle: { color: colors.white, fontWeight: 'bold', fontSize: 18, marginBottom: spacing.lg },
  modalLabel: { color: colors.grayLight, fontSize: 13, marginBottom: spacing.xs, marginTop: spacing.md },
  modalInput: {
    backgroundColor: colors.dark, borderWidth: 1, borderColor: colors.darkBorder,
    borderRadius: radius.md, color: colors.white, padding: spacing.md, fontSize: 16,
  },
  modalConfirmBtn: {
    backgroundColor: colors.gold, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', marginTop: spacing.xl,
  },
  modalConfirmText: { color: colors.dark, fontWeight: 'bold', fontSize: 16 },
  modalCancelBtn: { alignItems: 'center', padding: spacing.md },
  modalCancelText: { color: colors.gray, fontSize: 14 },
  signOutFullBtn: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    alignItems: 'center',
  },
  signOutFullText: {
    color: colors.error,
    fontWeight: 'bold',
    fontSize: 15,
  },

  // ── Game History ──────────────────────────────────────────────────────────
  historyCard: {
    backgroundColor: colors.darkCard,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  historyCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    paddingBottom: 6,
  },
  historyResultBadge: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minWidth: 46,
    alignItems: 'center',
  },
  historyResultText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  historyVenue: { color: colors.white, fontSize: 13, fontWeight: '600' },
  historyMeta: { color: colors.gray, fontSize: 11, marginTop: 1 },
  historyScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.darkBorder,
  },
  historyScore: { color: colors.gold, fontSize: 18, fontWeight: '900' },
  historyScoreLabel: { color: colors.gray, fontSize: 11 },
  historyStatsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    gap: spacing.md,
  },
  historyStatItem: { alignItems: 'center', minWidth: 44 },
  historyStatVal: { color: colors.white, fontSize: 16, fontWeight: '700' },
  historyStatLbl: { color: colors.gray, fontSize: 10, marginTop: 1 },
});

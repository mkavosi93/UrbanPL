import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Image, TextInput, Modal, RefreshControl,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { supabase } from '../lib/supabase';
import { colors, spacing, radius } from '../theme';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLOTS = ['AM', 'PM', 'EVE'];

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
            <Text key={slot} style={styles.gridSlotHeader}>{t ? t(`slots.${slot}`) : slot}</Text>
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
  const { player, fetchPlayer, signOut } = useAuth();
  const { t, language, setLanguage } = useLanguage();
  const [activeTab, setActiveTab] = useState('Info');
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    if (player?.id) await fetchPlayer(player.id);
    setRefreshing(false);
  }

  if (!player) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.gold} size="large" />
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
        <Text style={styles.coverEmoji}>⚽</Text>
      </View>

      {/* Avatar */}
      <View style={styles.avatarRow}>
        {player.avatar_url ? (
          <Image source={{ uri: player.avatar_url }} style={styles.avatarImage} />
        ) : (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        )}
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
            {player.first_name && (
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>{t('profile.firstName')}</Text>
                <Text style={styles.infoVal}>{player.first_name}</Text>
              </View>
            )}
            {player.last_name && (
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>{t('profile.lastName')}</Text>
                <Text style={styles.infoVal}>{player.last_name}</Text>
              </View>
            )}
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
            {player.birth_month && player.birth_year && (
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>{t('profile.born')}</Text>
                <Text style={styles.infoVal}>
                  {new Date(player.birth_year, player.birth_month - 1)
                    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </Text>
              </View>
            )}
          </View>

          <AvailabilityGrid availability={player.availability} playerId={player.id} t={t} />
        </View>
      )}

      {/* History Tab */}
      {activeTab === t('profile.history') && (
        <View style={styles.tabContent}>
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyText}>{t('profile.noGames')}</Text>
            <Text style={styles.emptySubText}>{t('profile.historySubtext')}</Text>
          </View>
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
    height: 160, backgroundColor: colors.darkCard,
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
  },
  pitchLines: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'stretch',
  },
  pitchLine: { width: 1, backgroundColor: 'rgba(201, 168, 76, 0.15)' },
  coverEmoji: { fontSize: 64, opacity: 0.6 },
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
  gridSlotHeader: { flex: 1, textAlign: 'center', color: colors.gray, fontSize: 11 },
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
});

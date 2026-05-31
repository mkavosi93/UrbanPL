import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Image, Share, ScrollView,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { colors, spacing, radius } from '../theme';

async function fetchRankings(sort) {
  const sortMap = {
    Points: 'points',
    Goals: 'goals',
    Games: 'games_played',
    Wins: 'wins',
    Sheets: 'clean_sheets',
  };

  const { data, error } = await supabase
    .from('players')
    .select('id, first_name, last_name, name, email, role, skill_level, points, goals, games_played, wins, cards, rating, avatar_url, clean_sheets')
    .neq('role', 'Referee')
    .order(sortMap[sort] || 'points', { ascending: false })
    .limit(50);

  if (error) throw error;
  return data || [];
}

const STAT_MAP = { Points: 'points', Goals: 'goals', Games: 'games_played', Wins: 'wins', Sheets: 'clean_sheets' };
const SORT_ICONS = { Points: '🏅', Goals: '⚽', Games: '🔢', Wins: '🏆', Sheets: '🧤' };
const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
const ACCENT = { 1: colors.gold, 2: '#C0C0C0', 3: '#CD7F32' };

function getDisplayName(player) {
  const full = [player.first_name, player.last_name].filter(Boolean).join(' ');
  return full || player.name || player.email?.split('@')[0] || 'Player';
}

function getInitial(player) {
  return getDisplayName(player)[0]?.toUpperCase() || 'P';
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ player, size = 40, rank }) {
  const accent = ACCENT[rank];
  return (
    <View style={[
      styles.avatarWrap,
      { width: size + 4, height: size + 4, borderRadius: (size + 4) / 2 },
      accent && { borderColor: accent, borderWidth: rank === 1 ? 3 : 2 },
    ]}>
      {player.avatar_url
        ? <Image source={{ uri: player.avatar_url }} style={{ width: size, height: size, borderRadius: size / 2 }} />
        : (
          <View style={[styles.avatarInner, { width: size, height: size, borderRadius: size / 2 }]}>
            <Text style={[styles.avatarInitial, { fontSize: size * 0.38 }]}>{getInitial(player)}</Text>
          </View>
        )
      }
      {rank <= 3 && (
        <View style={styles.medalBadge}>
          <Text style={styles.medalBadgeText}>{MEDAL[rank]}</Text>
        </View>
      )}
    </View>
  );
}

// ── Podium Card ───────────────────────────────────────────────────────────────
function PodiumCard({ player, rank, sortKey, sortIcon }) {
  const statVal = player[STAT_MAP[sortKey]] ?? 0;
  const accent = ACCENT[rank];
  const isFirst = rank === 1;

  return (
    <View style={[styles.podiumCard, isFirst && styles.podiumCardFirst, { borderColor: accent + '55' }]}>
      {isFirst && <View style={[styles.podiumGlow, { backgroundColor: accent }]} />}

      {/* Medal */}
      <Text style={styles.podiumMedal}>{MEDAL[rank]}</Text>

      {/* Avatar */}
      <Avatar player={player} size={isFirst ? 66 : 50} rank={rank} />

      {/* Name */}
      <Text style={[styles.podiumName, isFirst && styles.podiumNameFirst]} numberOfLines={1}>
        {getDisplayName(player)}
      </Text>

      {/* Stat */}
      <View style={[styles.podiumStatChip, { backgroundColor: accent + '22', borderColor: accent + '66' }]}>
        <Text style={[styles.podiumStatIcon]}>{sortIcon}</Text>
        <Text style={[styles.podiumStatNum, { color: accent }]}>{statVal}</Text>
      </View>
    </View>
  );
}

function Podium({ players, sortKey }) {
  if (!players || players.length < 1) return null;
  const [first, second, third] = players;
  const sortIcon = SORT_ICONS[sortKey] || '🏅';

  return (
    <View style={styles.podiumContainer}>
      {/* Row: 2nd – 1st – 3rd */}
      <View style={styles.podiumRow}>
        {second
          ? <PodiumCard player={second} rank={2} sortKey={sortKey} sortIcon={sortIcon} />
          : <View style={styles.podiumCardPlaceholder} />
        }
        {first && <PodiumCard player={first} rank={1} sortKey={sortKey} sortIcon={sortIcon} />}
        {third
          ? <PodiumCard player={third} rank={3} sortKey={sortKey} sortIcon={sortIcon} />
          : <View style={styles.podiumCardPlaceholder} />
        }
      </View>
    </View>
  );
}

// ── Share ─────────────────────────────────────────────────────────────────────
function shareRanking(player, rank, sortKey) {
  const statVal = player[STAT_MAP[sortKey]] ?? 0;
  const medal = MEDAL[rank] || `#${rank}`;
  Share.share({
    message: [
      `⚽ URBAN PL — CITY RANKINGS`,
      ``,
      `${medal}  ${getDisplayName(player)}`,
      `${SORT_ICONS[sortKey]} ${sortKey}: ${statVal}  ·  ⭐ Rating: ${player.rating ?? '2.5'}`,
      `⚽ Goals: ${player.goals ?? 0}  ·  🏅 Points: ${player.points ?? 0}  ·  🎮 Games: ${player.games_played ?? 0}`,
      ``,
      `🟩 Play pickup soccer in your city`,
      `Download Urban PL and compete! 🏆`,
    ].join('\n'),
    title: 'My Urban PL Ranking',
  });
}

// ── Rank Row ──────────────────────────────────────────────────────────────────
function RankRow({ player, rank, sortKey, isMe }) {
  const statVal = player[STAT_MAP[sortKey]] ?? 0;
  const accent = ACCENT[rank];
  const isTop3 = rank <= 3;

  return (
    <View style={[styles.rankRow, isMe && styles.rankRowMe, isTop3 && { borderLeftColor: accent, borderLeftWidth: 3 }]}>

      {/* Rank badge */}
      <View style={styles.rankBadgeWrap}>
        {isTop3
          ? <Text style={styles.rankMedalText}>{MEDAL[rank]}</Text>
          : <Text style={[styles.rankNum, isMe && { color: colors.gold }]}>{rank}</Text>
        }
      </View>

      {/* Avatar (no medal badge in list — already shown in rank badge) */}
      <View style={[
        styles.listAvatarWrap,
        isTop3 && { borderColor: accent + '88', borderWidth: 1.5 },
        isMe && !isTop3 && { borderColor: colors.gold, borderWidth: 1.5 },
      ]}>
        {player.avatar_url
          ? <Image source={{ uri: player.avatar_url }} style={styles.listAvatar} />
          : (
            <View style={styles.listAvatarInner}>
              <Text style={styles.listAvatarInitial}>{getInitial(player)}</Text>
            </View>
          )
        }
      </View>

      {/* Name + position */}
      <View style={styles.rankInfo}>
        <View style={styles.rankNameRow}>
          <Text style={[styles.rankName, isMe && styles.rankNameMe]} numberOfLines={1}>
            {getDisplayName(player)}
          </Text>
          {isMe && <View style={styles.youPill}><Text style={styles.youPillText}>YOU</Text></View>}
        </View>
        <Text style={styles.rankSub}>{player.skill_level || player.role || 'Player'}</Text>
      </View>

      {/* Stat */}
      <View style={styles.rankStatBox}>
        <Text style={[styles.rankStatVal, isMe && { color: colors.gold }]}>{statVal}</Text>
        <Text style={styles.rankStatLabel}>{SORT_ICONS[sortKey]}</Text>
      </View>

      {/* Share button (only for me) */}
      {isMe && (
        <TouchableOpacity style={styles.shareBtn} onPress={() => shareRanking(player, rank, sortKey)}>
          <Text style={styles.shareBtnIcon}>↑</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Points Formula Card ───────────────────────────────────────────────────────
function PointsFormulaCard() {
  const [expanded, setExpanded] = React.useState(false);
  const rows = [
    { icon: '🏆', label: 'Win',               value: '+3 pts' },
    { icon: '⚽', label: 'Goal scored',        value: '+1 pt each' },
    { icon: '🧤', label: 'GK clean sheet',     value: '+3 pts' },
    { icon: '🧤', label: 'GK concede only 1',  value: '+1 pt' },
    { icon: '🟨', label: 'Yellow card',         value: '−1 pt' },
    { icon: '🟥', label: 'Red card',            value: '−3 pts' },
  ];

  return (
    <TouchableOpacity
      style={formulaStyles.card}
      onPress={() => setExpanded(e => !e)}
      activeOpacity={0.85}
    >
      <View style={formulaStyles.header}>
        <Text style={formulaStyles.title}>🏅 How Points Are Calculated</Text>
        <Text style={formulaStyles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </View>
      {expanded && (
        <View style={formulaStyles.body}>
          {rows.map((row, i) => (
            <View key={i} style={[formulaStyles.row, i < rows.length - 1 && formulaStyles.rowBorder]}>
              <Text style={formulaStyles.rowIcon}>{row.icon}</Text>
              <Text style={formulaStyles.rowLabel}>{row.label}</Text>
              <Text style={[
                formulaStyles.rowValue,
                row.value.startsWith('−') && formulaStyles.rowValueNeg,
              ]}>
                {row.value}
              </Text>
            </View>
          ))}
          <Text style={formulaStyles.note}>Minimum 0 pts per game · Referees excluded from rankings</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const formulaStyles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.darkCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gold + '44',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  title: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  chevron: { color: colors.gray, fontSize: 11 },
  body: {
    borderTopWidth: 1,
    borderTopColor: colors.darkBorder,
    paddingHorizontal: spacing.md,
    paddingTop: 6,
    paddingBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.darkBorder,
  },
  rowIcon: { fontSize: 14, width: 24 },
  rowLabel: { flex: 1, color: colors.grayLight, fontSize: 12, fontWeight: '500' },
  rowValue: { color: '#4CAF50', fontSize: 13, fontWeight: '700' },
  rowValueNeg: { color: '#F44336' },
  note: {
    color: colors.gray,
    fontSize: 10,
    marginTop: 8,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});

// ── Section Divider ───────────────────────────────────────────────────────────
function SectionLabel({ label }) {
  return (
    <View style={styles.sectionLabel}>
      <View style={styles.sectionLine} />
      <Text style={styles.sectionLabelText}>{label}</Text>
      <View style={styles.sectionLine} />
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function RankingsScreen() {
  const { t } = useLanguage();
  const { player } = useAuth();

  const SCOPES_KEYS = ['county', 'state', 'country'];
  const SORTS_KEYS = ['points', 'goals', 'games', 'wins', 'sheets'];
  const SCOPES = SCOPES_KEYS.map(k => t(`rankings.${k}`));
  const SORTS = SORTS_KEYS.map(k => t(`rankings.${k}`));

  const [activeScope, setActiveScope] = useState(SCOPES[0]);
  const [activeSort, setActiveSort] = useState(SORTS[0]);

  const sortKeyMap = {
    [t('rankings.points')]: 'Points',
    [t('rankings.goals')]: 'Goals',
    [t('rankings.games')]: 'Games',
    [t('rankings.wins')]: 'Wins',
    [t('rankings.sheets')]: 'Sheets',
  };
  const activeSortKey = sortKeyMap[activeSort] || 'Goals';

  const { data: players, isLoading, isError, refetch } = useQuery({
    queryKey: ['rankings', activeSortKey],
    queryFn: () => fetchRankings(activeSortKey),
    staleTime: 5 * 60 * 1000,
  });

  const top3 = players?.slice(0, 3) || [];
  const rest = players?.slice(3) || [];
  const myRank = players?.findIndex(p => p.id === player?.id);
  const meInRest = myRank !== undefined && myRank >= 3;

  return (
    <View style={styles.container}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <Image source={require('../../assets/logo.png')} style={styles.headerLogo} resizeMode="contain" />
        <View>
          <Text style={styles.headerTitle}>CITY RANKINGS</Text>
          <Text style={styles.headerSub}>URBAN PL · {activeScope.toUpperCase()}</Text>
        </View>
      </View>

      {/* ── Scope Switcher ── */}
      <View style={styles.scopeRow}>
        {SCOPES.map(scope => (
          <TouchableOpacity
            key={scope}
            style={[styles.scopeBtn, activeScope === scope && styles.scopeBtnActive]}
            onPress={() => setActiveScope(scope)}
          >
            <Text style={[styles.scopeText, activeScope === scope && styles.scopeTextActive]}>
              {scope}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Sort Chips ── */}
      <View style={styles.sortRow}>
        {SORTS.map((sort, i) => {
          const key = ['Points', 'Goals', 'Games', 'Wins', 'Sheets'][i];
          const active = activeSort === sort;
          return (
            <TouchableOpacity
              key={sort}
              style={[styles.sortChip, active && styles.sortChipActive]}
              onPress={() => setActiveSort(sort)}
            >
              <Text style={styles.sortChipIcon}>{SORT_ICONS[key]}</Text>
              {active && <Text style={styles.sortTextActive}>{sort}</Text>}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── States ── */}
      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.gold} size="large" />
        </View>
      )}

      {isError && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{t('rankings.failedLoad')}</Text>
          <TouchableOpacity onPress={refetch} style={styles.retryBtn}>
            <Text style={styles.retryText}>{t('rankings.retry')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {!isLoading && !isError && players?.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📊</Text>
          <Text style={styles.emptyText}>{t('rankings.noRankings')}</Text>
          <Text style={styles.emptySubText}>{t('rankings.noRankingsSubtext')}</Text>
        </View>
      )}

      {/* ── List ── */}
      {!isLoading && !isError && players?.length > 0 && (
        <FlatList
          data={rest}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              <PointsFormulaCard />
              <Podium players={top3} sortKey={activeSortKey} />
              <SectionLabel label={t('rankings.rank')} />
              {top3.map((p, i) => (
                <RankRow
                  key={p.id}
                  player={p}
                  rank={i + 1}
                  sortKey={activeSortKey}
                  isMe={p.id === player?.id}
                />
              ))}
              {rest.length > 0 && <View style={styles.listDivider} />}
            </>
          }
          renderItem={({ item, index }) => (
            <RankRow
              player={item}
              rank={index + 4}
              sortKey={activeSortKey}
              isMe={item.id === player?.id}
            />
          )}
          ListFooterComponent={
            meInRest && player ? (
              <View style={styles.myRankFooter}>
                <Text style={styles.myRankLabel}>Your ranking</Text>
                <Text style={styles.myRankNum}>#{myRank + 1}</Text>
              </View>
            ) : null
          }
        />
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.dark },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.darkBorder,
  },
  headerLogo: { width: 34, height: 34 },
  headerTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.white,
    letterSpacing: 2,
  },
  headerSub: {
    fontSize: 9,
    color: colors.gold,
    letterSpacing: 1.5,
    fontWeight: '700',
    marginTop: 1,
  },

  // ── Scope ────────────────────────────────────────────────────────────────────
  scopeRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: colors.darkCard,
    borderRadius: radius.md,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.darkBorder,
  },
  scopeBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  scopeBtnActive: { backgroundColor: colors.gold },
  scopeText: { color: colors.gray, fontSize: 13, fontWeight: '600' },
  scopeTextActive: { color: colors.dark, fontWeight: '800' },

  // ── Sort chips ───────────────────────────────────────────────────────────────
  sortRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    gap: 8,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  sortChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    backgroundColor: colors.darkCard,
  },
  sortChipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  sortChipIcon: { fontSize: 14 },
  sortText: { color: colors.gray, fontSize: 12, fontWeight: '600' },
  sortTextActive: { color: colors.dark, fontWeight: '800', fontSize: 11 },

  // ── Podium ───────────────────────────────────────────────────────────────────
  podiumContainer: {
    marginBottom: spacing.md,
    paddingTop: spacing.sm,
  },
  podiumRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  podiumCard: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.darkCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    overflow: 'hidden',
    gap: 6,
  },
  podiumCardFirst: {
    paddingVertical: spacing.lg,
    marginBottom: 8,
  },
  podiumCardPlaceholder: { flex: 1 },
  podiumGlow: {
    position: 'absolute',
    top: -30,
    width: 80,
    height: 80,
    borderRadius: 40,
    opacity: 0.15,
  },
  podiumMedal: { fontSize: 22 },
  podiumName: {
    color: colors.grayLight,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  podiumNameFirst: { color: colors.white, fontWeight: '700', fontSize: 11 },
  podiumStatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  podiumStatIcon: { fontSize: 11 },
  podiumStatNum: { fontSize: 13, fontWeight: '800' },

  // ── Avatar (podium) ──────────────────────────────────────────────────────────
  avatarWrap: {
    borderColor: colors.darkBorder,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  avatarInner: {
    backgroundColor: '#1E2430',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: colors.gold, fontWeight: '800' },
  medalBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: colors.dark,
    borderRadius: 10,
    paddingHorizontal: 1,
  },
  medalBadgeText: { fontSize: 11 },

  // ── Section label ────────────────────────────────────────────────────────────
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  sectionLine: { flex: 1, height: 1, backgroundColor: colors.darkBorder },
  sectionLabelText: {
    color: colors.gray,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },

  // ── Rank row ─────────────────────────────────────────────────────────────────
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    marginBottom: 3,
    gap: spacing.sm,
    borderLeftWidth: 0,
    borderLeftColor: 'transparent',
    backgroundColor: colors.darkCard,
    borderWidth: 1,
    borderColor: colors.darkBorder,
  },
  rankRowMe: {
    backgroundColor: '#1C1A0E',
    borderColor: colors.gold + '88',
  },

  // Rank badge
  rankBadgeWrap: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankMedalText: { fontSize: 20 },
  rankNum: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.gray,
    textAlign: 'center',
  },

  // Avatar (list)
  listAvatarWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderColor: colors.darkBorder,
    borderWidth: 1,
    overflow: 'hidden',
  },
  listAvatar: { width: 36, height: 36, borderRadius: 18 },
  listAvatarInner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1E2430',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listAvatarInitial: { color: colors.gold, fontWeight: '800', fontSize: 14 },

  // Name / sub
  rankInfo: { flex: 1, minWidth: 0 },
  rankNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rankName: { color: colors.white, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  rankNameMe: { color: colors.gold },
  rankSub: { color: colors.gray, fontSize: 10, marginTop: 1 },

  // YOU pill
  youPill: {
    backgroundColor: colors.gold,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  youPillText: { color: colors.dark, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },

  // Stat box
  rankStatBox: { alignItems: 'center', minWidth: 36 },
  rankStatVal: { color: colors.white, fontSize: 17, fontWeight: '800', lineHeight: 20 },
  rankStatLabel: { fontSize: 13, lineHeight: 14, marginTop: 1 },

  // Share button
  shareBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareBtnIcon: { color: colors.dark, fontSize: 16, fontWeight: '900', marginTop: -1 },

  // List
  listDivider: { height: 1, backgroundColor: colors.darkBorder, marginVertical: spacing.sm },
  listContent: { padding: spacing.md, paddingBottom: 80 },

  // My rank footer
  myRankFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: '#1C1A0E',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gold + '55',
  },
  myRankLabel: { color: colors.gray, fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  myRankNum: { color: colors.gold, fontSize: 18, fontWeight: '900' },

  // States
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  errorText: { color: colors.error, marginBottom: spacing.md },
  retryBtn: { padding: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.darkCard, borderRadius: radius.md },
  retryText: { color: colors.gold },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyText: { color: colors.white, fontSize: 18, fontWeight: 'bold' },
  emptySubText: { color: colors.gray, fontSize: 13, marginTop: spacing.xs },
});

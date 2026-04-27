import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Image, Share,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { colors, spacing, radius } from '../theme';

// SCOPES and SORTS are now built inside the component using translations

async function fetchRankings(sort) {
  const sortMap = {
    Points: 'points',
    Goals: 'goals',
    Games: 'games_played',
    Wins: 'wins',
  };

  const { data, error } = await supabase
    .from('players')
    .select('id, first_name, last_name, name, email, role, skill_level, points, goals, games_played, wins, cards, rating, avatar_url')
    .neq('role', 'Referee')
    .order(sortMap[sort] || 'points', { ascending: false })
    .limit(50);

  if (error) throw error;
  return data || [];
}

function Avatar({ player, size = 40, rank }) {
  const fullName = [player.first_name, player.last_name].filter(Boolean).join(' ');
  const initial = (fullName || player.name || player.email || 'U')[0].toUpperCase();
  const borderColor = rank === 1 ? colors.gold : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : colors.darkBorder;
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, borderColor }]}>
      {player.avatar_url
        ? <Image source={{ uri: player.avatar_url }} style={{ width: size, height: size, borderRadius: size / 2 }} />
        : <Text style={[styles.avatarText, { fontSize: size * 0.4 }]}>{initial}</Text>
      }
    </View>
  );
}

function Podium({ players, t }) {
  if (!players || players.length < 1) return null;
  const first = players[0];
  const second = players[1];
  const third = players[2];

  return (
    <View style={styles.podiumContainer}>
      <Text style={styles.podiumTitle}>{t('rankings.topPlayers')}</Text>
      <View style={styles.podiumRow}>

        {/* 2nd Place */}
        {second && (
          <View style={styles.podiumItem}>
            <Avatar player={second} size={52} rank={2} />
            <Text style={styles.podiumName} numberOfLines={1}>
              {[second.first_name, second.last_name].filter(Boolean).join(' ') || second.name || second.email?.split('@')[0]}
            </Text>
            <Text style={styles.podiumStat}>⭐{second.rating ?? '2.5'}</Text>
            <View style={[styles.podiumBlock, { height: 40, backgroundColor: '#C0C0C0' }]}>
              <Text style={styles.podiumRank}>2</Text>
            </View>
          </View>
        )}

        {/* 1st Place */}
        <View style={[styles.podiumItem, styles.podiumFirst]}>
          <Text style={styles.crownIcon}>👑</Text>
          <Avatar player={first} size={68} rank={1} />
          <Text style={[styles.podiumName, styles.podiumNameFirst]} numberOfLines={1}>
            {[first.first_name, first.last_name].filter(Boolean).join(' ') || first.name || first.email?.split('@')[0]}
          </Text>
          <Text style={[styles.podiumStat, styles.podiumStatFirst]}>⭐{first.rating ?? '2.5'}</Text>
          <View style={[styles.podiumBlock, { height: 56, backgroundColor: colors.gold }]}>
            <Text style={styles.podiumRank}>1</Text>
          </View>
        </View>

        {/* 3rd Place */}
        {third && (
          <View style={styles.podiumItem}>
            <Avatar player={third} size={52} rank={3} />
            <Text style={styles.podiumName} numberOfLines={1}>
              {[third.first_name, third.last_name].filter(Boolean).join(' ') || third.name || third.email?.split('@')[0]}
            </Text>
            <Text style={styles.podiumStat}>⭐{third.rating ?? '2.5'}</Text>
            <View style={[styles.podiumBlock, { height: 28, backgroundColor: '#CD7F32' }]}>
              <Text style={styles.podiumRank}>3</Text>
            </View>
          </View>
        )}

      </View>
    </View>
  );
}

function shareRanking(player, rank, sortKey) {
  const statMap = { Points: 'points', Goals: 'goals', Games: 'games_played', Wins: 'wins' };
  const statVal = player[statMap[sortKey]] ?? 0;
  const fullName = [player.first_name, player.last_name].filter(Boolean).join(' ') || player.name || 'Player';

  const medalMap = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const medal = medalMap[rank] || `#${rank}`;

  Share.share({
    message: [
      `⚽ URBAN PL — CITY RANKINGS`,
      ``,
      `${medal}  ${fullName}`,
      `⭐ Rating: ${player.rating ?? '2.5'}  ·  ${sortKey}: ${statVal}`,
      `⚽ Goals: ${player.goals ?? 0}  ·  🏅 Points: ${player.points ?? 0}  ·  🎮 Games: ${player.games_played ?? 0}`,
      ``,
      `🟩 Play pickup soccer in your city`,
      `Download Urban PL and compete! 🏆`,
    ].join('\n'),
    title: 'My Urban PL Ranking',
  });
}

function RankRow({ player, rank, sortKey, isMe }) {
  const statMap = { Points: 'points', Goals: 'goals', Games: 'games_played', Wins: 'wins' };
  const statVal = player[statMap[sortKey]] ?? 0;
  const fullName = [player.first_name, player.last_name].filter(Boolean).join(' ');
  const displayName = fullName || player.name || player.email?.split('@')[0];

  return (
    <View style={[styles.rankRow, isMe && styles.rankRowMe]}>
      <Text style={[styles.rankNum, rank <= 3 && styles.rankNumTop]}>{rank}</Text>
      <Avatar player={player} size={36} rank={rank} />
      <View style={styles.rankInfo}>
        <Text style={[styles.rankName, isMe && styles.rankNameMe]} numberOfLines={1}>
          {displayName}
          {isMe ? ' ⭐' : ''}
        </Text>
        <Text style={styles.rankPosition}>{player.role || 'Player'} · {player.skill_level || ''}</Text>
      </View>
      <View style={styles.rankStats}>
        <Text style={[styles.rankStatVal, isMe && styles.rankStatValMe]}>{statVal}</Text>
        <Text style={styles.rankStatLabel}>{sortKey}</Text>
      </View>
      {isMe && (
        <TouchableOpacity
          style={styles.shareRankBtn}
          onPress={() => shareRanking(player, rank, sortKey)}
        >
          <Text style={styles.shareRankIcon}>📤</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function RankingsScreen() {
  const { t } = useLanguage();
  const { player } = useAuth();
  const SCOPES_KEYS = ['county', 'state', 'country'];
  const SORTS_KEYS = ['points', 'goals', 'games', 'wins'];
  const SCOPES = SCOPES_KEYS.map(k => t(`rankings.${k}`));
  const SORTS = SORTS_KEYS.map(k => t(`rankings.${k}`));
  const [activeScope, setActiveScope] = useState(SCOPES[0]);
  const [activeSort, setActiveSort] = useState(SORTS[0]);

  // Map translated sort label back to English key for the query
  const sortKeyMap = {
    [t('rankings.points')]: 'Points',
    [t('rankings.goals')]: 'Goals',
    [t('rankings.games')]: 'Games',
    [t('rankings.wins')]: 'Wins',
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
  const meInTop = myRank !== undefined && myRank >= 0 && myRank < players?.length;
  const meInRest = myRank !== undefined && myRank >= 3;

  return (
    <View style={styles.container}>

      {/* Scope Switcher */}
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

      {/* Sort Chips */}
      <View style={styles.sortRow}>
        {SORTS.map(sort => (
          <TouchableOpacity
            key={sort}
            style={[styles.sortChip, activeSort === sort && styles.sortChipActive]}
            onPress={() => setActiveSort(sort)}
          >
            <Text style={[styles.sortText, activeSort === sort && styles.sortTextActive]}>
              {sort}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

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

      {!isLoading && !isError && players?.length > 0 && (
        <FlatList
          data={rest}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <>
              {/* Branded header — visible in screenshots shared to social */}
              <View style={styles.brandHeader}>
                <Image
                  source={require('../../assets/logo.png')}
                  style={styles.brandLogo}
                  resizeMode="contain"
                />
                <View style={styles.brandText}>
                  <View style={styles.brandWordmark}>
                    <Text style={styles.brandUrban}>URBAN</Text>
                    <Text style={styles.brandPL}>PL</Text>
                  </View>
                  <Text style={styles.brandTagline}>CITY RANKINGS</Text>
                </View>
              </View>

              <Podium players={top3} t={t} />
              <View style={styles.tableHeader}>
                <Text style={styles.tableHeaderText}>{t('rankings.rank')}</Text>
                <Text style={[styles.tableHeaderText, { flex: 1, marginLeft: 52 }]}>{t('rankings.player')}</Text>
                <Text style={styles.tableHeaderText}>{activeSort.toUpperCase()}</Text>
              </View>
              {top3.map((p, i) => (
                <RankRow
                  key={p.id}
                  player={p}
                  rank={i + 1}
                  sortKey={activeSortKey}
                  isMe={p.id === player?.id}
                />
              ))}
              {rest.length > 0 && <View style={styles.divider} />}
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
              <View style={styles.meFooter}>
                <Text style={styles.meFooterText}>{t('rankings.yourRank')} #{myRank + 1}</Text>
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

  // Scope
  scopeRow: {
    flexDirection: 'row',
    margin: spacing.md,
    backgroundColor: colors.darkCard,
    borderRadius: radius.md,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.darkBorder,
  },
  scopeBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  scopeBtnActive: { backgroundColor: colors.gold },
  scopeText: { color: colors.gray, fontSize: 13, fontWeight: '600' },
  scopeTextActive: { color: colors.dark, fontWeight: 'bold' },

  // Sort
  sortRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  sortChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    backgroundColor: colors.darkCard,
  },
  sortChipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  sortText: { color: colors.gray, fontSize: 12 },
  sortTextActive: { color: colors.dark, fontWeight: 'bold' },

  // Branded header
  brandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.darkCard,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    gap: spacing.md,
  },
  brandLogo: { width: 52, height: 52 },
  brandText: { flex: 1 },
  brandWordmark: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  brandUrban: {
    fontSize: 22,
    fontWeight: '300',
    color: colors.white,
    letterSpacing: 4,
  },
  brandPL: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.gold,
    letterSpacing: -1,
    lineHeight: 28,
  },
  brandTagline: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.gray,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    marginTop: 3,
  },

  // Share rank button
  shareRankBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.goldDim,
    borderWidth: 1,
    borderColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xs,
  },
  shareRankIcon: { fontSize: 14 },

  // Podium
  podiumContainer: {
    backgroundColor: colors.darkCard,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.darkBorder,
  },
  podiumTitle: {
    color: colors.gold,
    fontWeight: 'bold',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  podiumRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: spacing.lg,
  },
  podiumItem: { alignItems: 'center', width: 80 },
  podiumFirst: { marginBottom: 0 },
  crownIcon: { fontSize: 20, marginBottom: spacing.xs },
  podiumName: { color: colors.grayLight, fontSize: 11, textAlign: 'center', marginTop: spacing.xs },
  podiumNameFirst: { color: colors.white, fontWeight: 'bold' },
  podiumStat: { color: colors.gray, fontSize: 13, fontWeight: 'bold' },
  podiumStatFirst: { color: colors.gold, fontSize: 16 },
  podiumBlock: {
    width: '100%',
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  podiumRank: { color: colors.dark, fontWeight: 'bold', fontSize: 16 },

  // Avatar
  avatar: {
    borderWidth: 2,
    backgroundColor: colors.darkBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.gold, fontWeight: 'bold' },

  // Table
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
  },
  tableHeaderText: {
    color: colors.gray,
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
    width: 40,
    textAlign: 'center',
  },

  // Rank row
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    gap: spacing.sm,
    marginBottom: 2,
  },
  rankRowMe: {
    backgroundColor: colors.goldDim,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  rankNum: { width: 28, textAlign: 'center', color: colors.gray, fontSize: 13, fontWeight: 'bold' },
  rankNumTop: { color: colors.gold },
  rankInfo: { flex: 1 },
  rankName: { color: colors.white, fontSize: 14, fontWeight: '600' },
  rankNameMe: { color: colors.gold },
  rankPosition: { color: colors.gray, fontSize: 11, marginTop: 1 },
  rankStats: { alignItems: 'center', minWidth: 40 },
  rankStatVal: { color: colors.white, fontSize: 16, fontWeight: 'bold' },
  rankStatValMe: { color: colors.gold },
  rankStatLabel: { color: colors.gray, fontSize: 10 },

  divider: { height: 1, backgroundColor: colors.darkBorder, marginVertical: spacing.sm },
  listContent: { padding: spacing.md, paddingBottom: spacing.xxl },

  // Me footer
  meFooter: {
    alignItems: 'center',
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.darkBorder,
    marginTop: spacing.sm,
  },
  meFooterText: { color: colors.gold, fontSize: 13 },

  // States
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  errorText: { color: colors.error, marginBottom: spacing.md },
  retryBtn: { padding: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.darkCard, borderRadius: radius.md },
  retryText: { color: colors.gold },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyText: { color: colors.white, fontSize: 18, fontWeight: 'bold' },
  emptySubText: { color: colors.gray, fontSize: 13, marginTop: spacing.xs },
});

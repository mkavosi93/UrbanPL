import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform,
  ActivityIndicator, Modal,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, spacing, radius } from '../theme';

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDate(iso) {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return 'Today';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function GameChat({ gameId, gameLocation, playerId, playerName, isAdmin, visible, onClose }) {
  const [messages, setMessages]   = useState([]);
  const [text, setText]           = useState('');
  const [loading, setLoading]     = useState(true);
  const [sending, setSending]     = useState(false);
  const flatListRef               = useRef(null);

  // Load initial messages
  useEffect(() => {
    if (!visible || !gameId) return;
    setLoading(true);
    setMessages([]);

    supabase
      .from('messages')
      .select('id, text, created_at, player_id, players(first_name, last_name, name, is_admin, role)')
      .eq('game_id', gameId)
      .order('created_at', { ascending: true })
      .limit(100)
      .then(({ data }) => {
        setMessages(data || []);
        setLoading(false);
      });

    // Real-time subscription
    const channel = supabase
      .channel(`game-chat-${gameId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `game_id=eq.${gameId}` },
        async (payload) => {
          // Fetch full message with player info
          const { data } = await supabase
            .from('messages')
            .select('id, text, created_at, player_id, players(first_name, last_name, name, is_admin, role)')
            .eq('id', payload.new.id)
            .single();
          if (data) setMessages(prev => [...prev, data]);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [gameId, visible]);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText('');
    await supabase.from('messages').insert({
      game_id: gameId,
      player_id: playerId,
      text: trimmed,
    });
    setSending(false);
  }

  function senderName(msg) {
    const p = msg.players;
    return [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.name || 'Unknown';
  }

  function renderMessage({ item, index }) {
    const isMine = item.player_id === playerId;
    const senderIsAdmin = item.players?.is_admin;
    const senderIsReferee = item.players?.role === 'Referee';
    const name = senderName(item);

    // Show date separator
    const showDate = index === 0 || formatDate(item.created_at) !== formatDate(messages[index - 1]?.created_at);
    const showSender = !isMine && (index === 0 || messages[index - 1]?.player_id !== item.player_id);

    return (
      <>
        {showDate && (
          <View style={styles.dateSep}>
            <Text style={styles.dateSepText}>{formatDate(item.created_at)}</Text>
          </View>
        )}
        <View style={[styles.msgRow, isMine && styles.msgRowMine]}>
          <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
            {!isMine && showSender && (
              <View style={styles.senderRow}>
                <Text style={[
                  styles.senderName,
                  senderIsAdmin && styles.senderAdmin,
                  senderIsReferee && styles.senderReferee,
                ]}>
                  {senderIsAdmin ? '⚙️ ' : senderIsReferee ? '🟨 ' : ''}{name}
                </Text>
              </View>
            )}
            <Text style={[styles.msgText, isMine && styles.msgTextMine]}>{item.text}</Text>
            <Text style={[styles.msgTime, isMine && styles.msgTimeMine]}>{formatTime(item.created_at)}</Text>
          </View>
        </View>
      </>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              💬 {gameLocation?.split(',')[0] || 'Game Chat'}
            </Text>
            {isAdmin && <Text style={styles.headerSub}>Admin · all messages visible</Text>}
          </View>
        </View>

        {/* Messages */}
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.gold} size="large" />
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={item => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.messageList}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyIcon}>💬</Text>
                <Text style={styles.emptyText}>No messages yet.</Text>
                <Text style={styles.emptyHint}>Be the first to say something!</Text>
              </View>
            }
          />
        )}

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder="Message..."
            placeholderTextColor={colors.gray}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={send}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
            onPress={send}
            disabled={!text.trim() || sending}
          >
            {sending
              ? <ActivityIndicator color={colors.dark} size="small" />
              : <Text style={styles.sendBtnText}>↑</Text>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.dark },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.darkCard,
    borderBottomWidth: 1, borderBottomColor: colors.darkBorder,
    paddingTop: Platform.OS === 'ios' ? 54 : 16,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.dark,
    alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { color: colors.gray, fontSize: 16 },
  headerCenter: { flex: 1 },
  headerTitle: { color: colors.white, fontWeight: '700', fontSize: 16 },
  headerSub: { color: colors.gold, fontSize: 11, marginTop: 2 },

  // Messages
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  messageList: { padding: spacing.md, paddingBottom: spacing.xl },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 40, marginBottom: spacing.md },
  emptyText: { color: colors.white, fontSize: 16, fontWeight: '600' },
  emptyHint: { color: colors.gray, fontSize: 13, marginTop: 4 },

  // Date separator
  dateSep: { alignItems: 'center', marginVertical: spacing.md },
  dateSepText: {
    color: colors.gray, fontSize: 11, fontWeight: '600',
    backgroundColor: colors.darkCard,
    paddingVertical: 2, paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
  },

  // Message rows
  msgRow: { flexDirection: 'row', marginBottom: spacing.xs },
  msgRowMine: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '78%', borderRadius: radius.lg,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
  },
  bubbleMine: { backgroundColor: colors.gold, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.darkCard, borderBottomLeftRadius: 4 },

  senderRow: { marginBottom: 2 },
  senderName: { fontSize: 11, fontWeight: '700', color: colors.grayLight },
  senderAdmin: { color: colors.gold },
  senderReferee: { color: '#4fc3f7' },

  msgText: { color: colors.dark, fontSize: 14, lineHeight: 20 },
  msgTextMine: { color: colors.dark },
  msgTime: { fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 3, textAlign: 'right' },
  msgTimeMine: { color: 'rgba(0,0,0,0.4)' },

  // Input
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    padding: spacing.sm, gap: spacing.sm,
    backgroundColor: colors.darkCard,
    borderTopWidth: 1, borderTopColor: colors.darkBorder,
  },
  input: {
    flex: 1, backgroundColor: colors.dark,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.darkBorder,
    color: colors.white, fontSize: 14,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.gold,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: colors.dark, fontSize: 20, fontWeight: 'bold', lineHeight: 22 },
});

import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';

// How notifications appear when the app is open
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// ─── Register & store push token ─────────────────────────────────────────────
export async function registerForNotifications(playerId) {
  if (Platform.OS === 'web') return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  // Get Expo push token and store in DB so server can send push notifications
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;

    if (playerId && token) {
      await supabase
        .from('players')
        .update({ push_token: token })
        .eq('id', playerId);
    }

    return token;
  } catch (err) {
    console.warn('Push token registration failed:', err.message);
    return null;
  }
}

// ─── Schedule reminders for a joined game ────────────────────────────────────
export async function scheduleGameReminders(game) {
  if (Platform.OS === 'web') return;

  const kickoff = new Date(game.kickoff_time);
  const now = new Date();
  const location = game.location?.split(',')[0] || 'the pitch';
  const timeStr = kickoff.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
  const dateStr = kickoff.toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  });

  const ids = [];

  // 24-hour reminder
  const dayBefore = new Date(kickoff.getTime() - 24 * 60 * 60 * 1000);
  if (dayBefore > now) {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Game Tomorrow!',
        body: `You're playing at ${location} on ${dateStr} at ${timeStr}. Get your boots ready!`,
        data: { gameId: game.id },
      },
      trigger: { type: 'date', date: dayBefore },
    });
    ids.push(id);
  }

  // 2-hour reminder
  const twoHoursBefore = new Date(kickoff.getTime() - 2 * 60 * 60 * 1000);
  if (twoHoursBefore > now) {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Game in 2 Hours!',
        body: `Head to ${location} — kickoff at ${timeStr}. Check the app for your team!`,
        data: { gameId: game.id },
      },
      trigger: { type: 'date', date: twoHoursBefore },
    });
    ids.push(id);
  }

  // 1-hour reminder
  const oneHourBefore = new Date(kickoff.getTime() - 60 * 60 * 1000);
  if (oneHourBefore > now) {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Game in 1 Hour!',
        body: `Get ready — kickoff at ${location} at ${timeStr}. See you on the pitch!`,
        data: { gameId: game.id },
      },
      trigger: { type: 'date', date: oneHourBefore },
    });
    ids.push(id);
  }

  // Save the notification IDs so we can cancel them later
  if (ids.length > 0) {
    await SecureStore.setItemAsync(`notif_${game.id}`, JSON.stringify(ids));
  }
}

// ─── Cancel reminders if player leaves a game ────────────────────────────────
export async function cancelGameReminders(gameId) {
  if (Platform.OS === 'web') return;

  try {
    const stored = await SecureStore.getItemAsync(`notif_${gameId}`);
    if (stored) {
      const ids = JSON.parse(stored);
      await Promise.all(ids.map(id => Notifications.cancelScheduledNotificationAsync(id)));
      await SecureStore.deleteItemAsync(`notif_${gameId}`);
    }
  } catch (_) {}
}

// ─── Cancel ALL scheduled notifications (on sign out) ────────────────────────
export async function cancelAllNotifications() {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}

// ─── Clear badge count (call on app foreground) ──────────────────────────────
export async function clearBadge() {
  if (Platform.OS === 'web') return;
  await Notifications.setBadgeCountAsync(0);
}

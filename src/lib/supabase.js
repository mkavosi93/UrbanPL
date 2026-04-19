import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const SUPABASE_URL = 'https://zprtghdcmiavtoaltlld.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_pIvDj_GDPaQ9rLSSw6rBJQ_FFzoQLKI';

// Use SecureStore on iOS/Android, localStorage on web
const storage = Platform.OS === 'web'
  ? undefined // Supabase uses localStorage by default on web
  : {
      getItem: (key) => SecureStore.getItemAsync(key),
      setItem: (key, value) => SecureStore.setItemAsync(key, value),
      removeItem: (key) => SecureStore.deleteItemAsync(key),
    };

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    ...(storage ? { storage } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { registerForNotifications, cancelAllNotifications } from '../lib/notifications';

const AuthContext = createContext({});

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [player, setPlayer] = useState(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerError, setPlayerError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchPlayer(session.user.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
        setSession(session);
        return;
      }
      setSession(session);
      if (session) {
        fetchPlayer(session.user.id);
        registerForNotifications(session.user.id);
      } else {
        setPlayer(null);
        setPlayerError(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchPlayer(userId) {
    setPlayerLoading(true);
    setPlayerError(false);
    try {
      const { data, error } = await supabase
        .from('players')
        .select('*')
        .eq('id', userId)
        .maybeSingle(); // maybeSingle returns null without error when no row found
      if (error) throw error;
      if (data) {
        setPlayer(data);
      } else {
        // Authenticated but no player row yet — retry once after 1.5s
        // (signup flow may still be inserting the row)
        setTimeout(async () => {
          const { data: retryData } = await supabase
            .from('players')
            .select('*')
            .eq('id', userId)
            .maybeSingle();
          if (retryData) {
            setPlayer(retryData);
          } else {
            setPlayerError(true); // Signal the UI to show an error state
          }
          setPlayerLoading(false);
        }, 1500);
        return;
      }
    } catch {
      setPlayerError(true);
    } finally {
      setPlayerLoading(false);
    }
  }

  async function signOut() {
    await cancelAllNotifications();
    await supabase.auth.signOut();
    setPlayer(null);
    setPlayerError(false);
    setSession(null);
  }

  return (
    <AuthContext.Provider value={{
      session, player, loading, playerLoading, playerError,
      signOut, fetchPlayer, isPasswordRecovery, setIsPasswordRecovery,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

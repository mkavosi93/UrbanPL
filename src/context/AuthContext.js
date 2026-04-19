import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { registerForNotifications, cancelAllNotifications } from '../lib/notifications';

const AuthContext = createContext({});

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [player, setPlayer] = useState(null);
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
        registerForNotifications();
      } else {
        setPlayer(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchPlayer(userId) {
    const { data } = await supabase
      .from('players')
      .select('*')
      .eq('id', userId)
      .single();
    setPlayer(data);
  }

  async function signOut() {
    await cancelAllNotifications();
    await supabase.auth.signOut();
    setPlayer(null);
    setSession(null);
  }

  return (
    <AuthContext.Provider value={{ session, player, loading, signOut, fetchPlayer, isPasswordRecovery, setIsPasswordRecovery }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

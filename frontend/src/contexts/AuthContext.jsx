import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [comercioId, setComercioId] = useState(null);

  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchComercioId(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchComercioId(session.user.id);
      } else {
        setComercioId(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchComercioId = async (userId) => {
    try {
      if (userId === 'mock-tester') {
        setComercioId('mock-comercio-123');
        return;
      }
      
      const { data, error } = await supabase
        .from('comercios')
        .select('*')
        .eq('user_id', userId)
        .limit(1)
        .single();
      
      if (!error && data) {
        setComercioId(data.id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email, password) => {
    return supabase.auth.signInWithPassword({ email, password });
  };

  const loginAsTest = () => {
    // Override simulation for testing the UI
    setUser({ id: 'mock-tester', email: 'test@comercio.local' });
    setComercioId('test-comercio-id');
    setLoading(false);
    return { error: null };
  };

  const signOut = () => {
    if (user && user.id === 'mock-tester') {
      setUser(null);
      setComercioId(null);
      return;
    }
    return supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, comercioId, loading, signIn, signOut, loginAsTest }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

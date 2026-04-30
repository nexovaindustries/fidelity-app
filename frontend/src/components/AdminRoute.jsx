import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const AdminRoute = ({ children }) => {
  const [status, setStatus] = useState('checking'); // 'checking' | 'ok' | 'denied' | 'unauthenticated'

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setStatus('unauthenticated'); return; }

      try {
        const res = await fetch(`${API_URL}/api/admin/check`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        setStatus(res.ok ? 'ok' : 'denied');
      } catch {
        setStatus('denied');
      }
    };
    check();
  }, []);

  if (status === 'checking') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0a0f' }}>
        <div style={{ width: '40px', height: '40px', borderRadius: '50%', border: '3px solid #6366f1', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
      </div>
    );
  }

  if (status === 'unauthenticated') return <Navigate to="/login" replace />;
  if (status === 'denied') return <Navigate to="/" replace />;

  return children;
};

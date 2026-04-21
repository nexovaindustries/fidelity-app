import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { Lock, User } from 'lucide-react';

// Admin usa email real (@gmail etc). Los negocios usan solo su nombre de usuario.
const resolveEmail = (input) => {
  if (!input) return '';
  if (input.includes('@')) return input; // admin con email real
  return `${input.toLowerCase()}@nexova.app`; // negocio: siempre minúsculas
};

export default function Login() {
  const { signIn, user } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Leer directamente del DOM para evitar problemas con el autocompletado de Google
    const formUsername = e.target.username?.value || username;
    const formPassword = e.target.password?.value || password;

    const email = resolveEmail(formUsername.trim());
    const { error: signInError } = await signIn(email, formPassword);

    if (signInError) {
      console.error(signInError);
      setError('Usuario o contraseña incorrectos.');
    }

    setLoading(false);
  };

  return (
    <div className="flex-center" style={{ minHeight: '100vh', width: '100vw', backgroundColor: 'var(--bg-primary)' }}>
      <div className="bg-glow-orb" />
      <div className="bg-glow-orb-secondary" />

      <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '400px', zIndex: 10 }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>
            <span style={{ color: 'var(--accent-primary)' }}>✦</span> Fidelity
          </h1>
          <p className="page-subtitle">Portal B2B — Nexova Industries</p>
        </div>

        <form onSubmit={handleLogin}>
          <div className="input-group">
            <label className="input-label" htmlFor="username">Usuario</label>
            <div style={{ position: 'relative' }}>
              <User size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                id="username"
                name="username"
                type="text"
                className="input-field"
                placeholder="Ej. Arly.helados"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                style={{ paddingLeft: '2.75rem' }}
              />
            </div>
          </div>

          <div className="input-group" style={{ marginBottom: '1.5rem' }}>
            <label className="input-label" htmlFor="password">Contraseña</label>
            <div style={{ position: 'relative' }}>
              <Lock size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                id="password"
                name="password"
                type="password"
                className="input-field"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                style={{ paddingLeft: '2.75rem' }}
              />
            </div>
          </div>

          {error && (
            <div style={{ padding: '0.75rem', backgroundColor: 'rgba(239,68,68,0.1)', color: 'var(--error)', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '0.875rem' }}
            disabled={loading}
          >
            {loading ? 'Entrando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}

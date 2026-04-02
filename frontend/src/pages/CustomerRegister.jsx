import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// Minimal inline styles for maximum compatibility (no auth needed, public page)
const s = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1.5rem',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    borderRadius: '24px',
    overflow: 'hidden',
    boxShadow: '0 25px 60px rgba(0,0,0,0.3)',
  },
  header: {
    padding: '2rem 2rem 1.5rem',
    textAlign: 'center',
  },
  logo: {
    width: '72px',
    height: '72px',
    objectFit: 'contain',
    marginBottom: '1rem',
  },
  title: {
    margin: 0,
    fontSize: '1.5rem',
    fontWeight: 800,
    letterSpacing: '-0.02em',
  },
  subtitle: {
    margin: '0.5rem 0 0',
    fontSize: '0.9rem',
    opacity: 0.75,
  },
  form: {
    padding: '0 2rem 2rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  label: {
    fontSize: '0.8rem',
    fontWeight: 600,
    display: 'block',
    marginBottom: '0.4rem',
    opacity: 0.8,
  },
  input: {
    width: '100%',
    padding: '0.875rem 1rem',
    borderRadius: '12px',
    border: '2px solid transparent',
    fontSize: '1rem',
    fontFamily: 'inherit',
    outline: 'none',
    transition: 'border-color 0.2s',
    boxSizing: 'border-box',
  },
  btn: {
    width: '100%',
    padding: '1rem',
    borderRadius: '14px',
    border: 'none',
    fontSize: '1.05rem',
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'transform 0.15s, opacity 0.2s',
    letterSpacing: '-0.01em',
  },
  walletBtns: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    padding: '0 2rem 2rem',
  },
  walletBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
    padding: '1rem',
    borderRadius: '14px',
    border: 'none',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'transform 0.15s',
  },
  successIcon: {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 1.5rem',
    fontSize: '2.5rem',
  },
  error: {
    padding: '0.75rem 1rem',
    borderRadius: '12px',
    fontSize: '0.85rem',
    textAlign: 'center',
  },
  footer: {
    textAlign: 'center',
    padding: '1.5rem',
    fontSize: '0.75rem',
    opacity: 0.5,
  }
};

export default function CustomerRegister() {
  const { comercioId } = useParams();
  const [comercio, setComercio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [tarjetaId, setTarjetaId] = useState(null);
  const [qrValue, setQrValue] = useState('');
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({ nombre: '', celular: '' });

  useEffect(() => {
    const load = async () => {
      const { data, error: err } = await supabase
        .from('comercios')
        .select('id, nombre, logo_url, color_fondo, color_texto, color_acento, tipo_fidelizacion, texto_personalizado, logo_shape, logo_size')
        .eq('id', comercioId)
        .single();

      if (err || !data) {
        setError('Este programa de fidelidad no existe o el enlace es inválido.');
      } else {
        setComercio(data);
      }
      setLoading(false);
    };
    load();
  }, [comercioId]);

  const getLogoRadius = () => {
    switch (comercio?.logo_shape) {
      case 'circle': return '50%';
      case 'rounded': return '12px';
      default: return '6px';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!form.nombre.trim() || !form.celular.trim()) {
      setError('Por favor completa todos los campos.');
      return;
    }

    const cleanPhone = form.celular.replace(/\D/g, '');
    if (cleanPhone.length < 7) {
      setError('Ingresa un número de celular válido.');
      return;
    }

    setSubmitting(true);

    try {
      const { data: existingClients } = await supabase
        .from('clientes')
        .select('id')
        .eq('telefono', cleanPhone)
        .limit(1);

      let clienteId;

      if (existingClients && existingClients.length > 0) {
        clienteId = existingClients[0].id;
      } else {
        const { data: newClient, error: clientErr } = await supabase
          .from('clientes')
          .insert({
            nombre_completo: form.nombre.trim(),
            telefono: cleanPhone,
            email: `${cleanPhone}@fidelity.customer`,
          })
          .select('id')
          .single();

        if (clientErr) throw clientErr;
        clienteId = newClient.id;
      }

      const { data: existingCards } = await supabase
        .from('tarjetas_activas')
        .select('id, qr_value')
        .eq('comercio_id', comercioId)
        .eq('cliente_id', clienteId)
        .limit(1);

      if (existingCards && existingCards.length > 0) {
        setTarjetaId(existingCards[0].id);
        setQrValue(existingCards[0].qr_value);
        setSuccess(true);
        setSubmitting(false);
        return;
      }

      const newQrValue = `FID-${comercioId.slice(0,8)}-${clienteId.slice(0,8)}-${Date.now().toString(36)}`;
      
      const { data: tarjeta, error: tarjetaErr } = await supabase
        .from('tarjetas_activas')
        .insert({
          comercio_id: comercioId,
          cliente_id: clienteId,
          qr_value: newQrValue,
          puntos_actuales: 0,
          total_sellos: 0,
          nivel_actual: 'Bronce',
        })
        .select('id')
        .single();

      if (tarjetaErr) throw tarjetaErr;

      setTarjetaId(tarjeta.id);
      setQrValue(newQrValue);
      setSuccess(true);

    } catch (err) {
      console.error('Registration error:', err);
      setError('Hubo un error al registrarte. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  // ──── GOOGLE WALLET HANDLER ────
  const handleGoogleWallet = async () => {
    setWalletLoading(true);
    setWalletError('');
    try {
      const res = await fetch('/api/wallet/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tarjetaId,
          comercioNombre: comercio.nombre,
          clienteNombre: form.nombre,
          qrValue,
          tipoFidelizacion: comercio.tipo_fidelizacion,
          puntos: 0,
          sellos: 0,
          nivel: 'Bronce',
          colorFondo: comercio.color_fondo,
          logoUrl: comercio.logo_url?.startsWith('http') ? comercio.logo_url : null,
        }),
      });

      const data = await res.json();
      
      if (data.url) {
        window.location.href = data.url;
      } else {
        setWalletError(data.error || 'No se pudo generar la tarjeta.');
      }
    } catch (err) {
      console.error('Google Wallet error:', err);
      setWalletError('Error al conectar con Google Wallet.');
    } finally {
      setWalletLoading(false);
    }
  };

  // ──── LOADING STATE ────
  if (loading) {
    return (
      <div style={{ ...s.page, background: '#0a0a1a', color: '#fff' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '40px', height: '40px', border: '3px solid rgba(255,255,255,0.1)',
            borderTopColor: '#e94560', borderRadius: '50%',
            animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem',
          }} />
          <p style={{ opacity: 0.6, fontSize: '0.9rem' }}>Cargando programa...</p>
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  // ──── ERROR: COMERCIO NOT FOUND ────
  if (!comercio) {
    return (
      <div style={{ ...s.page, background: '#0a0a1a', color: '#fff' }}>
        <div style={{ textAlign: 'center', maxWidth: '360px' }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🔍</div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.5rem' }}>Enlace inválido</h2>
          <p style={{ opacity: 0.6, fontSize: '0.9rem', lineHeight: 1.6 }}>{error || 'Este programa de fidelidad no fue encontrado.'}</p>
        </div>
      </div>
    );
  }

  const bg = comercio.color_fondo || '#1a1a2e';
  const fg = comercio.color_texto || '#e0e0e0';
  const accent = comercio.color_acento || '#e94560';
  const inputBg = `${fg}15`;
  const inputBorder = `${fg}25`;

  // ──── SUCCESS STATE (after registration) ────
  if (success) {
    return (
      <div style={{ ...s.page, background: `linear-gradient(135deg, ${bg}, ${adjustColor(bg, -20)})`, color: fg }}>
        <div style={{ ...s.card, background: `${bg}dd`, backdropFilter: 'blur(20px)', border: `1px solid ${fg}15` }}>
          <div style={{ padding: '2.5rem 2rem', textAlign: 'center' }}>
            <div style={{ 
              ...s.successIcon, 
              background: `${accent}20`, 
              border: `2px solid ${accent}50`,
              animation: 'popIn 0.5s cubic-bezier(0.68,-0.55,0.27,1.55)',
            }}>
              ✅
            </div>
            <h2 style={{ ...s.title, color: fg, marginBottom: '0.5rem' }}>¡Tarjeta Activada!</h2>
            <p style={{ ...s.subtitle, color: fg }}>
              Tu tarjeta de fidelidad de <strong>{comercio.nombre}</strong> ya está activa.
            </p>
          </div>

          {/* Wallet Buttons */}
          <div style={s.walletBtns}>
            <button
              style={{ ...s.walletBtn, background: '#000', color: '#fff' }}
              onClick={() => {
                alert('🍎 Apple Wallet requiere configuración de certificados. Contacta al administrador.');
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
              Añadir a Apple Wallet
            </button>
            <button
              style={{ 
                ...s.walletBtn, 
                background: '#fff', 
                color: '#1a1a1a',
                boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
                opacity: walletLoading ? 0.7 : 1,
              }}
              onClick={handleGoogleWallet}
              disabled={walletLoading}
            >
              {walletLoading ? (
                <>⏳ Generando...</>
              ) : (
                <>
                  <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                  Añadir a Google Wallet
                </>
              )}
            </button>
          </div>

          {walletError && (
            <div style={{ padding: '0.5rem 2rem 1rem', textAlign: 'center' }}>
              <p style={{ fontSize: '0.8rem', color: '#ef4444' }}>{walletError}</p>
            </div>
          )}

          <div style={{ padding: '0 2rem 1.5rem', textAlign: 'center' }}>
            <p style={{ fontSize: '0.8rem', opacity: 0.5, lineHeight: 1.5 }}>
              Tu tarjeta fue registrada exitosamente. Presenta tu QR en cada visita para acumular {comercio.tipo_fidelizacion || 'puntos'}.
            </p>
          </div>
        </div>

        <div style={s.footer}>
          <span style={{ color: fg }}>Impulsado por</span>{' '}
          <strong style={{ color: accent }}>Fidelity B2B</strong>
        </div>

        <style>{`
          @keyframes popIn {
            0% { transform: scale(0); opacity: 0; }
            100% { transform: scale(1); opacity: 1; }
          }
        `}</style>
      </div>
    );
  }

  // ──── REGISTRATION FORM ────
  return (
    <div style={{ ...s.page, background: `linear-gradient(135deg, ${bg}, ${adjustColor(bg, -20)})`, color: fg }}>
      <div style={{ ...s.card, background: `${bg}dd`, backdropFilter: 'blur(20px)', border: `1px solid ${fg}15` }}>
        
        {/* Header with branding */}
        <div style={s.header}>
          {comercio.logo_url ? (
            <img 
              src={comercio.logo_url} 
              alt={comercio.nombre} 
              style={{ 
                ...s.logo, 
                borderRadius: getLogoRadius(),
                width: `${comercio.logo_size || 72}px`,
                height: `${comercio.logo_size || 72}px`,
              }} 
            />
          ) : (
            <div style={{
              ...s.logo,
              background: `${accent}20`,
              border: `2px solid ${accent}40`,
              borderRadius: getLogoRadius(),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.8rem',
              margin: '0 auto 1rem',
            }}>
              {comercio.nombre?.charAt(0) || '⭐'}
            </div>
          )}
          <h1 style={{ ...s.title, color: fg }}>{comercio.nombre}</h1>
          <p style={{ ...s.subtitle, color: fg }}>
            {comercio.texto_personalizado || `Únete a nuestro programa de ${comercio.tipo_fidelizacion || 'puntos'} y gana recompensas`}
          </p>
        </div>

        {/* Type indicator badge */}
        <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.4rem 1rem',
            borderRadius: '100px',
            fontSize: '0.8rem',
            fontWeight: 600,
            background: `${accent}20`,
            color: accent,
            border: `1px solid ${accent}35`,
          }}>
            {comercio.tipo_fidelizacion === 'sellos' ? '🎯 Programa de Sellos' :
             comercio.tipo_fidelizacion === 'niveles' ? '🏆 Programa de Niveles' :
             '⭐ Programa de Puntos'}
          </span>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={s.form}>
          <div>
            <label style={{ ...s.label, color: fg }}>Nombre completo</label>
            <input
              type="text"
              placeholder="Juan Pérez"
              value={form.nombre}
              onChange={(e) => setForm(prev => ({ ...prev, nombre: e.target.value }))}
              style={{
                ...s.input,
                background: inputBg,
                borderColor: inputBorder,
                color: fg,
              }}
              required
              autoComplete="name"
            />
          </div>
          <div>
            <label style={{ ...s.label, color: fg }}>Número de celular</label>
            <input
              type="tel"
              placeholder="+52 55 1234 5678"
              value={form.celular}
              onChange={(e) => setForm(prev => ({ ...prev, celular: e.target.value }))}
              style={{
                ...s.input,
                background: inputBg,
                borderColor: inputBorder,
                color: fg,
              }}
              required
              autoComplete="tel"
            />
          </div>

          {error && (
            <div style={{ ...s.error, background: '#ef444420', color: '#ef4444', border: '1px solid #ef444430' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              ...s.btn,
              background: accent,
              color: getContrastColor(accent),
              opacity: submitting ? 0.7 : 1,
              marginTop: '0.5rem',
            }}
          >
            {submitting ? '⏳ Registrando...' : '🎉 ¡Unirme al Programa!'}
          </button>
        </form>

        <div style={{ padding: '0.5rem 2rem 1.5rem', textAlign: 'center' }}>
          <p style={{ fontSize: '0.75rem', opacity: 0.4, lineHeight: 1.5 }}>
            Al registrarte aceptas recibir información sobre tu programa de lealtad.
          </p>
        </div>
      </div>

      <div style={s.footer}>
        <span style={{ color: fg }}>Impulsado por</span>{' '}
        <strong style={{ color: accent }}>Fidelity B2B</strong>
      </div>
    </div>
  );
}

// ──── HELPERS ────
function adjustColor(hex, amount) {
  try {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const num = parseInt(hex, 16);
    let r = Math.min(255, Math.max(0, (num >> 16) + amount));
    let g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
    let b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
  } catch { return hex; }
}

function getContrastColor(hex) {
  try {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#1a1a1a' : '#ffffff';
  } catch { return '#ffffff'; }
}

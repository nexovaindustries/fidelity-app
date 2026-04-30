import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  Building2, Users, CreditCard, Plus, Trash2, Eye, Loader2,
  Copy, Check, RefreshCw, LogOut, ShieldCheck, X, AlertTriangle,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function adminFetch(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
      ...(options.headers || {}),
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Error del servidor');
  return json;
}

function generatePassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

const TIPO_LABELS = {
  puntos: '🎯 Puntos',
  sellos: '📮 Sellos',
  niveles: '🏆 Niveles',
};

// ─── Modal: Crear Nuevo Negocio ─────────────────────────────────────────────
function CreateModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    nombre: '', username: '', password: generatePassword(),
    tipo_fidelizacion: 'puntos', slogan: '', telefono: '', sitio_web: '',
    meta_sellos: 10, puntos_para_recompensa: 100, descripcion_recompensa: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState({});

  const set = (field, val) => setForm(prev => ({ ...prev, [field]: val }));

  const handleCopy = async (text, key) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(prev => ({ ...prev, [key]: true }));
    setTimeout(() => setCopied(prev => ({ ...prev, [key]: false })), 2000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await adminFetch('/api/admin/comercios', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setResult(data);
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem',
    }}>
      <div style={{
        background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
        borderRadius: '20px', width: '100%', maxWidth: '540px', maxHeight: '90vh',
        overflowY: 'auto', padding: '2rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>
            <Plus size={18} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: 'var(--accent-primary)' }} />
            Crear Nuevo Negocio
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}>
            <X size={22} />
          </button>
        </div>

        {result ? (
          /* ── Credenciales creadas ── */
          <div>
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'var(--success-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem' }}>
                <Check size={28} style={{ color: 'var(--success)' }} />
              </div>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>¡Negocio creado!</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>Comparte estas credenciales con el cliente.</p>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1.25rem', marginBottom: '1rem' }}>
              {[
                { label: 'Negocio', value: result.comercio.nombre },
                { label: 'Usuario', value: result.credentials.username, key: 'user' },
                { label: 'Contraseña', value: result.credentials.password, key: 'pass', mono: true },
              ].map(({ label, value, key, mono }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '2px' }}>{label}</div>
                    <div style={{ fontFamily: mono ? 'monospace' : 'inherit', fontWeight: 600, fontSize: '0.9rem' }}>{value}</div>
                  </div>
                  {key && (
                    <button
                      onClick={() => handleCopy(value, key)}
                      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.4rem 0.75rem', cursor: 'pointer', color: copied[key] ? 'var(--success)' : 'var(--text-secondary)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                    >
                      {copied[key] ? <Check size={13} /> : <Copy size={13} />}
                      {copied[key] ? 'Copiado' : 'Copiar'}
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setResult(null); setForm({ nombre: '', username: '', password: generatePassword(), tipo_fidelizacion: 'puntos', slogan: '', telefono: '', sitio_web: '', meta_sellos: 10, puntos_para_recompensa: 100, descripcion_recompensa: '' }); }}>
                <Plus size={16} /> Crear otro
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={onClose}>
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          /* ── Formulario ── */
          <form onSubmit={handleSubmit}>
            {error && (
              <div style={{ padding: '0.75rem 1rem', background: 'var(--error-bg)', color: 'var(--error)', borderRadius: '10px', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <AlertTriangle size={16} /> {error}
              </div>
            )}

            <div style={{ display: 'grid', gap: '1rem' }}>
              <div className="input-group">
                <label className="input-label">Nombre del Negocio *</label>
                <input className="input-field" required value={form.nombre} onChange={e => set('nombre', e.target.value)} placeholder="Ej. Café Supremo" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="input-group">
                  <label className="input-label">Usuario (login) *</label>
                  <input className="input-field" type="text" required value={form.username} onChange={e => set('username', e.target.value)} placeholder="Ej. Arly.helados" pattern="[a-zA-Z0-9._-]+" title="Solo letras, números, puntos y guiones" />
                  <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Sin espacios. Ej: Cafe.Roma, PizzeriaLuna</p>
                </div>
                <div className="input-group">
                  <label className="input-label">Contraseña Temporal *</label>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <input className="input-field" required value={form.password} onChange={e => set('password', e.target.value)} style={{ fontFamily: 'monospace', fontSize: '0.82rem', flex: 1 }} />
                    <button type="button" onClick={() => set('password', generatePassword())} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0 0.6rem', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }} title="Generar nueva">
                      <RefreshCw size={14} />
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="input-group">
                  <label className="input-label">Tipo de Fidelización</label>
                  <select className="input-field" value={form.tipo_fidelizacion} onChange={e => set('tipo_fidelizacion', e.target.value)}>
                    <option value="puntos">🎯 Puntos</option>
                    <option value="sellos">📮 Sellos</option>
                    <option value="niveles">🏆 Niveles</option>
                  </select>
                </div>
                <div className="input-group">
                  <label className="input-label">
                    {form.tipo_fidelizacion === 'sellos' ? 'Meta de Sellos' : 'Puntos para Recompensa'}
                  </label>
                  <input
                    className="input-field" type="number" min="1"
                    value={form.tipo_fidelizacion === 'sellos' ? form.meta_sellos : form.puntos_para_recompensa}
                    onChange={e => form.tipo_fidelizacion === 'sellos'
                      ? set('meta_sellos', parseInt(e.target.value) || 10)
                      : set('puntos_para_recompensa', parseInt(e.target.value) || 100)
                    }
                  />
                </div>
              </div>

              <div className="input-group">
                <label className="input-label">Slogan <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(opcional)</span></label>
                <input className="input-field" value={form.slogan} onChange={e => set('slogan', e.target.value)} placeholder="Ej. El mejor café de la ciudad" maxLength={60} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="input-group">
                  <label className="input-label">Teléfono</label>
                  <input className="input-field" type="tel" value={form.telefono} onChange={e => set('telefono', e.target.value)} placeholder="+51 999 000 000" />
                </div>
                <div className="input-group">
                  <label className="input-label">Sitio Web</label>
                  <input className="input-field" type="url" value={form.sitio_web} onChange={e => set('sitio_web', e.target.value)} placeholder="https://..." />
                </div>
              </div>

              <div className="input-group">
                <label className="input-label">Descripción de Recompensa</label>
                <textarea className="input-field" value={form.descripcion_recompensa} onChange={e => set('descripcion_recompensa', e.target.value)} placeholder="Ej. Café gratis al completar 10 sellos" style={{ resize: 'vertical', minHeight: '56px' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose} disabled={loading}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
                {loading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={16} />}
                {loading ? 'Creando...' : 'Crear Negocio'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Modal: Confirmar Eliminación ────────────────────────────────────────────
function DeleteModal({ comercio, onClose, onDeleted }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    setLoading(true);
    try {
      await adminFetch(`/api/admin/comercios/${comercio.id}`, { method: 'DELETE' });
      onDeleted();
      onClose();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: '20px', width: '100%', maxWidth: '420px', padding: '2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'var(--error-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
            <Trash2 size={24} style={{ color: 'var(--error)' }} />
          </div>
          <h3 style={{ margin: '0 0 0.5rem' }}>Eliminar Negocio</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
            ¿Seguro que quieres eliminar <strong>{comercio.nombre}</strong>? Se borrará el usuario, todas las tarjetas y el historial. Esta acción no se puede deshacer.
          </p>
        </div>
        {error && <div style={{ padding: '0.75rem', background: 'var(--error-bg)', color: 'var(--error)', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '1rem' }}>{error}</div>}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose} disabled={loading}>Cancelar</button>
          <button className="btn btn-danger" style={{ flex: 1 }} onClick={handleDelete} disabled={loading}>
            {loading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={16} />}
            {loading ? 'Eliminando...' : 'Sí, eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página Principal Admin ──────────────────────────────────────────────────
export default function AdminDashboard() {
  const [stats, setStats] = useState({ totalComercios: 0, totalTarjetas: 0, totalClientes: 0 });
  const [comercios, setComercios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [adminEmail, setAdminEmail] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, listRes, checkRes] = await Promise.all([
        adminFetch('/api/admin/stats'),
        adminFetch('/api/admin/comercios'),
        adminFetch('/api/admin/check'),
      ]);
      setStats(statsRes.data);
      setComercios(listRes.data);
      setAdminEmail(checkRes.admin);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', padding: '0' }}>

      {/* ── Header ── */}
      <div style={{ borderBottom: '1px solid var(--border-color)', padding: '1rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-elevated)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <ShieldCheck size={22} style={{ color: 'var(--accent-primary)' }} />
          <div>
            <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Panel de Administración</h1>
            <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)' }}>Nexova Industries — {adminEmail}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Actualizar
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> Nuevo Negocio
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleSignOut}>
            <LogOut size={14} /> Salir
          </button>
        </div>
      </div>

      <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>

        {/* ── Stats ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
          {[
            { label: 'Negocios Activos', value: stats.totalComercios, icon: Building2, color: 'var(--accent-primary)', bg: 'rgba(99,102,241,0.1)' },
            { label: 'Tarjetas Emitidas', value: stats.totalTarjetas, icon: CreditCard, color: 'var(--success)', bg: 'var(--success-bg)' },
            { label: 'Clientes Totales', value: stats.totalClientes, icon: Users, color: 'var(--warning)', bg: 'var(--warning-bg)' },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={22} style={{ color }} />
              </div>
              <div>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, lineHeight: 1 }}>{loading ? '—' : value}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>{label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Tabla de negocios ── */}
        <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
              <Building2 size={16} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: 'var(--accent-primary)' }} />
              Negocios Registrados ({comercios.length})
            </h2>
          </div>

          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', marginBottom: '0.5rem' }} />
              <p style={{ margin: 0, fontSize: '0.85rem' }}>Cargando negocios...</p>
            </div>
          ) : comercios.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Building2 size={32} style={{ marginBottom: '0.75rem', opacity: 0.4 }} />
              <p style={{ margin: 0 }}>Aún no hay negocios registrados.</p>
              <button className="btn btn-primary btn-sm" style={{ marginTop: '1rem' }} onClick={() => setShowCreate(true)}>
                <Plus size={14} /> Crear el primero
              </button>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-elevated)' }}>
                    {['Negocio', 'Usuario', 'Tipo', 'Tarjetas', 'Registrado', 'Acciones'].map(h => (
                      <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comercios.map((c, i) => (
                    <tr key={c.id} style={{ borderBottom: i < comercios.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                      <td style={{ padding: '1rem', fontWeight: 600 }}>
                        <div>{c.nombre}</div>
                        {c.slogan && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400, fontStyle: 'italic' }}>{c.slogan}</div>}
                      </td>
                      <td style={{ padding: '1rem', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 500 }}>
                        {c.owner_email
                          ? c.owner_email.replace('@nexova.app', '')
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <span className="badge badge-accent" style={{ fontSize: '0.72rem' }}>
                          {TIPO_LABELS[c.tipo_fidelizacion] || c.tipo_fidelizacion}
                        </span>
                      </td>
                      <td style={{ padding: '1rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
                        {c.tarjetas_count}
                      </td>
                      <td style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                        {new Date(c.created_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <a
                            href={`/?comercio=${c.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-secondary btn-sm"
                            title="Ver Dashboard del negocio"
                            style={{ padding: '0.35rem 0.6rem' }}
                          >
                            <Eye size={14} />
                          </a>
                          <button
                            className="btn btn-danger btn-sm"
                            title="Eliminar negocio"
                            style={{ padding: '0.35rem 0.6rem' }}
                            onClick={() => setDeleteTarget(c)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Modales ── */}
      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={load}
        />
      )}
      {deleteTarget && (
        <DeleteModal
          comercio={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={load}
        />
      )}
    </div>
  );
}

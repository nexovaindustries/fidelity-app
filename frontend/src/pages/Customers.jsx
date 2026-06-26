import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Search, Users, Download, ChevronUp, ChevronDown, Phone, Mail, Calendar, Award, Cake } from 'lucide-react';

export default function Customers() {
  const { comercioId } = useAuth();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  useEffect(() => {
    if (!comercioId) return;
    fetchCustomers();
  }, [comercioId]);

  const fetchCustomers = async () => {
    try {
      const { data, error } = await supabase
        .from('tarjetas_activas')
        .select(`
          *,
          clientes (*)
        `)
        .eq('comercio_id', comercioId)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setCustomers(data);
      }
    } catch (err) {
      console.error('Error loading customers:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredCustomers = customers.filter(c => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const name = (c.clientes?.nombre_completo || '').toLowerCase();
    const email = (c.clientes?.email || '').toLowerCase();
    const phone = (c.clientes?.telefono || '').toLowerCase();
    return name.includes(q) || email.includes(q) || phone.includes(q);
  });

  const sortedCustomers = [...filteredCustomers].sort((a, b) => {
    let valA, valB;
    switch (sortField) {
      case 'nombre':
        valA = a.clientes?.nombre_completo || '';
        valB = b.clientes?.nombre_completo || '';
        break;
      case 'puntos':
        valA = a.puntos_actuales || 0;
        valB = b.puntos_actuales || 0;
        break;
      case 'created_at':
      default:
        valA = new Date(a.created_at || 0);
        valB = new Date(b.created_at || 0);
        break;
    }
    if (sortDir === 'asc') return valA > valB ? 1 : -1;
    return valA < valB ? 1 : -1;
  });

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const exportExcel = async () => {
    // Fetch first transaction per customer to determine capture sede
    const clienteIds = sortedCustomers.map(c => c.cliente_id).filter(Boolean);
    let firstSedePorCliente = {};
    if (clienteIds.length > 0) {
      const { data: txs } = await supabase
        .from('transacciones')
        .select('cliente_id, sede, created_at')
        .in('cliente_id', clienteIds)
        .order('created_at', { ascending: true });
      if (txs) {
        txs.forEach(tx => {
          if (!firstSedePorCliente[tx.cliente_id] && tx.sede) {
            firstSedePorCliente[tx.cliente_id] = tx.sede.split(',')[0].trim();
          }
        });
      }
    }

    const headers = [
      'Nombre completo', 'Teléfono', 'Email', 'Fecha de cumpleaños',
      'Puntos', 'Sellos', 'Nivel', 'Fecha de registro', 'Fecha de expiración', 'Estado',
      'Primera sede',
    ];

    const rows = sortedCustomers.map(c => {
      const email = c.clientes?.email || '';
      const isExpired = c.fecha_expiracion && new Date(c.fecha_expiracion) < new Date();
      return [
        c.clientes?.nombre_completo || '',
        c.clientes?.telefono || '',
        email.endsWith('@fidelity.customer') ? '' : email,
        c.clientes?.fecha_nacimiento || '',
        c.puntos_actuales || 0,
        c.total_sellos || 0,
        c.nivel_actual || '',
        c.created_at ? new Date(c.created_at).toLocaleDateString('es-PE') : '',
        c.fecha_expiracion ? new Date(c.fecha_expiracion).toLocaleDateString('es-PE') : '',
        isExpired ? 'Expirada' : 'Activa',
        firstSedePorCliente[c.cliente_id] || '',
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [
      { wch: 28 }, { wch: 14 }, { wch: 30 }, { wch: 16 },
      { wch: 8 },  { wch: 8 },  { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 10 },
      { wch: 30 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
    XLSX.writeFile(wb, `clientes_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  if (loading) {
    return (
      <div className="stagger-children">
        <div className="page-header">
          <div className="skeleton" style={{ width: '180px', height: '30px', marginBottom: '0.5rem' }} />
          <div className="skeleton" style={{ width: '280px', height: '18px' }} />
        </div>
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="skeleton" style={{ height: '60px', borderRadius: 'var(--radius-md)', marginBottom: '0.5rem' }} />
        ))}
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '2rem' }}>
        <div>
          <h1 className="page-title">Clientes</h1>
          <p className="page-subtitle">{customers.length} tarjetas activas en tu programa</p>
        </div>
        <button className="btn btn-secondary" onClick={exportExcel} disabled={sortedCustomers.length === 0}>
          <Download size={16} />
          Exportar Excel
        </button>
      </div>

      {/* Search */}
      <div className="search-bar" style={{ marginBottom: '1.5rem' }}>
        <Search size={18} className="search-icon" />
        <input 
          type="text" 
          placeholder="Buscar por nombre, email o teléfono..." 
          value={searchQuery} 
          onChange={(e) => setSearchQuery(e.target.value)} 
        />
      </div>

      {sortedCustomers.length > 0 ? (
        <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th onClick={() => toggleSort('nombre')} style={{ paddingLeft: '1.5rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>Cliente <SortIcon field="nombre" /></span>
                  </th>
                  <th>Contacto</th>
                  <th onClick={() => toggleSort('puntos')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>Saldo <SortIcon field="puntos" /></span>
                  </th>
                  <th>Nivel</th>
                  <th onClick={() => toggleSort('created_at')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>Registro <SortIcon field="created_at" /></span>
                  </th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {sortedCustomers.map((c, i) => {
                  const isExpired = c.fecha_expiracion && new Date(c.fecha_expiracion) < new Date();
                  return (
                    <tr 
                      key={c.id} 
                      onClick={() => setSelectedCustomer(selectedCustomer?.id === c.id ? null : c)}
                      style={{ cursor: 'pointer', animationDelay: `${i * 40}ms` }}
                    >
                      <td style={{ paddingLeft: '1.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div style={{ 
                            width: '36px', height: '36px', borderRadius: '50%', 
                            background: `linear-gradient(135deg, hsl(${(c.clientes?.nombre_completo || '').charCodeAt(0) * 5 % 360}, 60%, 50%), hsl(${(c.clientes?.nombre_completo || '').charCodeAt(0) * 5 % 360 + 30}, 60%, 40%))`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'white', fontWeight: 600, fontSize: '0.85rem', flexShrink: 0,
                          }}>
                            {(c.clientes?.nombre_completo || '?').charAt(0).toUpperCase()}
                          </div>
                          <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                            {c.clientes?.nombre_completo || 'Sin nombre'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', fontSize: '0.8rem' }}>
                          {c.clientes?.email && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                              <Mail size={12} style={{ opacity: 0.5 }} /> {c.clientes.email}
                            </span>
                          )}
                          {c.clientes?.telefono && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                              <Phone size={12} style={{ opacity: 0.5 }} /> {c.clientes.telefono}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem' }}>
                          {c.puntos_actuales || c.total_sellos || 0}
                        </span>
                      </td>
                      <td>
                        {c.nivel_actual ? (
                          <span className={`badge ${c.nivel_actual === 'Oro' ? 'badge-warning' : c.nivel_actual === 'Plata' ? 'badge-info' : 'badge-accent'}`}>
                            {c.nivel_actual}
                          </span>
                        ) : '—'}
                      </td>
                      <td>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}>
                          <Calendar size={12} style={{ opacity: 0.5 }} />
                          {formatDate(c.created_at)}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${isExpired ? 'badge-error' : 'badge-success'}`}>
                          {isExpired ? 'Expirada' : 'Activa'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="glass-panel">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Users size={28} />
            </div>
            <h3>{searchQuery ? 'Sin resultados' : 'Sin clientes aún'}</h3>
            <p>{searchQuery ? 'Intenta con otro término de búsqueda' : 'Los clientes aparecerán aquí cuando se registren escaneando el QR de tu programa'}</p>
          </div>
        </div>
      )}

      {/* Customer Detail Drawer */}
      {selectedCustomer && (
        <div className="modal-overlay" onClick={() => setSelectedCustomer(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ 
                  width: '48px', height: '48px', borderRadius: '50%', 
                  background: `linear-gradient(135deg, hsl(${(selectedCustomer.clientes?.nombre_completo || '').charCodeAt(0) * 5 % 360}, 60%, 50%), hsl(${(selectedCustomer.clientes?.nombre_completo || '').charCodeAt(0) * 5 % 360 + 30}, 60%, 40%))`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'white', fontWeight: 700, fontSize: '1.1rem',
                }}>
                  {(selectedCustomer.clientes?.nombre_completo || '?').charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 style={{ fontSize: '1.1rem', marginBottom: '0.15rem' }}>{selectedCustomer.clientes?.nombre_completo || 'Sin nombre'}</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Desde {formatDate(selectedCustomer.created_at)}
                  </p>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedCustomer(null)}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <div className="glass-panel-solid" style={{ textAlign: 'center', padding: '1rem' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Puntos</p>
                <p style={{ fontSize: '1.75rem', fontWeight: 800 }}>{selectedCustomer.puntos_actuales || 0}</p>
              </div>
              <div className="glass-panel-solid" style={{ textAlign: 'center', padding: '1rem' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Sellos</p>
                <p style={{ fontSize: '1.75rem', fontWeight: 800 }}>{selectedCustomer.total_sellos || 0}</p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {selectedCustomer.clientes?.email && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem' }}>
                  <Mail size={16} style={{ color: 'var(--text-muted)' }} />
                  <span>{selectedCustomer.clientes.email}</span>
                </div>
              )}
              {selectedCustomer.clientes?.telefono && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem' }}>
                  <Phone size={16} style={{ color: 'var(--text-muted)' }} />
                  <span>{selectedCustomer.clientes.telefono}</span>
                </div>
              )}
              {selectedCustomer.clientes?.fecha_nacimiento && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem' }}>
                  <Cake size={16} style={{ color: 'var(--text-muted)' }} />
                  <span>Cumpleaños: <strong>{new Date(selectedCustomer.clientes.fecha_nacimiento + 'T12:00:00').toLocaleDateString('es-PE', { day: 'numeric', month: 'long' })}</strong></span>
                </div>
              )}
              {selectedCustomer.nivel_actual && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem' }}>
                  <Award size={16} style={{ color: 'var(--text-muted)' }} />
                  <span>Nivel: <strong>{selectedCustomer.nivel_actual}</strong></span>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem' }}>
                <Calendar size={16} style={{ color: 'var(--text-muted)' }} />
                <span>Expira: {formatDate(selectedCustomer.fecha_expiracion)}</span>
              </div>
            </div>

            <div style={{ marginTop: '1.5rem', padding: '0.75rem', background: 'var(--accent-subtle)', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', color: 'var(--accent-primary)', textAlign: 'center' }}>
              QR: <code style={{ fontWeight: 600 }}>{selectedCustomer.qr_value}</code>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

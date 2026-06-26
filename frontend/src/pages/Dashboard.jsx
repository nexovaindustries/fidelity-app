import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Users, ScanLine, Trophy, Award, Clock, ArrowUpRight, ArrowDownRight, Zap, MapPin } from 'lucide-react';

const DAYS_OF_WEEK = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export default function Dashboard() {
  const { comercioId } = useAuth();
  const [stats, setStats] = useState({
    activeCards: 0,
    weekScans: 0,
    totalRewards: 0,
    loyaltyType: 'puntos',
    loading: true,
  });
  const [weeklyData, setWeeklyData] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [lastTx, setLastTx] = useState(null);
  const [sedeStats, setSedeStats] = useState([]);

  useEffect(() => {
    if (!comercioId) return;
    fetchDashboardData();

    // Real-time: update last transaction on every new scan
    const channel = supabase
      .channel(`dashboard_${comercioId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'transacciones',
        filter: `comercio_id=eq.${comercioId}`,
      }, (payload) => {
        setLastTx(payload.new);
        setRecentActivity(prev => [payload.new, ...prev].slice(0, 8));
        setStats(prev => ({ ...prev, weekScans: prev.weekScans + 1 }));
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [comercioId]);

  const fetchDashboardData = async () => {
    try {
      // 1. Active cards count
      const { count: cardsCount } = await supabase
        .from('tarjetas_activas')
        .select('*', { count: 'exact', head: true })
        .eq('comercio_id', comercioId);

      // 2. Get comercio info
      const { data: comercioInfo } = await supabase
        .from('comercios')
        .select('tipo_fidelizacion')
        .eq('id', comercioId)
        .single();

      // 3. Recent transactions (try, gracefully handle if table doesn't exist)
      let weekScans = 0;
      let activity = [];
      let weekly = DAYS_OF_WEEK.map(d => ({ day: d, count: 0 }));

      try {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        const { data: transactions, error: txError } = await supabase
          .from('transacciones')
          .select('*')
          .eq('comercio_id', comercioId)
          .gte('created_at', oneWeekAgo.toISOString())
          .order('created_at', { ascending: false })
          .limit(50);

        if (!txError && transactions) {
          weekScans = transactions.length;
          activity = transactions.slice(0, 8);
          if (transactions[0]) setLastTx(transactions[0]);

          // First scan per cliente → captación por sede
          const firstBySede = {};
          const seen = new Set();
          transactions.slice().reverse().forEach(tx => {
            if (tx.cliente_id && tx.sede && !seen.has(tx.cliente_id)) {
              seen.add(tx.cliente_id);
              const key = tx.sede.split(',')[0].trim();
              firstBySede[key] = (firstBySede[key] || 0) + 1;
            }
          });
          const sorted = Object.entries(firstBySede)
            .sort((a, b) => b[1] - a[1])
            .map(([nombre, count]) => ({ nombre, count }));
          setSedeStats(sorted);

          // Map transactions to days of week
          transactions.forEach(tx => {
            const date = new Date(tx.created_at);
            const dayIndex = (date.getDay() + 6) % 7; // Monday = 0
            weekly[dayIndex].count++;
          });
        }
      } catch {
        // transacciones table might not exist yet
      }

      // 4. Count rewards
      let totalRewards = 0;
      try {
        const { count: rewardsCount } = await supabase
          .from('recompensas')
          .select('*', { count: 'exact', head: true })
          .eq('comercio_id', comercioId)
          .eq('activa', true);
        totalRewards = rewardsCount || 0;
      } catch {
        // recompensas table might not exist yet
      }

      setStats({
        activeCards: cardsCount || 0,
        weekScans,
        totalRewards,
        loyaltyType: comercioInfo?.tipo_fidelizacion || 'puntos',
        loading: false,
      });
      setWeeklyData(weekly);
      setRecentActivity(activity);

    } catch (err) {
      console.error('Dashboard fetch error:', err);
      setStats(prev => ({ ...prev, loading: false }));
    }
  };

  const formatRelativeTime = (dateStr) => {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Justo ahora';
    if (diffMins < 60) return `hace ${diffMins}m`;
    if (diffHours < 24) return `hace ${diffHours}h`;
    return `hace ${diffDays}d`;
  };

  const getActionLabel = (accion) => {
    switch (accion) {
      case 'sumar': return { text: 'Sumó', icon: ArrowUpRight, color: 'var(--success)' };
      case 'restar': return { text: 'Restó', icon: ArrowDownRight, color: 'var(--warning)' };
      case 'canjear': return { text: 'Canjeó', icon: Award, color: 'var(--accent-primary)' };
      default: return { text: 'Acción', icon: Zap, color: 'var(--text-muted)' };
    }
  };

  const maxBarValue = Math.max(...weeklyData.map(d => d.count), 1);

  if (stats.loading) {
    return (
      <div className="stagger-children" style={{ padding: '2rem 0' }}>
        <div className="page-header">
          <div className="skeleton" style={{ width: '200px', height: '30px', marginBottom: '0.5rem' }} />
          <div className="skeleton" style={{ width: '300px', height: '18px' }} />
        </div>
        <div className="grid-cols-4" style={{ marginTop: '2rem' }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="skeleton" style={{ height: '140px', borderRadius: 'var(--radius-lg)' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">Panel de Control</h1>
        <p className="page-subtitle">Resumen de tu programa de fidelidad</p>
      </div>

      {/* ===== KPI Cards ===== */}
      <div className="grid-cols-4 stagger-children" style={{ marginTop: '0.5rem' }}>
        
        <div className="glass-panel stat-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div className="stat-card-icon" style={{ backgroundColor: 'rgba(99, 102, 241, 0.1)', color: 'var(--accent-primary)' }}>
              <Users size={22} />
            </div>
          </div>
          <p className="stat-card-label">Tarjetas Activas</p>
          <h3 className="stat-card-value">{stats.activeCards}</h3>
        </div>

        <div className="glass-panel stat-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div className="stat-card-icon" style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success)' }}>
              <ScanLine size={22} />
            </div>
          </div>
          <p className="stat-card-label">Escaneos esta semana</p>
          <h3 className="stat-card-value">{stats.weekScans}</h3>
        </div>

        <div className="glass-panel stat-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div className="stat-card-icon" style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }}>
              <Award size={22} />
            </div>
          </div>
          <p className="stat-card-label">Recompensas Activas</p>
          <h3 className="stat-card-value">{stats.totalRewards}</h3>
        </div>

        <div className="glass-panel stat-card" style={{ background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, var(--glass-bg) 100%)', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div className="stat-card-icon" style={{ backgroundColor: 'rgba(255, 255, 255, 0.1)', color: 'white' }}>
              <Trophy size={22} />
            </div>
          </div>
          <p className="stat-card-label" style={{ color: 'rgba(255,255,255,0.7)' }}>Mecánica Activa</p>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'white', textTransform: 'capitalize' }}>
            {stats.loyaltyType === 'puntos' ? 'Puntos' : stats.loyaltyType === 'sellos' ? 'Sellos' : 'Niveles'}
          </h3>
        </div>
      </div>

      {/* ===== Charts + Activity ===== */}
      <div className="grid-cols-2" style={{ marginTop: '2rem' }}>
        
        {/* Weekly Activity Chart */}
        <div className="glass-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Actividad Semanal</h3>
            <span className="badge badge-accent">Última semana</span>
          </div>
          <div className="chart-container">
            {weeklyData.map((d, i) => (
              <div key={i} className="chart-bar-wrapper" style={{ animationDelay: `${i * 80}ms` }}>
                <span className="chart-bar-value">{d.count > 0 ? d.count : ''}</span>
                <div 
                  className="chart-bar" 
                  style={{ 
                    height: `${Math.max((d.count / maxBarValue) * 100, 3)}%`,
                    animationDelay: `${i * 80}ms`,
                    background: d.count > 0 
                      ? 'linear-gradient(180deg, var(--accent-primary), rgba(99, 102, 241, 0.4))' 
                      : 'var(--bg-elevated)',
                  }} 
                />
                <span className="chart-bar-label">{d.day}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="glass-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Actividad Reciente</h3>
            <Clock size={16} style={{ color: 'var(--text-muted)' }} />
          </div>

          {recentActivity.length > 0 ? (
            <div className="activity-timeline">
              {recentActivity.map((tx, i) => {
                const action = getActionLabel(tx.accion);
                const Icon = action.icon;
                const sedeShort = tx.sede ? tx.sede.split(',')[0] : null;
                return (
                  <div key={tx.id || i} className="activity-item" style={{ animationDelay: `${i * 60}ms` }}>
                    <div className="activity-dot" style={{ backgroundColor: action.color }} />
                    <div className="activity-content">
                      <p className="activity-text">
                        <strong>{tx.nombre_cliente || 'Cliente'}</strong>
                        {' — '}{action.text} {tx.cantidad} {stats.loyaltyType}
                      </p>
                      <p className="activity-time" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        {formatRelativeTime(tx.created_at)}
                        {sedeShort && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', opacity: 0.7 }}>
                            <MapPin size={10} /> {sedeShort}
                          </span>
                        )}
                      </p>
                    </div>
                    <Icon size={14} style={{ color: action.color, flexShrink: 0, marginTop: '0.3rem' }} />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state" style={{ minHeight: '150px', padding: '2rem 1rem' }}>
              <div className="empty-state-icon" style={{ width: '48px', height: '48px', marginBottom: '0.75rem' }}>
                <ScanLine size={22} />
              </div>
              <h3 style={{ fontSize: '0.95rem' }}>Sin actividad reciente</h3>
              <p style={{ fontSize: '0.8rem' }}>Las transacciones aparecerán aquí cuando escanees tarjetas</p>
            </div>
          )}
        </div>
      </div>

      {/* ===== Captación por sede ===== */}
      {sedeStats.length > 0 && (
        <div className="glass-panel" style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Captación por sede</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>primera transacción registrada</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {sedeStats.map((s, i) => {
              const max = sedeStats[0].count;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{ flexShrink: 0, width: '1.4rem', textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 500, marginBottom: '0.2rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <MapPin size={11} style={{ marginRight: '0.3rem', opacity: 0.6 }} />
                      {s.nombre}
                    </div>
                    <div style={{ height: '6px', borderRadius: '3px', background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(s.count / max) * 100}%`, background: 'var(--accent-primary)', borderRadius: '3px', transition: 'width 0.4s ease' }} />
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
                    {s.count}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== Última Atención ===== */}
      {lastTx && (
        <div className="glass-panel" style={{ marginTop: '2rem', borderLeft: '3px solid var(--accent-primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Última persona atendida</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{formatRelativeTime(lastTx.created_at)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontWeight: 700, fontSize: '1.1rem' }}>{lastTx.nombre_cliente || 'Cliente'}</p>
              {lastTx.sede && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <MapPin size={12} /> {lastTx.sede.split(',')[0]}
                </p>
              )}
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <p style={{
                fontWeight: 700, fontSize: '1.25rem',
                color: lastTx.accion === 'sumar' ? 'var(--success)' : lastTx.accion === 'canjear' ? 'var(--accent-primary)' : 'var(--warning)',
              }}>
                {lastTx.accion === 'sumar' ? '+' : '-'}{lastTx.cantidad} {stats.loyaltyType}
              </p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {lastTx.saldo_antes} → {lastTx.saldo_despues}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

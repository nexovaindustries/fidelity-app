import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Users, ScanLine, Trophy, TrendingUp, Award, Clock, ArrowUpRight, ArrowDownRight, Zap } from 'lucide-react';

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

  useEffect(() => {
    if (!comercioId) return;
    fetchDashboardData();
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

  const getActionLabel = (tipo) => {
    switch (tipo) {
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
                const action = getActionLabel(tx.tipo);
                const Icon = action.icon;
                return (
                  <div key={tx.id || i} className="activity-item" style={{ animationDelay: `${i * 60}ms` }}>
                    <div className="activity-dot" style={{ backgroundColor: action.color }} />
                    <div className="activity-content">
                      <p className="activity-text">
                        <strong>{action.text}</strong> {tx.cantidad} {stats.loyaltyType}
                        {tx.descripcion && <span style={{ opacity: 0.7 }}> — {tx.descripcion}</span>}
                      </p>
                      <p className="activity-time">{formatRelativeTime(tx.created_at)}</p>
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
    </div>
  );
}

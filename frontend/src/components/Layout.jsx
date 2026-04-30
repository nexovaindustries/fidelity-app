import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Settings, QrCode, LogOut, Menu, X, Users, Gift, Sparkles, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const Layout = () => {
  const { signOut, user } = useAuth();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const checkAdmin = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      try {
        const res = await fetch(`${API_URL}/api/admin/check`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        setIsAdmin(res.ok);
      } catch { /* backend no disponible */ }
    };
    checkAdmin();
  }, [user]);

  const mainNavItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/scanner', label: 'Escanear QR', icon: QrCode },
    { path: '/customers', label: 'Clientes', icon: Users },
  ];

  const configNavItems = [
    { path: '/rewards', label: 'Recompensas', icon: Gift },
    { path: '/settings', label: 'Configuración', icon: Settings },
  ];

  const toggleMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);
  const closeMenu = () => setIsMobileMenuOpen(false);

  return (
    <div className="app-container">
      <div className="bg-glow-orb" />
      <div className="bg-glow-orb-secondary" />

      {/* Mobile Header */}
      <div className="mobile-header">
        <h2 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          <Sparkles size={20} style={{ color: 'var(--accent-primary)' }} />
          <span className="text-gradient" style={{ fontWeight: 700 }}>Fidelity</span>
        </h2>
        <button className="hamburger-btn" onClick={toggleMenu}>
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Overlay */}
      <div 
        className={`sidebar-overlay ${isMobileMenuOpen ? 'open' : ''}`} 
        onClick={closeMenu}
      />

      {/* Sidebar */}
      <aside className={`sidebar ${isMobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <Sparkles size={22} style={{ color: 'var(--accent-primary)' }} />
          <h2>
            <span className="text-gradient" style={{ fontWeight: 700 }}>Fidelity</span>
            <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.8rem', marginLeft: '0.3rem' }}>B2B</span>
          </h2>
        </div>

        <nav className="sidebar-nav">
          {/* Main Section */}
          <span className="sidebar-nav-section">Principal</span>
          {mainNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={closeMenu}
                className={`nav-link ${isActive ? 'active' : ''}`}
              >
                <Icon size={20} className="nav-icon" style={{ color: isActive ? 'var(--accent-primary)' : undefined }} />
                {item.label}
              </Link>
            );
          })}

          {/* Config Section */}
          <span className="sidebar-nav-section" style={{ marginTop: '0.5rem' }}>Configuración</span>
          {configNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={closeMenu}
                className={`nav-link ${isActive ? 'active' : ''}`}
              >
                <Icon size={20} className="nav-icon" style={{ color: isActive ? 'var(--accent-primary)' : undefined }} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Admin link — solo visible si es admin */}
        {isAdmin && (
          <div style={{ padding: '0 0.5rem', marginBottom: '0.5rem' }}>
            <Link
              to="/admin"
              onClick={closeMenu}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem',
                padding: '0.6rem 0.75rem', borderRadius: '10px',
                background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)',
                color: 'var(--accent-primary)', fontSize: '0.85rem', fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              <ShieldCheck size={16} />
              Admin Panel
            </Link>
          </div>
        )}

        <div className="sidebar-footer">
          {/* Plan Badge */}
          <div className="sidebar-plan-badge">
            <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>
              <Sparkles size={14} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
              Plan Activo
            </span>
            <span className="badge badge-accent">Pro</span>
          </div>

          {/* User Info */}
          {user && (
            <div style={{ padding: '0 0.25rem', fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user.email}
            </div>
          )}

          <button 
            className="btn btn-secondary" 
            style={{ width: '100%' }}
            onClick={() => {
              closeMenu();
              signOut();
            }}
          >
            <LogOut size={18} />
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content" style={{ zIndex: 1, position: 'relative' }}>
        <div className="page-container animate-fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

import { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { useAuth } from '../contexts/AuthContext';
import { CheckCircle2, AlertCircle, ScanLine, Loader2, RotateCcw, Zap } from 'lucide-react';

const CONFETTI_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#06b6d4'];

function Confetti() {
  return (
    <div className="confetti-container">
      {Array.from({ length: 30 }).map((_, i) => (
        <div
          key={i}
          className="confetti-piece"
          style={{
            left: `${Math.random() * 100}%`,
            backgroundColor: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
            borderRadius: Math.random() > 0.5 ? '50%' : '2px',
            width: `${Math.random() * 8 + 4}px`,
            height: `${Math.random() * 8 + 4}px`,
            animationDelay: `${Math.random() * 0.8}s`,
            animationDuration: `${Math.random() * 1.5 + 1}s`,
          }}
        />
      ))}
    </div>
  );
}

export default function Scanner() {
  const { comercioId } = useAuth();
  const [scanResult, setScanResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState('sumar');
  const [cantidad, setCantidad] = useState(1);
  const [feedback, setFeedback] = useState({ state: 'idle', message: '', data: null });
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    if (scanResult) return;

    const scanner = new Html5QrcodeScanner(
      "qr-reader",
      { fps: 10, qrbox: { width: 250, height: 250 }, rememberLastUsedCamera: true },
      false
    );

    scanner.render(
      (decodedText) => {
        setScanResult(decodedText);
        scanner.clear().catch(console.error);
        // Vibrate on scan if available
        if (navigator.vibrate) navigator.vibrate(100);
        // Play a subtle beep
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 880;
          gain.gain.value = 0.1;
          osc.start();
          osc.stop(ctx.currentTime + 0.12);
        } catch {}
      },
      () => {}
    );

    return () => {
      scanner.clear().catch(console.error);
    };
  }, [scanResult]);

  const processScan = async (e) => {
    e.preventDefault();
    if (!scanResult || !comercioId) return;

    setLoading(true);
    setFeedback({ state: 'idle', message: '', data: null });

    try {
      const response = await fetch(`/api/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comercio_id: comercioId,
          qr_value: scanResult,
          accion: action,
          cantidad: parseInt(cantidad, 10)
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Error procesando la transacción');
      }

      setFeedback({ state: 'success', message: '¡Transacción Exitosa!', data: data.data });
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 2500);
      
      // Success vibration
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

    } catch (error) {
      console.error(error);
      setFeedback({ state: 'error', message: error.message, data: null });
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    } finally {
      setLoading(false);
    }
  };

  const resetScanner = () => {
    setScanResult(null);
    setFeedback({ state: 'idle', message: '', data: null });
    setCantidad(1);
    setAction('sumar');
  };

  return (
    <div className="animate-fade-in" style={{ maxWidth: '550px', margin: '0 auto' }}>
      {showConfetti && <Confetti />}

      <div className="page-header" style={{ textAlign: 'center' }}>
        <h1 className="page-title">Escáner Operativo</h1>
        <p className="page-subtitle">Apunta la cámara al Wallet del cliente</p>
      </div>

      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        
        {!scanResult ? (
          <div>
            <div id="qr-reader" style={{ width: '100%', borderRadius: 'var(--radius-md)', overflow: 'hidden' }} />
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              <div style={{ width: '60px', height: '60px', borderRadius: 'var(--radius-lg)', background: 'var(--accent-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', color: 'var(--accent-primary)' }}>
                <ScanLine size={28} />
              </div>
              <p style={{ fontWeight: 500 }}>Esperando código QR...</p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>El escaneo es automático</p>
            </div>
          </div>
        ) : (
          <div className="animate-fade-in">
            {feedback.state === 'idle' && (
              <form onSubmit={processScan} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* QR Detected Badge */}
                <div style={{ 
                  textAlign: 'center', padding: '1rem', 
                  backgroundColor: 'var(--accent-subtle)', 
                  borderRadius: 'var(--radius-md)', 
                  border: '1px solid rgba(99, 102, 241, 0.2)' 
                }}>
                  <Zap size={20} style={{ color: 'var(--accent-primary)', marginBottom: '0.25rem' }} />
                  <p style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', marginBottom: '0.25rem', fontWeight: 500 }}>QR Detectado</p>
                  <code style={{ fontSize: '1rem', fontWeight: 700, letterSpacing: '0.02em' }}>{scanResult}</code>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="input-group">
                    <label className="input-label" htmlFor="scan-action">Operación</label>
                    <select id="scan-action" className="input-field" value={action} onChange={(e) => setAction(e.target.value)}>
                      <option value="sumar">➕ Añadir Saldo</option>
                      <option value="restar">➖ Restar Saldo</option>
                      <option value="canjear">🎁 Canjear Recompensa</option>
                    </select>
                  </div>
                  <div className="input-group">
                    <label className="input-label" htmlFor="scan-cantidad">Cantidad</label>
                    <input type="number" id="scan-cantidad" className="input-field" value={cantidad} onChange={(e) => setCantidad(e.target.value)} min="1" required />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={resetScanner} disabled={loading}>
                    <RotateCcw size={16} />
                    Cancelar
                  </button>
                  <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={loading}>
                    {loading ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}
                    {loading ? 'Procesando...' : 'Procesar'}
                  </button>
                </div>
              </form>
            )}

            {feedback.state === 'success' && (
              <div style={{ textAlign: 'center', padding: '2rem 1rem' }} className="animate-scale-up">
                <div style={{ animation: 'successPop 0.5s ease-out' }}>
                  <CheckCircle2 size={72} style={{ color: 'var(--success)', margin: '0 auto 1rem' }} />
                </div>
                <h3 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>¡Listo!</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>{feedback.message}</p>
                
                {feedback.data?.tarjeta && (
                  <div style={{ 
                    padding: '1rem', background: 'var(--success-bg)', borderRadius: 'var(--radius-md)', 
                    marginBottom: '1.5rem', textAlign: 'left', fontSize: '0.875rem', color: 'var(--text-secondary)' 
                  }}>
                    <p><strong style={{ color: 'var(--text-primary)' }}>Puntos actuales:</strong> {feedback.data.tarjeta.puntos_actuales}</p>
                    {feedback.data.tarjeta.total_sellos > 0 && (
                      <p><strong style={{ color: 'var(--text-primary)' }}>Sellos:</strong> {feedback.data.tarjeta.total_sellos}</p>
                    )}
                    {feedback.data.tarjeta.nivel_actual && (
                      <p><strong style={{ color: 'var(--text-primary)' }}>Nivel:</strong> {feedback.data.tarjeta.nivel_actual}</p>
                    )}
                  </div>
                )}

                <button className="btn btn-primary btn-lg" onClick={resetScanner} style={{ width: '100%' }}>
                  <ScanLine size={18} />
                  Siguiente Cliente
                </button>
              </div>
            )}

            {feedback.state === 'error' && (
              <div style={{ textAlign: 'center', padding: '2rem 1rem' }} className="animate-scale-up">
                <AlertCircle size={64} style={{ color: 'var(--error)', margin: '0 auto 1rem' }} />
                <h3 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Error en Transacción</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>{feedback.message}</p>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button className="btn btn-secondary" onClick={resetScanner} style={{ flex: 1 }}>
                    <RotateCcw size={16} />
                    Nuevo Escaneo
                  </button>
                  <button className="btn btn-primary" onClick={() => setFeedback({ state: 'idle', message: '', data: null })} style={{ flex: 1 }}>
                    Reintentar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

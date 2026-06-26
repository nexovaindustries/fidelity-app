import { useEffect, useRef, useState, useCallback } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { useAuth } from '../contexts/AuthContext';
import { CheckCircle2, AlertCircle, ScanLine, Loader2, RotateCcw, Zap, Crosshair, Camera } from 'lucide-react';

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

// ─── PHYSICAL SCANNER (HID keyboard wedge) ────────────────────────────────────
// The Netum L8BL Pro sends characters as rapid keystrokes (< 30ms apart)
// followed by Enter. This hook captures that input stream and returns the
// scanned value, ignoring normal human keyboard input.
function usePhysicalScanner(onScan, enabled) {
  const buffer = useRef('');
  const lastKeyTime = useRef(0);
  const MAX_INTER_KEY_MS = 50; // scanner is always faster than this
  const MIN_QR_LENGTH = 8;     // FID-... codes are longer than this

  useEffect(() => {
    if (!enabled) return;

    const handleKeydown = (e) => {
      // If the user is actively typing in a form field, ignore
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        // Exception: if the scanner fires into a focused input, the inter-key
        // timing is still diagnostic. We reset the buffer and skip.
        if (Date.now() - lastKeyTime.current > MAX_INTER_KEY_MS) {
          buffer.current = '';
        }
        lastKeyTime.current = Date.now();
        return;
      }

      const now = Date.now();
      const gap = now - lastKeyTime.current;
      lastKeyTime.current = now;

      if (e.key === 'Enter') {
        const scanned = buffer.current.trim().toLowerCase();
        buffer.current = '';
        if (scanned.length >= MIN_QR_LENGTH) {
          onScan(scanned);
        }
        return;
      }

      // If gap is too large, the previous buffer was incomplete human input
      if (gap > MAX_INTER_KEY_MS && buffer.current.length > 0) {
        buffer.current = '';
      }

      if (e.key.length === 1) {
        buffer.current += e.key;
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [enabled, onScan]);
}

export default function Scanner() {
  const { comercioId } = useAuth();
  const [scanResult, setScanResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState('sumar');
  const [cantidad, setCantidad] = useState(1);
  const [feedback, setFeedback] = useState({ state: 'idle', message: '', data: null });
  const [showConfetti, setShowConfetti] = useState(false);
  const [inputMode, setInputMode] = useState('pistola'); // 'pistola' | 'camara'
  const [autoProcess, setAutoProcess] = useState(true);
  const [pistolaPulse, setPistolaPulse] = useState(false);

  // ─── Camera scanner ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (inputMode !== 'camara' || scanResult) return;

    const scanner = new Html5QrcodeScanner(
      "qr-reader",
      { fps: 10, qrbox: { width: 250, height: 250 }, rememberLastUsedCamera: true },
      false
    );

    scanner.render(
      (decodedText) => {
        setScanResult(decodedText);
        scanner.clear().catch(console.error);
        playBeep();
        if (navigator.vibrate) navigator.vibrate(100);
      },
      () => {}
    );

    return () => { scanner.clear().catch(console.error); };
  }, [inputMode, scanResult]);

  // ─── Physical scanner handler ─────────────────────────────────────────────────
  const handlePhysicalScan = useCallback((value) => {
    if (loading || feedback.state !== 'idle') return;
    setScanResult(value);
    playBeep();
    setPistolaPulse(true);
    setTimeout(() => setPistolaPulse(false), 600);
  }, [loading, feedback.state]);

  usePhysicalScanner(handlePhysicalScan, inputMode === 'pistola');

  // Auto-process when pistol mode + autoProcess is on and we get a scan
  useEffect(() => {
    if (inputMode === 'pistola' && autoProcess && scanResult && feedback.state === 'idle' && !loading) {
      processTransaction(scanResult);
    }
  }, [scanResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Transaction ─────────────────────────────────────────────────────────────
  const processTransaction = async (qrValue) => {
    if (!qrValue || !comercioId) return;
    setLoading(true);
    setFeedback({ state: 'idle', message: '', data: null });

    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comercio_id: comercioId,
          qr_value: qrValue,
          accion: action,
          cantidad: parseInt(cantidad, 10),
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Error procesando la transacción');

      setFeedback({ state: 'success', message: '¡Transacción Exitosa!', data: data.data });
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 2500);
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

      // In pistol + auto mode, reset automatically after showing result
      if (inputMode === 'pistola' && autoProcess) {
        setTimeout(() => resetScanner(), 3000);
      }
    } catch (error) {
      console.error(error);
      setFeedback({ state: 'error', message: error.message, data: null });
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    } finally {
      setLoading(false);
    }
  };

  const processScan = (e) => {
    e.preventDefault();
    processTransaction(scanResult);
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
        <p className="page-subtitle">
          {inputMode === 'pistola' ? 'Dispara la pistola al QR del cliente' : 'Apunta la cámara al Wallet del cliente'}
        </p>
      </div>

      {/* ─── Mode toggle ──────────────────────────────────────────────────────── */}
      <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: inputMode === 'pistola' ? '0.75rem' : 0 }}>
          <button
            type="button"
            className={`btn btn-sm ${inputMode === 'pistola' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1 }}
            onClick={() => { setInputMode('pistola'); resetScanner(); }}
          >
            <Crosshair size={15} />
            Pistola QR
          </button>
          <button
            type="button"
            className={`btn btn-sm ${inputMode === 'camara' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1 }}
            onClick={() => { setInputMode('camara'); resetScanner(); }}
          >
            <Camera size={15} />
            Cámara
          </button>
        </div>

        {inputMode === 'pistola' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={autoProcess}
              onChange={e => setAutoProcess(e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
            />
            <span>
              <strong style={{ color: 'var(--text-primary)' }}>Auto-procesar</strong>
              {' '}— escanear dispara la transacción directamente (sin confirmar)
            </span>
          </label>
        )}
      </div>

      {/* ─── Config: action + cantidad (always visible in pistol mode) ─────────── */}
      {inputMode === 'pistola' && feedback.state === 'idle' && (
        <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label" htmlFor="scan-action">Operación</label>
              <select id="scan-action" className="input-field" value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="sumar">➕ Añadir Saldo</option>
                <option value="restar">➖ Restar Saldo</option>
                <option value="canjear">🎁 Canjear Recompensa</option>
              </select>
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label" htmlFor="scan-cantidad">Cantidad</label>
              <input
                type="number"
                id="scan-cantidad"
                className="input-field"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                min="1"
              />
            </div>
          </div>
        </div>
      )}

      <div className="glass-panel" style={{ overflow: 'hidden' }}>

        {/* ─── Pistol mode: waiting state ─────────────────────────────────────── */}
        {inputMode === 'pistola' && !scanResult && feedback.state === 'idle' && (
          <div style={{ padding: '2.5rem 1.5rem', textAlign: 'center' }}>
            <div style={{
              width: '80px', height: '80px', borderRadius: '50%',
              background: pistolaPulse ? 'var(--success-bg)' : 'var(--accent-subtle)',
              border: pistolaPulse ? '2px solid var(--success)' : '2px solid rgba(99,102,241,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 1.25rem',
              color: pistolaPulse ? 'var(--success)' : 'var(--accent-primary)',
              transition: 'all 0.2s ease',
            }}>
              <Crosshair size={36} />
            </div>
            <p style={{ fontWeight: 600, fontSize: '1.05rem', marginBottom: '0.4rem' }}>
              Listo para escanear
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {autoProcess
                ? 'Apunta y dispara — la transacción se procesa automáticamente'
                : 'Apunta y dispara — luego confirma la transacción'}
            </p>
          </div>
        )}

        {/* ─── Camera mode: waiting state ─────────────────────────────────────── */}
        {inputMode === 'camara' && !scanResult && (
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
        )}

        {/* ─── QR detected (manual confirm mode) ──────────────────────────────── */}
        {scanResult && feedback.state === 'idle' && !(inputMode === 'pistola' && autoProcess) && (
          <div className="animate-fade-in">
            <form onSubmit={processScan} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1.25rem' }}>
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

              {inputMode === 'camara' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="input-group">
                    <label className="input-label" htmlFor="scan-action-cam">Operación</label>
                    <select id="scan-action-cam" className="input-field" value={action} onChange={(e) => setAction(e.target.value)}>
                      <option value="sumar">➕ Añadir Saldo</option>
                      <option value="restar">➖ Restar Saldo</option>
                      <option value="canjear">🎁 Canjear Recompensa</option>
                    </select>
                  </div>
                  <div className="input-group">
                    <label className="input-label" htmlFor="scan-cantidad-cam">Cantidad</label>
                    <input type="number" id="scan-cantidad-cam" className="input-field" value={cantidad} onChange={(e) => setCantidad(e.target.value)} min="1" required />
                  </div>
                </div>
              )}

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
          </div>
        )}

        {/* ─── Processing (auto-mode) ──────────────────────────────────────────── */}
        {loading && (
          <div style={{ padding: '2.5rem 1.5rem', textAlign: 'center' }}>
            <Loader2 size={48} style={{ color: 'var(--accent-primary)', animation: 'spin 1s linear infinite', margin: '0 auto 1rem' }} />
            <p style={{ fontWeight: 500 }}>Procesando...</p>
          </div>
        )}

        {/* ─── Success ─────────────────────────────────────────────────────────── */}
        {feedback.state === 'success' && !loading && (
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

            {inputMode === 'pistola' && autoProcess ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Volviendo al escáner en un momento...</p>
            ) : (
              <button className="btn btn-primary btn-lg" onClick={resetScanner} style={{ width: '100%' }}>
                <ScanLine size={18} />
                Siguiente Cliente
              </button>
            )}
          </div>
        )}

        {/* ─── Error ───────────────────────────────────────────────────────────── */}
        {feedback.state === 'error' && !loading && (
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }} className="animate-scale-up">
            <AlertCircle size={64} style={{ color: 'var(--error)', margin: '0 auto 1rem' }} />
            <h3 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Error en Transacción</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>{feedback.message}</p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button className="btn btn-secondary" onClick={resetScanner} style={{ flex: 1 }}>
                <RotateCcw size={16} />
                Nuevo Escaneo
              </button>
              <button className="btn btn-primary" onClick={() => { setFeedback({ state: 'idle', message: '', data: null }); setScanResult(null); }} style={{ flex: 1 }}>
                Reintentar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function playBeep() {
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
}

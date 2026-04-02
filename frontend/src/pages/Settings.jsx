import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Save, Loader2, Upload, ImageIcon, Trash2, Circle, Square, RectangleHorizontal, Palette, QrCode, Link, Smartphone, Copy, Check, Download } from 'lucide-react';

const TEMPLATE_COLORS = {
  default: null,
  cafeteria: { color_fondo: '#D2B48C', color_texto: '#3E2723', color_acento: '#8D6E63' },
  restaurante: { color_fondo: '#800000', color_texto: '#FFD700', color_acento: '#B71C1C' },
  peluqueria: { color_fondo: '#1a1a1a', color_texto: '#FFD700', color_acento: '#C9B037' },
};

const COLOR_PRESETS = [
  { name: 'Midnight', bg: '#1a1a2e', text: '#e0e0e0', accent: '#e94560' },
  { name: 'Emerald', bg: '#064e3b', text: '#ecfdf5', accent: '#34d399' },
  { name: 'Sunset', bg: '#431407', text: '#fed7aa', accent: '#f97316' },
  { name: 'Rose', bg: '#4c0519', text: '#fce7f3', accent: '#f472b6' },
  { name: 'Ocean', bg: '#0c1445', text: '#dbeafe', accent: '#60a5fa' },
  { name: 'Neon', bg: '#0a0a0b', text: '#e0f2fe', accent: '#22d3ee' },
  { name: 'Classic', bg: '#ffffff', text: '#1a1a1a', accent: '#6366f1' },
  { name: 'Gold', bg: '#1c1917', text: '#fef3c7', accent: '#d97706' },
];

export default function Settings() {
  const { comercioId } = useAuth();
  
  const [formData, setFormData] = useState({
    nombre: '',
    plantilla_diseno: 'default',
    tipo_fidelizacion: 'puntos',
    color_fondo: '#1a1a2e',
    color_texto: '#e0e0e0',
    color_acento: '#e94560',
    texto_personalizado: '',
    dias_expiracion: 365,
    logo_url: '',
    hero_image_url: '',
    logo_size: 50,
    logo_shape: 'circle',
  });
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [logoDragOver, setLogoDragOver] = useState(false);
  const [bannerDragOver, setBannerDragOver] = useState(false);
  const logoInputRef = useRef(null);
  const bannerInputRef = useRef(null);

  useEffect(() => {
    if (!comercioId) return;

    const loadSettings = async () => {
      const { data, error } = await supabase
        .from('comercios')
        .select('*')
        .eq('id', comercioId)
        .single();
        
      if (!error && data) {
        setFormData({
          nombre: data.nombre || '',
          plantilla_diseno: data.plantilla_diseno || 'default',
          tipo_fidelizacion: data.tipo_fidelizacion || 'puntos',
          color_fondo: data.color_fondo || '#1a1a2e',
          color_texto: data.color_texto || '#e0e0e0',
          color_acento: data.color_acento || '#e94560',
          texto_personalizado: data.texto_personalizado || '',
          dias_expiracion: data.dias_expiracion || 365,
          logo_url: data.logo_url || '',
          hero_image_url: data.hero_image_url || '',
          logo_size: data.logo_size || 50,
          logo_shape: data.logo_shape || 'circle',
        });
      }
      setLoading(false);
    };

    loadSettings();
  }, [comercioId]);

  const handleFileUpload = (e, field) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setMessage({ text: 'El archivo no debe superar 2MB.', type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 4000);
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setFormData(prev => ({ ...prev, [field]: reader.result }));
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e, field, setDragState) => {
    e.preventDefault();
    setDragState(false);
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 2 * 1024 * 1024) {
      setMessage({ text: 'El archivo no debe superar 2MB.', type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 4000);
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setFormData(prev => ({ ...prev, [field]: reader.result }));
    };
    reader.readAsDataURL(file);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleTemplateChange = (e) => {
    const template = e.target.value;
    const colors = TEMPLATE_COLORS[template];
    if (colors) {
      setFormData(prev => ({ ...prev, plantilla_diseno: template, ...colors }));
    } else {
      setFormData(prev => ({ ...prev, plantilla_diseno: template }));
    }
  };

  const applyPreset = (preset) => {
    setFormData(prev => ({
      ...prev,
      plantilla_diseno: 'default',
      color_fondo: preset.bg,
      color_texto: preset.text,
      color_acento: preset.accent,
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage({ text: '', type: '' });

    try {
      const { error } = await supabase
        .from('comercios')
        .update(formData)
        .eq('id', comercioId);

      if (error) throw error;
      
      setMessage({ text: '✓ Configuración guardada exitosamente.', type: 'success' });
    } catch (err) {
      console.error(err);
      setMessage({ text: 'Error al guardar la configuración.', type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage({ text: '', type: '' }), 5000);
    }
  };

  // Get the effective colors (template or custom)
  const getPreviewColors = () => {
    const tpl = formData.plantilla_diseno;
    if (tpl !== 'default' && TEMPLATE_COLORS[tpl]) {
      return TEMPLATE_COLORS[tpl];
    }
    return {
      color_fondo: formData.color_fondo,
      color_texto: formData.color_texto,
      color_acento: formData.color_acento,
    };
  };

  const getLogoRadius = () => {
    switch (formData.logo_shape) {
      case 'circle': return '50%';
      case 'rounded': return '12px';
      case 'none': return '4px';
      default: return '50%';
    }
  };

  const isCustom = formData.plantilla_diseno === 'default';
  const colors = getPreviewColors();

  if (loading) return (
    <div className="flex-center" style={{ height: '50vh' }}>
      <Loader2 size={32} color="var(--accent-primary)" style={{ animation: 'spin 1s linear infinite' }} />
    </div>
  );

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">Configuración del Programa</h1>
        <p className="page-subtitle">Personaliza la experiencia, diseño y mecánica de tus tarjetas Wallet</p>
      </div>

      <div className="grid-layout-2-1">
        
        <form onSubmit={handleSave} className="glass-panel settings-section">
          
          {/* ===== SECTION: General ===== */}
          <div className="section-title">Información General</div>
          <div className="grid-cols-2">
            <div className="input-group">
              <label className="input-label" htmlFor="nombre">Nombre del Comercio</label>
              <input type="text" id="nombre" name="nombre" className="input-field" value={formData.nombre} onChange={handleChange} required />
            </div>
            <div className="input-group">
              <label className="input-label" htmlFor="dias_expiracion">Vigencia por Defecto (días)</label>
              <input type="number" id="dias_expiracion" name="dias_expiracion" className="input-field" value={formData.dias_expiracion} onChange={handleChange} min="1" required />
            </div>
          </div>

          {/* ===== SECTION: Mechanics ===== */}
          <div className="section-divider" />
          <div className="section-title">Mecánica de Fidelización</div>
          <div className="grid-cols-2">
            <div className="input-group">
              <label className="input-label" htmlFor="tipo_fidelizacion">Tipo de Programa</label>
              <select id="tipo_fidelizacion" name="tipo_fidelizacion" className="input-field" value={formData.tipo_fidelizacion} onChange={handleChange}>
                <option value="puntos">Por Puntos (Tickets)</option>
                <option value="sellos">Por Sellos (Visitas Constantes)</option>
                <option value="niveles">Por Niveles de Membresía</option>
              </select>
            </div>
            <div className="input-group">
              <label className="input-label" htmlFor="plantilla_diseno">Plantilla Temática</label>
              <select id="plantilla_diseno" name="plantilla_diseno" className="input-field" value={formData.plantilla_diseno} onChange={handleTemplateChange}>
                <option value="default">Diseño Personalizado</option>
                <option value="cafeteria">☕ Cafetería Clásica</option>
                <option value="restaurante">🍽️ Restaurante Moderno</option>
                <option value="peluqueria">✂️ Peluquería Elegante</option>
              </select>
            </div>
          </div>

          {/* ===== SECTION: Colors ===== */}
          <div className="section-divider" />
          <div className="section-title"><Palette size={14} /> Colores de la Tarjeta</div>
          
          {!isCustom && (
            <div style={{ padding: '0.75rem 1rem', background: 'var(--info-bg)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', color: 'var(--info)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Palette size={16} />
              Los colores están definidos por la plantilla seleccionada. Cambia a "Diseño Personalizado" para editarlos.
            </div>
          )}

          <div className="grid-cols-3">
            <div className="color-picker-group">
              <label className="input-label">Fondo</label>
              <div className="color-picker-row">
                <div className="color-swatch" style={{ backgroundColor: colors.color_fondo, opacity: isCustom ? 1 : 0.5 }}>
                  <input type="color" name="color_fondo" value={formData.color_fondo} onChange={handleChange} disabled={!isCustom} />
                </div>
                <input type="text" className="color-hex-input" value={formData.color_fondo} onChange={(e) => setFormData(prev => ({ ...prev, color_fondo: e.target.value }))} disabled={!isCustom} />
              </div>
            </div>

            <div className="color-picker-group">
              <label className="input-label">Texto</label>
              <div className="color-picker-row">
                <div className="color-swatch" style={{ backgroundColor: colors.color_texto, opacity: isCustom ? 1 : 0.5 }}>
                  <input type="color" name="color_texto" value={formData.color_texto} onChange={handleChange} disabled={!isCustom} />
                </div>
                <input type="text" className="color-hex-input" value={formData.color_texto} onChange={(e) => setFormData(prev => ({ ...prev, color_texto: e.target.value }))} disabled={!isCustom} />
              </div>
            </div>

            <div className="color-picker-group">
              <label className="input-label">Acento</label>
              <div className="color-picker-row">
                <div className="color-swatch" style={{ backgroundColor: colors.color_acento, opacity: isCustom ? 1 : 0.5 }}>
                  <input type="color" name="color_acento" value={formData.color_acento} onChange={handleChange} disabled={!isCustom} />
                </div>
                <input type="text" className="color-hex-input" value={formData.color_acento} onChange={(e) => setFormData(prev => ({ ...prev, color_acento: e.target.value }))} disabled={!isCustom} />
              </div>
            </div>
          </div>

          {/* Quick Color Presets */}
          {isCustom && (
            <div>
              <label className="input-label" style={{ marginBottom: '0.5rem', display: 'block' }}>Paletas Rápidas</label>
              <div className="color-presets">
                {COLOR_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    className={`color-preset-btn ${formData.color_fondo === p.bg && formData.color_texto === p.text ? 'active' : ''}`}
                    onClick={() => applyPreset(p)}
                    title={p.name}
                  >
                    <span className="color-preset-dot" style={{ backgroundColor: p.bg }} />
                    <span className="color-preset-dot" style={{ backgroundColor: p.text }} />
                    <span className="color-preset-dot" style={{ backgroundColor: p.accent }} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ===== SECTION: Logo & Banner ===== */}
          <div className="section-divider" />
          <div className="section-title"><ImageIcon size={14} /> Imágenes</div>

          {/* Logo Upload */}
          <div className="input-group">
            <label className="input-label">Logo del Comercio</label>
            {formData.logo_url ? (
              <div className="logo-preview-container">
                <div className="logo-preview" style={{ width: `${formData.logo_size + 20}px`, height: `${formData.logo_size + 20}px` }}>
                  <img 
                    src={formData.logo_url} 
                    alt="Logo" 
                    style={{ 
                      width: `${formData.logo_size}px`, 
                      height: `${formData.logo_size}px`, 
                      borderRadius: getLogoRadius(),
                      objectFit: 'contain' 
                    }} 
                  />
                </div>
                <div className="logo-controls">
                  <div>
                    <label className="input-label" style={{ fontSize: '0.75rem' }}>Tamaño: {formData.logo_size}px</label>
                    <input 
                      type="range" 
                      min="30" max="120" 
                      value={formData.logo_size} 
                      onChange={(e) => setFormData(prev => ({ ...prev, logo_size: parseInt(e.target.value) }))} 
                    />
                  </div>
                  <div>
                    <label className="input-label" style={{ fontSize: '0.75rem', marginBottom: '0.4rem', display: 'block' }}>Forma</label>
                    <div className="shape-selector">
                      <button type="button" className={`shape-option ${formData.logo_shape === 'circle' ? 'active' : ''}`} onClick={() => setFormData(prev => ({ ...prev, logo_shape: 'circle' }))} title="Circular">
                        <Circle size={14} />
                      </button>
                      <button type="button" className={`shape-option ${formData.logo_shape === 'rounded' ? 'active' : ''}`} onClick={() => setFormData(prev => ({ ...prev, logo_shape: 'rounded' }))} title="Redondeado">
                        <Square size={14} />
                      </button>
                      <button type="button" className={`shape-option ${formData.logo_shape === 'none' ? 'active' : ''}`} onClick={() => setFormData(prev => ({ ...prev, logo_shape: 'none' }))} title="Rectangular">
                        <RectangleHorizontal size={14} />
                      </button>
                    </div>
                  </div>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => setFormData(prev => ({ ...prev, logo_url: '' }))}>
                    <Trash2 size={14} /> Quitar Logo
                  </button>
                </div>
              </div>
            ) : (
              <div 
                className={`upload-zone ${logoDragOver ? 'dragover' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setLogoDragOver(true); }}
                onDragLeave={() => setLogoDragOver(false)}
                onDrop={(e) => handleDrop(e, 'logo_url', setLogoDragOver)}
                onClick={() => logoInputRef.current?.click()}
              >
                <Upload size={28} style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }} />
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                  Arrastra tu logo aquí o <span style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>haz click para subir</span>
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>JPG, PNG o SVG • Máximo 2MB</p>
                <input ref={logoInputRef} type="file" accept="image/jpeg,image/png,image/svg+xml" onChange={(e) => handleFileUpload(e, 'logo_url')} />
              </div>
            )}
          </div>

          {/* Banner Upload */}
          <div className="input-group">
            <label className="input-label">Banner Promocional (Opcional)</label>
            {formData.hero_image_url ? (
              <div style={{ position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                <img src={formData.hero_image_url} alt="Banner" style={{ width: '100%', height: '120px', objectFit: 'cover', display: 'block' }} />
                <button 
                  type="button" 
                  onClick={() => setFormData(prev => ({ ...prev, hero_image_url: '' }))}
                  style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '0.4rem', cursor: 'pointer', color: 'white', display: 'flex' }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ) : (
              <div 
                className={`upload-zone ${bannerDragOver ? 'dragover' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setBannerDragOver(true); }}
                onDragLeave={() => setBannerDragOver(false)}
                onDrop={(e) => handleDrop(e, 'hero_image_url', setBannerDragOver)}
                onClick={() => bannerInputRef.current?.click()}
                style={{ padding: '1rem' }}
              >
                <ImageIcon size={22} style={{ color: 'var(--text-muted)', marginBottom: '0.25rem' }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Agrega un banner promocional</p>
                <input ref={bannerInputRef} type="file" accept="image/jpeg,image/png,image/svg+xml" onChange={(e) => handleFileUpload(e, 'hero_image_url')} />
              </div>
            )}
          </div>

          {/* ===== SECTION: Custom Text ===== */}
          <div className="section-divider" />
          <div className="input-group">
            <label className="input-label" htmlFor="texto_personalizado">Texto Personalizado en Tarjeta</label>
            <textarea 
              id="texto_personalizado" 
              name="texto_personalizado" 
              className="input-field" 
              value={formData.texto_personalizado} 
              onChange={handleChange} 
              placeholder="Ej. Presenta tu tarjeta y acumula 10 sellos para obtener un café gratis..." 
              style={{ resize: 'vertical', minHeight: '70px' }}
            />
          </div>

          {/* ===== Feedback Message ===== */}
          {message.text && (
            <div style={{ 
              padding: '0.875rem 1rem', 
              backgroundColor: message.type === 'success' ? 'var(--success-bg)' : 'var(--error-bg)', 
              color: message.type === 'success' ? 'var(--success)' : 'var(--error)', 
              borderRadius: 'var(--radius-md)', 
              fontSize: '0.9rem',
              fontWeight: 500,
              animation: 'slideInUp 0.3s ease-out'
            }}>
              {message.text}
            </div>
          )}

          {/* ===== Save Button ===== */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>
              {saving ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={18} />}
              {saving ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        </form>

        {/* ===== LIVE PREVIEW PANE ===== */}
        <div>
          <div className="glass-panel" style={{ position: 'sticky', top: '2rem' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color: 'var(--accent-primary)' }}>✦</span>
              Vista Previa en Vivo
              <span className="badge badge-accent" style={{ marginLeft: 'auto' }}>LIVE</span>
            </h3>
            
            {/* Wallet Preview Card */}
            <div className="wallet-preview" style={{ 
              backgroundColor: colors.color_fondo,
              color: colors.color_texto,
            }}>
              
              {/* Header: Logo + Name */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: formData.hero_image_url ? '1rem' : '1.5rem', position: 'relative', zIndex: 1 }}>
                {formData.logo_url ? (
                  <img 
                    src={formData.logo_url} 
                    alt="Logo" 
                    style={{ 
                      width: `${formData.logo_size}px`, 
                      height: `${formData.logo_size}px`, 
                      borderRadius: getLogoRadius(),
                      objectFit: 'contain',
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      flexShrink: 0,
                    }} 
                  />
                ) : (
                  <div style={{ 
                    width: `${formData.logo_size}px`, 
                    height: `${formData.logo_size}px`, 
                    borderRadius: getLogoRadius(),
                    border: `2px dashed ${colors.color_texto}40`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.65rem', opacity: 0.6,
                    flexShrink: 0,
                  }}>Logo</div>
                )}
                <span style={{ fontWeight: 700, fontSize: '1.1rem', textAlign: 'right', flex: 1, marginLeft: '1rem', letterSpacing: '-0.01em' }}>
                  {formData.nombre || 'Tu Marca'}
                </span>
              </div>

              {/* Custom Text */}
              {formData.texto_personalizado && (
                <div style={{ marginBottom: '1rem', fontSize: '0.8rem', opacity: 0.85, whiteSpace: 'pre-wrap', lineHeight: '1.5', position: 'relative', zIndex: 1 }}>
                  {formData.texto_personalizado}
                </div>
              )}

              {/* Banner Image */}
              {formData.hero_image_url && (
                <div style={{ width: '100%', height: '130px', borderRadius: '12px', overflow: 'hidden', marginBottom: '1rem', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', position: 'relative', zIndex: 1 }}>
                  <img src={formData.hero_image_url} alt="Hero" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}

              {/* Dynamic content by type */}
              <div style={{ flex: 1, position: 'relative', zIndex: 1 }}>
                {formData.tipo_fidelizacion === 'sellos' && (
                  <div style={{ margin: '0.5rem 0' }}>
                    <div className="stamps-grid">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <div key={i} className={`stamp ${i < 3 ? 'filled' : ''}`} style={{ borderColor: `${colors.color_texto}40`, background: i < 3 ? `${colors.color_acento}30` : 'transparent' }}>
                          {i < 3 ? '✓' : ''}
                        </div>
                      ))}
                    </div>
                    <p style={{ fontSize: '0.7rem', textAlign: 'center', marginTop: '0.5rem', opacity: 0.6 }}>3 de 10 sellos</p>
                  </div>
                )}

                {formData.tipo_fidelizacion === 'niveles' && (
                  <div style={{ textAlign: 'center', margin: '0.5rem 0' }}>
                    <div style={{ display: 'inline-block', padding: '0.4rem 1rem', borderRadius: 'var(--radius-full)', background: `${colors.color_acento}30`, border: `1px solid ${colors.color_acento}60`, fontSize: '0.8rem', fontWeight: 600, color: colors.color_acento }}>
                      🏆 Nivel Bronce
                    </div>
                    <p style={{ fontSize: '0.7rem', marginTop: '0.4rem', opacity: 0.6 }}>250 puntos para Plata</p>
                  </div>
                )}
              </div>

              {/* Footer: Balance + Barcode */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: `1px dashed ${colors.color_texto}30`, paddingTop: '1.25rem', marginTop: '1rem', position: 'relative', zIndex: 1 }}>
                <div>
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, color: colors.color_acento, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    {formData.tipo_fidelizacion === 'sellos' ? 'SELLOS' : 'SALDO ACTUAL'}
                  </div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, lineHeight: 1, letterSpacing: '-0.02em' }}>
                    {formData.tipo_fidelizacion === 'sellos' ? '3/10' : '0'}
                  </div>
                  <div style={{ fontSize: '0.7rem', opacity: 0.5 }}>
                    {formData.tipo_fidelizacion === 'puntos' ? 'puntos' : formData.tipo_fidelizacion === 'niveles' ? 'puntos • Bronce' : ''}
                  </div>
                </div>
                {/* Mini QR placeholder */}
                <div style={{ 
                  width: '56px', height: '56px', 
                  backgroundColor: colors.color_texto,
                  borderRadius: '6px', 
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: '2px',
                  padding: '4px',
                  opacity: 0.8
                }}>
                  {Array.from({ length: 25 }).map((_, i) => (
                    <div key={i} style={{ backgroundColor: [0,1,2,5,6,10,12,14,18,19,20,23,24].includes(i) ? colors.color_fondo : 'transparent', borderRadius: '1px' }} />
                  ))}
                </div>
              </div>
            </div>

            {/* Template indicator */}
            <div style={{ marginTop: '1rem', textAlign: 'center' }}>
              <span className="badge badge-accent">
                {formData.plantilla_diseno === 'default' ? 'Personalizado' : formData.plantilla_diseno.charAt(0).toUpperCase() + formData.plantilla_diseno.slice(1)}
              </span>
            </div>
          </div>

          {/* ===== QR CODE FOR CUSTOMERS ===== */}
          <QRSection comercioId={comercioId} comercioNombre={formData.nombre} accentColor={colors.color_acento} />
        </div>

      </div>
    </div>
  );
}

function QRSection({ comercioId, comercioNombre, accentColor }) {
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef(null);
  
  const registrationUrl = `${window.location.origin}/registro/${comercioId}`;

  useEffect(() => {
    if (!comercioId || !canvasRef.current) return;
    import('qrcode').then((QRCode) => {
      QRCode.toCanvas(canvasRef.current, registrationUrl, {
        width: 200,
        margin: 2,
        color: { dark: '#1a1a2e', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
    });
  }, [comercioId, registrationUrl]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(registrationUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = registrationUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = `qr-${comercioNombre || 'fidelidad'}.png`;
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="glass-panel" style={{ marginTop: '1rem' }}>
      <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <QrCode size={18} style={{ color: 'var(--accent-primary)' }} />
        QR para Clientes
      </h3>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
        Imprime este QR o comparte el enlace. Los clientes lo escanean para registrarse y recibir su tarjeta de fidelidad.
      </p>

      {/* QR Code Canvas */}
      <div style={{ 
        background: '#fff', 
        borderRadius: '16px', 
        padding: '1.5rem', 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      }}>
        <canvas 
          ref={canvasRef} 
          style={{ width: '200px', height: '200px' }}
        />
        <p style={{ 
          margin: '0.75rem 0 0', 
          fontSize: '0.85rem', 
          fontWeight: 700, 
          color: '#1a1a1a',
          textAlign: 'center',
        }}>
          {comercioNombre || 'Tu Negocio'}
        </p>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.7rem', color: '#888', textAlign: 'center' }}>
          Escanea para unirte al programa de fidelidad
        </p>
      </div>

      {/* Share URL */}
      <div style={{ marginTop: '1rem' }}>
        <label className="input-label" style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Link size={12} /> Enlace de registro
        </label>
        <div style={{ 
          display: 'flex', 
          gap: '0.5rem',
          marginTop: '0.3rem',
        }}>
          <input
            type="text"
            readOnly
            value={registrationUrl}
            className="input-field"
            style={{ fontSize: '0.75rem', flex: 1 }}
            onClick={(e) => e.target.select()}
          />
          <button
            type="button"
            className={`btn ${copied ? 'btn-success' : 'btn-accent'} btn-sm`}
            onClick={handleCopy}
            style={{ whiteSpace: 'nowrap', minWidth: '80px' }}
          >
            {copied ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar</>}
          </button>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
        <button
          type="button"
          className="btn btn-accent btn-sm"
          onClick={handleDownload}
          style={{ flex: 1 }}
        >
          <Download size={14} /> Descargar QR
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => window.open(registrationUrl, '_blank')}
          style={{ flex: 1 }}
        >
          <Smartphone size={14} /> Probar
        </button>
      </div>
    </div>
  );
}

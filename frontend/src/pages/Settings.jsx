import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Save, Loader2, Upload, ImageIcon, Trash2, Circle, Square, RectangleHorizontal, Palette, QrCode, Link, Smartphone, Copy, Check, Download, KeyRound, Eye, EyeOff, MapPin, Plus } from 'lucide-react';

const TEMPLATE_COLORS = {
  default:     null,
  cafeteria:   { color_fondo: '#2C1A0E', color_texto: '#F5DEB3', color_acento: '#C8943A' },
  restaurante: { color_fondo: '#1A0505', color_texto: '#F5E6D3', color_acento: '#C0392B' },
  panaderia:   { color_fondo: '#2D1B10', color_texto: '#FEF3C7', color_acento: '#D97706' },
  bar:         { color_fondo: '#0D0B18', color_texto: '#E8D5A3', color_acento: '#F59E0B' },
  peluqueria:  { color_fondo: '#111111', color_texto: '#F5F5F5', color_acento: '#C9B037' },
  spa:         { color_fondo: '#12302A', color_texto: '#E8F5F0', color_acento: '#4CAF9A' },
  farmacia:    { color_fondo: '#0A2318', color_texto: '#D1FAE5', color_acento: '#22C55E' },
  boutique:    { color_fondo: '#1A0F2E', color_texto: '#EDE0FF', color_acento: '#A855F7' },
  gimnasio:    { color_fondo: '#0A0A0A', color_texto: '#F5F5F5', color_acento: '#EF4444' },
  libreria:    { color_fondo: '#1E1B4B', color_texto: '#EDE9FE', color_acento: '#818CF8' },
  hotel:       { color_fondo: '#18140F', color_texto: '#F5ECD7', color_acento: '#BFA173' },
  tecnologia:  { color_fondo: '#060D1F', color_texto: '#BFDBFE', color_acento: '#3B82F6' },
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

// Ajusta logo/banner en el navegador (canvas, sin límite de CPU) antes de
// subirlo, para que el servidor reciba imágenes ya del tamaño correcto:
// - logo: recorte cuadrado centrado (600x600)
// - banner: proporción ~3:1 que exige Apple Wallet (1125x369), con el punto
//   de recorte sesgado hacia arriba para no perder logos/texto en la parte
//   superior de la imagen
function processImageFile(file, mode) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const srcW = img.naturalWidth, srcH = img.naturalHeight;

        if (mode === 'icon') {
          // 512x512 con fondo blanco opaco — igual que Digital Zeta.
          // Apple rechaza icon.png con transparencia (alfa), fondo blanco es obligatorio.
          const size = 512;
          const scale = Math.min(size / srcW, size / srcH);
          const newW = srcW * scale, newH = srcH * scale;
          const offsetX = (size - newW) / 2, offsetY = (size - newH) / 2;
          const canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#0b2c65';
          ctx.fillRect(0, 0, size, size);
          ctx.drawImage(img, offsetX, offsetY, newW, newH);
          resolve(canvas.toDataURL('image/png'));
          return;
        }

        const canvasW = mode === 'banner' ? 1125 : 600;
        const canvasH = mode === 'banner' ? 369 : 600;
        const verticalBias = mode === 'banner' ? 0.2 : 0.5;

        const scale = Math.max(canvasW / srcW, canvasH / srcH);
        const newW = srcW * scale, newH = srcH * scale;
        const offsetX = (newW - canvasW) * 0.5;
        const offsetY = (newH - canvasH) * verticalBias;

        const canvas = document.createElement('canvas');
        canvas.width = canvasW;
        canvas.height = canvasH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, -offsetX, -offsetY, newW, newH);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('No se pudo cargar la imagen')); };
    img.src = objectUrl;
  });
}

export default function Settings() {
  const { comercioId } = useAuth();

  const [formData, setFormData] = useState({
    nombre: '',
    slogan: '',
    telefono: '',
    sitio_web: '',
    plantilla_diseno: 'default',
    tipo_fidelizacion: 'puntos',
    color_fondo: '#1a1a2e',
    color_texto: '#e0e0e0',
    color_acento: '#e94560',
    texto_personalizado: '',
    dias_expiracion: 365,
    logo_url: '',
    icon_url: '',
    hero_image_url: '',
    logo_size: 50,
    logo_shape: 'circle',
    config_fidelizacion: {
      meta_sellos: 10,
      puntos_para_recompensa: 100,
      descripcion_recompensa: '',
      ubicaciones: [],
    },
  });
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [logoDragOver, setLogoDragOver] = useState(false);
  const [iconDragOver, setIconDragOver] = useState(false);
  const [bannerDragOver, setBannerDragOver] = useState(false);
  const logoInputRef = useRef(null);
  const iconInputRef = useRef(null);
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
          slogan: data.slogan || '',
          telefono: data.telefono || '',
          sitio_web: data.sitio_web || '',
          plantilla_diseno: data.plantilla_diseno || 'default',
          tipo_fidelizacion: data.tipo_fidelizacion || 'puntos',
          color_fondo: data.color_fondo || '#1a1a2e',
          color_texto: data.color_texto || '#e0e0e0',
          color_acento: data.color_acento || '#e94560',
          texto_personalizado: data.texto_personalizado || '',
          dias_expiracion: data.dias_expiracion || 365,
          logo_url: data.logo_url || '',
          icon_url: data.icon_url || '',
          hero_image_url: data.hero_image_url || '',
          logo_size: data.logo_size || 50,
          logo_shape: data.logo_shape || 'circle',
          config_fidelizacion: {
            meta_sellos: data.config_fidelizacion?.meta_sellos || 10,
            puntos_para_recompensa: data.config_fidelizacion?.puntos_para_recompensa || 100,
            descripcion_recompensa: data.config_fidelizacion?.descripcion_recompensa || '',
            ubicaciones: data.config_fidelizacion?.ubicaciones || [],
          },
        });
      }
      setLoading(false);
    };

    loadSettings();
  }, [comercioId]);

  const handleFileUpload = async (e, field) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setMessage({ text: 'El archivo no debe superar 8MB.', type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 4000);
      return;
    }
    try {
      const mode = field === 'hero_image_url' ? 'banner' : field === 'icon_url' ? 'icon' : 'logo';
      const processed = await processImageFile(file, mode);
      setFormData(prev => ({ ...prev, [field]: processed }));
    } catch (err) {
      console.error(err);
      setMessage({ text: 'No se pudo procesar la imagen. Intenta con otro archivo.', type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 4000);
    }
  };

  const handleDrop = async (e, field, setDragState) => {
    e.preventDefault();
    setDragState(false);
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 8 * 1024 * 1024) {
      setMessage({ text: 'El archivo no debe superar 8MB.', type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 4000);
      return;
    }
    try {
      const mode = field === 'hero_image_url' ? 'banner' : field === 'icon_url' ? 'icon' : 'logo';
      const processed = await processImageFile(file, mode);
      setFormData(prev => ({ ...prev, [field]: processed }));
    } catch (err) {
      console.error(err);
      setMessage({ text: 'No se pudo procesar la imagen. Intenta con otro archivo.', type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 4000);
    }
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

  const handleConfigChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      config_fidelizacion: { ...prev.config_fidelizacion, [field]: value },
    }));
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
          <div className="input-group">
            <label className="input-label" htmlFor="slogan">Slogan o Tagline <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(opcional)</span></label>
            <input type="text" id="slogan" name="slogan" className="input-field" value={formData.slogan} onChange={handleChange} placeholder="Ej. El mejor café de la ciudad" maxLength={60} />
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Aparece en el frente y reverso de la tarjeta Wallet.</p>
          </div>

          {/* ===== SECTION: Contact ===== */}
          <div className="section-divider" />
          <div className="section-title">Datos de Contacto</div>
          <div className="grid-cols-2">
            <div className="input-group">
              <label className="input-label" htmlFor="telefono">Teléfono</label>
              <input type="tel" id="telefono" name="telefono" className="input-field" value={formData.telefono} onChange={handleChange} placeholder="+51 999 123 456" />
            </div>
            <div className="input-group">
              <label className="input-label" htmlFor="sitio_web">Sitio Web</label>
              <input type="url" id="sitio_web" name="sitio_web" className="input-field" value={formData.sitio_web} onChange={handleChange} placeholder="https://tucomercio.com" />
            </div>
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '-0.25rem' }}>Aparecen en el reverso de la tarjeta Wallet como links interactivos (llamar / abrir web).</p>

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
                <option value="default">✏️ Diseño Personalizado</option>
                <optgroup label="Gastronomía">
                  <option value="cafeteria">☕ Cafetería / Café Bar</option>
                  <option value="restaurante">🍽️ Restaurante</option>
                  <option value="panaderia">🥐 Panadería / Pastelería</option>
                  <option value="bar">🍹 Bar / Pub / Cocteles</option>
                </optgroup>
                <optgroup label="Salud &amp; Belleza">
                  <option value="peluqueria">✂️ Peluquería / Barbería</option>
                  <option value="spa">🌿 Spa / Centro de Bienestar</option>
                  <option value="farmacia">💊 Farmacia / Botica</option>
                </optgroup>
                <optgroup label="Estilo de Vida">
                  <option value="boutique">👗 Boutique / Moda</option>
                  <option value="gimnasio">💪 Gimnasio / Fitness</option>
                  <option value="libreria">📚 Librería / Papelería</option>
                </optgroup>
                <optgroup label="Servicios">
                  <option value="hotel">🏨 Hotel / Hospedaje</option>
                  <option value="tecnologia">💻 Tecnología / Electrónica</option>
                </optgroup>
              </select>
            </div>
          </div>

          {/* ===== SECTION: Loyalty Config ===== */}
          <div className="section-divider" />
          <div className="section-title">Configuración de Recompensas</div>

          {formData.tipo_fidelizacion === 'sellos' && (
            <div className="input-group">
              <label className="input-label" htmlFor="meta_sellos">Meta de Sellos</label>
              <input
                type="number" id="meta_sellos" className="input-field"
                min="2" max="50"
                value={formData.config_fidelizacion.meta_sellos}
                onChange={(e) => handleConfigChange('meta_sellos', parseInt(e.target.value) || 10)}
              />
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Número de sellos que el cliente debe acumular para ganar su recompensa.</p>
            </div>
          )}

          {formData.tipo_fidelizacion === 'puntos' && (
            <div className="input-group">
              <label className="input-label" htmlFor="puntos_para_recompensa">Puntos para Recompensa</label>
              <input
                type="number" id="puntos_para_recompensa" className="input-field"
                min="1"
                value={formData.config_fidelizacion.puntos_para_recompensa}
                onChange={(e) => handleConfigChange('puntos_para_recompensa', parseInt(e.target.value) || 100)}
              />
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Puntos necesarios para canjear una recompensa (se muestra en la tarjeta).</p>
            </div>
          )}

          {formData.tipo_fidelizacion === 'niveles' && (
            <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <strong>Umbrales automáticos:</strong><br />
              🥉 Bronce: 0 – 499 puntos &nbsp;|&nbsp; 🥈 Plata: 500 – 999 pts &nbsp;|&nbsp; 🥇 Oro: 1000+ puntos
            </div>
          )}

          <div className="input-group" style={{ marginTop: '0.75rem' }}>
            <label className="input-label" htmlFor="descripcion_recompensa">Descripción de la Recompensa</label>
            <textarea
              id="descripcion_recompensa" className="input-field"
              value={formData.config_fidelizacion.descripcion_recompensa}
              onChange={(e) => handleConfigChange('descripcion_recompensa', e.target.value)}
              placeholder="Ej. Café gratis al completar 10 sellos | 10% de descuento al llegar a 100 puntos..."
              style={{ resize: 'vertical', minHeight: '64px' }}
            />
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Aparece en el reverso de la tarjeta Wallet cuando el cliente toca el ícono de info.</p>
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
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>JPG, PNG o SVG • Máximo 8MB • Se recorta automáticamente a cuadrado</p>
                <input ref={logoInputRef} type="file" accept="image/jpeg,image/png,image/svg+xml" onChange={(e) => handleFileUpload(e, 'logo_url')} />
              </div>
            )}
          </div>

          {/* Icon Upload */}
          <div className="input-group">
            <label className="input-label">Icono de Notificación Wallet
              <span style={{ marginLeft: '0.4rem', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>— aparece en las alertas de sello en iPhone</span>
            </label>
            {formData.icon_url ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <img src={formData.icon_url} alt="Icono" style={{ width: '72px', height: '72px', borderRadius: '16px', objectFit: 'contain', border: '1px solid var(--border-subtle)', background: '#fff' }} />
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Icono guardado — se usará como ícono en notificaciones de Apple Wallet.</p>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => setFormData(prev => ({ ...prev, icon_url: '' }))}>
                    <Trash2 size={14} /> Quitar Icono
                  </button>
                </div>
              </div>
            ) : (
              <div
                className={`upload-zone ${iconDragOver ? 'dragover' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setIconDragOver(true); }}
                onDragLeave={() => setIconDragOver(false)}
                onDrop={(e) => handleDrop(e, 'icon_url', setIconDragOver)}
                onClick={() => iconInputRef.current?.click()}
                style={{ padding: '1rem' }}
              >
                <Smartphone size={22} style={{ color: 'var(--text-muted)', marginBottom: '0.25rem' }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Sube el ícono cuadrado de tu marca</p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.15rem' }}>Tamaño recomendado: 512×512 px. Solo PNG. Debe ser cuadrado con fondo de color.</p>
                <input ref={iconInputRef} type="file" accept="image/png,image/jpeg" onChange={(e) => handleFileUpload(e, 'icon_url')} />
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
                <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.15rem' }}>Se ajusta automáticamente al ancho de la tarjeta — máximo 8MB</p>
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

          {/* ===== SECTION: Locations ===== */}
          <div className="section-divider" />
          <div className="section-title"><MapPin size={14} /> Ubicaciones de tus Locales</div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
            Cuando el cliente esté a ~100m, Apple Wallet muestra tu tarjeta automáticamente en su pantalla de bloqueo.
            Puedes agregar hasta 10 locales.
          </p>

          {(formData.config_fidelizacion.ubicaciones || []).map((loc, idx) => (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'flex-end' }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                {idx === 0 && <label className="input-label">Nombre del local</label>}
                <input
                  type="text"
                  className="input-field"
                  placeholder="Ej. Mallplaza"
                  value={loc.nombre || ''}
                  onChange={e => {
                    const updated = [...(formData.config_fidelizacion.ubicaciones || [])];
                    updated[idx] = { ...updated[idx], nombre: e.target.value };
                    handleConfigChange('ubicaciones', updated);
                  }}
                />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                {idx === 0 && <label className="input-label">Latitud</label>}
                <input
                  type="number"
                  step="any"
                  className="input-field"
                  placeholder="-16.3988"
                  value={loc.lat || ''}
                  onChange={e => {
                    const updated = [...(formData.config_fidelizacion.ubicaciones || [])];
                    updated[idx] = { ...updated[idx], lat: e.target.value };
                    handleConfigChange('ubicaciones', updated);
                  }}
                />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                {idx === 0 && <label className="input-label">Longitud</label>}
                <input
                  type="number"
                  step="any"
                  className="input-field"
                  placeholder="-71.5350"
                  value={loc.lng || ''}
                  onChange={e => {
                    const updated = [...(formData.config_fidelizacion.ubicaciones || [])];
                    updated[idx] = { ...updated[idx], lng: e.target.value };
                    handleConfigChange('ubicaciones', updated);
                  }}
                />
              </div>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                style={{ marginTop: idx === 0 ? '1.4rem' : 0 }}
                onClick={() => {
                  const updated = (formData.config_fidelizacion.ubicaciones || []).filter((_, i) => i !== idx);
                  handleConfigChange('ubicaciones', updated);
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          {(formData.config_fidelizacion.ubicaciones || []).length < 10 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginTop: '0.5rem' }}
              onClick={() => {
                const updated = [...(formData.config_fidelizacion.ubicaciones || []), { nombre: '', lat: '', lng: '' }];
                handleConfigChange('ubicaciones', updated);
              }}
            >
              <Plus size={14} /> Agregar local
            </button>
          )}
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            Tip: busca las coordenadas en <strong>Google Maps</strong> → clic derecho sobre el local → copia lat/lng.
          </p>

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
        <div style={{ position: 'sticky', top: '2rem', alignSelf: 'start', maxHeight: 'calc(100vh - 4rem)', overflowY: 'auto' }}>
          <div className="glass-panel">
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
              
              {/* Header: Logo + Name + Slogan */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: formData.hero_image_url ? '0.75rem' : '1.25rem', position: 'relative', zIndex: 1 }}>
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
                <div style={{ flex: 1, marginLeft: '1rem', textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, fontSize: '1.05rem', letterSpacing: '-0.01em' }}>
                    {formData.nombre || 'Tu Marca'}
                  </div>
                  {formData.slogan && (
                    <div style={{ fontSize: '0.68rem', opacity: 0.65, marginTop: '2px', fontStyle: 'italic' }}>
                      {formData.slogan}
                    </div>
                  )}
                </div>
              </div>

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

              {/* Footer: Balance + Next Reward + Barcode */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: `1px dashed ${colors.color_texto}30`, paddingTop: '1.25rem', marginTop: '1rem', position: 'relative', zIndex: 1 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.6rem', fontWeight: 700, color: colors.color_acento, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '2px' }}>
                    {formData.tipo_fidelizacion === 'sellos' ? 'SELLOS' : formData.tipo_fidelizacion === 'niveles' ? 'NIVEL' : 'PUNTOS'}
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, lineHeight: 1, letterSpacing: '-0.02em' }}>
                    {formData.tipo_fidelizacion === 'sellos'
                      ? `0/${formData.config_fidelizacion.meta_sellos}`
                      : formData.tipo_fidelizacion === 'niveles' ? 'Bronce' : '0'}
                  </div>
                  <div style={{ fontSize: '0.62rem', opacity: 0.55, marginTop: '3px' }}>
                    {formData.tipo_fidelizacion === 'puntos'
                      ? `Próx. recompensa en ${formData.config_fidelizacion.puntos_para_recompensa} pts`
                      : formData.tipo_fidelizacion === 'niveles'
                      ? 'Plata en 500 pts'
                      : `${formData.config_fidelizacion.meta_sellos} sellos = premio`}
                  </div>
                </div>
                {/* Mini QR placeholder */}
                <div style={{
                  width: '52px', height: '52px',
                  backgroundColor: colors.color_texto,
                  borderRadius: '6px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: '2px',
                  padding: '4px',
                  opacity: 0.85,
                  flexShrink: 0,
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

      {/* ===== CHANGE PASSWORD SECTION ===== */}
      <ChangePasswordSection />
    </div>
  );
}

// Defined outside ChangePasswordSection to keep a stable reference across renders
// (inline component definitions cause React to remount on every render, losing focus)
function PasswordField({ id, label, value, show, onToggleShow, onChange }) {
  return (
    <div className="input-group">
      <label className="input-label" htmlFor={id}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          type={show ? 'text' : 'password'}
          className="input-field"
          placeholder="••••••••"
          value={value}
          onChange={onChange}
          required
          style={{ paddingRight: '2.75rem' }}
        />
        <button
          type="button"
          onClick={onToggleShow}
          style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem', display: 'flex' }}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

function ChangePasswordSection() {
  const [form, setForm] = useState({ newPass: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [show, setShow] = useState({ newPass: false, confirm: false });

  const toggleShow = (field) => setShow(prev => ({ ...prev, [field]: !prev[field] }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });

    if (form.newPass !== form.confirm) {
      setMessage({ text: 'Las contraseñas nuevas no coinciden.', type: 'error' });
      return;
    }
    if (form.newPass.length < 6) {
      setMessage({ text: 'La nueva contraseña debe tener al menos 6 caracteres.', type: 'error' });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: form.newPass });
      if (error) throw error;
      setMessage({ text: '✓ Contraseña cambiada exitosamente.', type: 'success' });
      setForm({ newPass: '', confirm: '' });
    } catch (err) {
      console.error(err);
      setMessage({ text: 'Error al cambiar la contraseña. Intenta de nuevo.', type: 'error' });
    } finally {
      setLoading(false);
      setTimeout(() => setMessage({ text: '', type: '' }), 5000);
    }
  };

  return (
    <div className="glass-panel settings-section" style={{ marginTop: '1.5rem' }}>
      <div className="section-title"><KeyRound size={14} /> Cambiar Contraseña</div>

      <form onSubmit={handleSubmit}>
        <div className="grid-cols-2">
          <PasswordField
            id="newPass" label="Nueva Contraseña"
            value={form.newPass} show={show.newPass}
            onToggleShow={() => toggleShow('newPass')}
            onChange={e => setForm(prev => ({ ...prev, newPass: e.target.value }))}
          />
          <PasswordField
            id="confirm" label="Confirmar Nueva Contraseña"
            value={form.confirm} show={show.confirm}
            onToggleShow={() => toggleShow('confirm')}
            onChange={e => setForm(prev => ({ ...prev, confirm: e.target.value }))}
          />
        </div>

        {message.text && (
          <div style={{
            padding: '0.75rem 1rem', marginTop: '0.75rem',
            backgroundColor: message.type === 'success' ? 'var(--success-bg)' : 'var(--error-bg)',
            color: message.type === 'success' ? 'var(--success)' : 'var(--error)',
            borderRadius: 'var(--radius-md)', fontSize: '0.875rem', fontWeight: 500,
          }}>
            {message.text}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="submit" className="btn btn-secondary" disabled={loading}>
            {loading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <KeyRound size={16} />}
            {loading ? 'Cambiando...' : 'Cambiar Contraseña'}
          </button>
        </div>
      </form>
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

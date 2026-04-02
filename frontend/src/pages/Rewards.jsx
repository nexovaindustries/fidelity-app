import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Gift, Plus, Edit3, Trash2, Loader2, Star, ToggleLeft, ToggleRight, X, Save, AlertCircle } from 'lucide-react';

const EMPTY_REWARD = {
  nombre: '',
  descripcion: '',
  costo_puntos: 100,
  activa: true,
};

export default function Rewards() {
  const { comercioId } = useAuth();
  const [rewards, setRewards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingReward, setEditingReward] = useState(null);
  const [formData, setFormData] = useState(EMPTY_REWARD);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [message, setMessage] = useState({ text: '', type: '' });

  useEffect(() => {
    if (!comercioId) return;
    fetchRewards();
  }, [comercioId]);

  const fetchRewards = async () => {
    try {
      const { data, error } = await supabase
        .from('recompensas')
        .select('*')
        .eq('comercio_id', comercioId)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setRewards(data);
      }
    } catch (err) {
      console.error('Error loading rewards:', err);
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingReward(null);
    setFormData(EMPTY_REWARD);
    setShowModal(true);
  };

  const openEdit = (reward) => {
    setEditingReward(reward);
    setFormData({
      nombre: reward.nombre,
      descripcion: reward.descripcion || '',
      costo_puntos: reward.costo_puntos,
      activa: reward.activa,
    });
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      if (editingReward) {
        // Update
        const { error } = await supabase
          .from('recompensas')
          .update({
            nombre: formData.nombre,
            descripcion: formData.descripcion,
            costo_puntos: parseInt(formData.costo_puntos),
            activa: formData.activa,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingReward.id);

        if (error) throw error;
        showToast('Recompensa actualizada correctamente', 'success');
      } else {
        // Create
        const { error } = await supabase
          .from('recompensas')
          .insert([{
            comercio_id: comercioId,
            nombre: formData.nombre,
            descripcion: formData.descripcion,
            costo_puntos: parseInt(formData.costo_puntos),
            activa: formData.activa,
          }]);

        if (error) throw error;
        showToast('Recompensa creada exitosamente', 'success');
      }

      setShowModal(false);
      fetchRewards();
    } catch (err) {
      console.error(err);
      showToast('Error al guardar la recompensa', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (reward) => {
    try {
      const { error } = await supabase
        .from('recompensas')
        .update({ activa: !reward.activa, updated_at: new Date().toISOString() })
        .eq('id', reward.id);

      if (error) throw error;
      fetchRewards();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id) => {
    try {
      const { error } = await supabase
        .from('recompensas')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setDeleteConfirm(null);
      showToast('Recompensa eliminada', 'success');
      fetchRewards();
    } catch (err) {
      console.error(err);
      showToast('Error al eliminar', 'error');
    }
  };

  const showToast = (text, type) => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 4000);
  };

  if (loading) {
    return (
      <div className="stagger-children">
        <div className="page-header">
          <div className="skeleton" style={{ width: '200px', height: '30px', marginBottom: '0.5rem' }} />
          <div className="skeleton" style={{ width: '280px', height: '18px' }} />
        </div>
        <div className="grid-cols-3" style={{ marginTop: '1rem' }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="skeleton" style={{ height: '200px', borderRadius: 'var(--radius-lg)' }} />
          ))}
        </div>
      </div>
    );
  }

  const activeRewards = rewards.filter(r => r.activa);
  const inactiveRewards = rewards.filter(r => !r.activa);

  return (
    <div className="animate-fade-in">
      {/* Toast */}
      {message.text && (
        <div className={`toast ${message.type === 'success' ? 'toast-success' : 'toast-error'}`}>
          {message.type === 'success' ? <Star size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '2rem' }}>
        <div>
          <h1 className="page-title">Recompensas</h1>
          <p className="page-subtitle">Configura qué pueden canjear tus clientes con sus puntos</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus size={18} />
          Nueva Recompensa
        </button>
      </div>

      {rewards.length > 0 ? (
        <>
          {/* Active Rewards */}
          {activeRewards.length > 0 && (
            <>
              <div className="section-title" style={{ marginBottom: '1rem' }}>
                <Gift size={14} /> Activas ({activeRewards.length})
              </div>
              <div className="grid-cols-3 stagger-children" style={{ marginBottom: '2rem' }}>
                {activeRewards.map((r) => (
                  <div key={r.id} className="glass-panel reward-card">
                    <div className="reward-card-header">
                      <div className="reward-card-cost">
                        <Star size={16} />
                        {r.costo_puntos} pts
                      </div>
                      <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(r)} title="Desactivar">
                        <ToggleRight size={20} style={{ color: 'var(--success)' }} />
                      </button>
                    </div>
                    
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>{r.nombre}</h3>
                    {r.descripcion && (
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{r.descripcion}</p>
                    )}
                    
                    <div className="reward-card-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)}>
                        <Edit3 size={14} /> Editar
                      </button>
                      {deleteConfirm === r.id ? (
                        <div style={{ display: 'flex', gap: '0.25rem', marginLeft: 'auto' }}>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(r.id)}>Confirmar</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirm(null)}>No</button>
                        </div>
                      ) : (
                        <button className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirm(r.id)} style={{ marginLeft: 'auto', color: 'var(--error)' }}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Inactive Rewards */}
          {inactiveRewards.length > 0 && (
            <>
              <div className="section-title" style={{ marginBottom: '1rem' }}>
                Inactivas ({inactiveRewards.length})
              </div>
              <div className="grid-cols-3">
                {inactiveRewards.map((r) => (
                  <div key={r.id} className="glass-panel reward-card" style={{ opacity: 0.6 }}>
                    <div className="reward-card-header">
                      <div className="reward-card-cost" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                        <Star size={16} />
                        {r.costo_puntos} pts
                      </div>
                      <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(r)} title="Activar">
                        <ToggleLeft size={20} style={{ color: 'var(--text-muted)' }} />
                      </button>
                    </div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>{r.nombre}</h3>
                    {r.descripcion && (
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{r.descripcion}</p>
                    )}
                    <div className="reward-card-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)}>
                        <Edit3 size={14} /> Editar
                      </button>
                      {deleteConfirm === r.id ? (
                        <div style={{ display: 'flex', gap: '0.25rem', marginLeft: 'auto' }}>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(r.id)}>Confirmar</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirm(null)}>No</button>
                        </div>
                      ) : (
                        <button className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirm(r.id)} style={{ marginLeft: 'auto', color: 'var(--error)' }}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="glass-panel">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Gift size={28} />
            </div>
            <h3>Sin recompensas configuradas</h3>
            <p>Crea tu primera recompensa para que tus clientes puedan canjear sus puntos</p>
            <button className="btn btn-primary" onClick={openCreate} style={{ marginTop: '1rem' }}>
              <Plus size={16} /> Crear Primera Recompensa
            </button>
          </div>
        </div>
      )}

      {/* ===== Create/Edit Modal ===== */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.25rem' }}>
                {editingReward ? 'Editar Recompensa' : 'Nueva Recompensa'}
              </h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="input-group">
                <label className="input-label" htmlFor="reward-nombre">Nombre de la Recompensa *</label>
                <input 
                  type="text" 
                  id="reward-nombre" 
                  className="input-field" 
                  value={formData.nombre} 
                  onChange={(e) => setFormData(prev => ({ ...prev, nombre: e.target.value }))} 
                  placeholder="Ej. Café Americano Gratis"
                  required 
                />
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="reward-descripcion">Descripción</label>
                <textarea 
                  id="reward-descripcion" 
                  className="input-field" 
                  value={formData.descripcion} 
                  onChange={(e) => setFormData(prev => ({ ...prev, descripcion: e.target.value }))} 
                  placeholder="Ej. Canjea tus puntos por un café americano de cualquier tamaño..."
                  style={{ resize: 'vertical', minHeight: '80px' }}
                />
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="reward-costo">Costo en Puntos *</label>
                <input 
                  type="number" 
                  id="reward-costo" 
                  className="input-field" 
                  value={formData.costo_puntos} 
                  onChange={(e) => setFormData(prev => ({ ...prev, costo_puntos: e.target.value }))} 
                  min="1"
                  required 
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Los clientes necesitarán esta cantidad de puntos para canjear esta recompensa
                </span>
              </div>

              {/* Preview */}
              <div style={{ padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Vista previa</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: 'var(--radius-md)', background: 'var(--accent-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)' }}>
                    <Gift size={22} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{formData.nombre || 'Nombre de la recompensa'}</p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', fontWeight: 600 }}>
                      ★ {formData.costo_puntos || 0} puntos
                    </p>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={saving}>
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {saving ? 'Guardando...' : editingReward ? 'Actualizar' : 'Crear Recompensa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

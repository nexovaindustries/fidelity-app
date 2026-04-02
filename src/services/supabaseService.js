const supabase = require('../config/supabase');
const { v4: uuidv4 } = require('uuid');

/**
 * Busca un cliente por email. Si no existe, lo crea.
 */
const getOrCreateClient = async (email, nombre_completo, telefono = null) => {
  const { data: existingClient, error: searchError } = await supabase
    .from('clientes')
    .select('*')
    .eq('email', email)
    .single();

  if (searchError && searchError.code !== 'PGRST116') {
    throw searchError;
  }

  if (existingClient) {
    return existingClient;
  }

  const insertPayload = { email, nombre_completo };
  if (telefono) insertPayload.telefono = telefono;

  const { data: newClient, error: insertError } = await supabase
    .from('clientes')
    .insert([insertPayload])
    .select()
    .single();

  if (insertError) throw insertError;

  return newClient;
};

/**
 * Crea o recupera una tarjeta para el binomio Comercio-Cliente
 */
const issueLoyaltyCard = async (comercio_id, cliente_id) => {
  const { data: existingCard, error: searchError } = await supabase
    .from('tarjetas_activas')
    .select('*, comercios(*)')
    .eq('comercio_id', comercio_id)
    .eq('cliente_id', cliente_id)
    .single();

  if (searchError && searchError.code !== 'PGRST116') {
    throw searchError;
  }

  if (existingCard) {
    return existingCard;
  }

  const { data: comercioInfo, error: comercioError } = await supabase
    .from('comercios')
    .select('tipo_fidelizacion, config_fidelizacion, dias_expiracion')
    .eq('id', comercio_id)
    .single();
    
  if (comercioError) {
    throw new Error('Comercio no encontrado: ' + comercioError.message);
  }

  const qr_value = `FID-${uuidv4().substring(0,8).toUpperCase()}-${comercio_id.substring(0,4).toUpperCase()}`;

  const dias_expiracion = comercioInfo.dias_expiracion || 365;
  const fecha_expiracion = new Date();
  fecha_expiracion.setDate(fecha_expiracion.getDate() + dias_expiracion);

  const tipoFidelizacion = comercioInfo.tipo_fidelizacion || 'puntos';

  const insertPayload = {
    comercio_id,
    cliente_id,
    qr_value,
    fecha_expiracion: fecha_expiracion.toISOString(),
    puntos_actuales: 0,
    total_sellos: 0,
    nivel_actual: tipoFidelizacion === 'niveles' ? 'Bronce' : null
  };

  const { data: newCard, error: insertError } = await supabase
    .from('tarjetas_activas')
    .insert([insertPayload])
    .select('*, comercios(*)')
    .single();

  if (insertError) throw insertError;

  return newCard;
};

/**
 * Procesa una transacción y la registra en el log
 */
const processTransaction = async (comercio_id, qr_value, accion = 'sumar', cantidad = 1) => {
  // 1. Buscar la tarjeta
  const { data: tarjeta, error: errorSearch } = await supabase
    .from('tarjetas_activas')
    .select('*, comercios(*), clientes(*)')
    .eq('qr_value', qr_value)
    .eq('comercio_id', comercio_id)
    .single();

  if (errorSearch || !tarjeta) {
    throw new Error('STATUS_404: Tarjeta no encontrada o no pertenece a este comercio.');
  }

  // 2. Validar expiración
  if (tarjeta.fecha_expiracion && new Date(tarjeta.fecha_expiracion) < new Date()) {
    throw new Error('STATUS_400: La tarjeta de fidelidad ha expirado.');
  }

  // 3. Procesar lógica según tipo
  const tipo = tarjeta.comercios.tipo_fidelizacion || 'puntos';
  let updatePayload = {};

  if (tipo === 'puntos') {
    const curr = tarjeta.puntos_actuales || 0;
    updatePayload.puntos_actuales = accion === 'sumar' ? curr + cantidad : Math.max(0, curr - cantidad);
  } else if (tipo === 'sellos') {
    const curr = tarjeta.total_sellos || 0;
    updatePayload.total_sellos = accion === 'sumar' ? curr + cantidad : Math.max(0, curr - cantidad);
  } else if (tipo === 'niveles') {
    const curr = tarjeta.puntos_actuales || 0;
    const newPoints = accion === 'sumar' ? curr + cantidad : Math.max(0, curr - cantidad);
    updatePayload.puntos_actuales = newPoints;
    
    let newLevel = 'Bronce';
    if (newPoints >= 1000) newLevel = 'Oro';
    else if (newPoints >= 500) newLevel = 'Plata';
    
    updatePayload.nivel_actual = newLevel;
  }

  // 4. Actualizar registro
  const { data: updatedCard, error: updateError } = await supabase
    .from('tarjetas_activas')
    .update(updatePayload)
    .eq('id', tarjeta.id)
    .select('*, comercios(*), clientes(*)')
    .single();

  if (updateError) throw updateError;

  // 5. Log the transaction (fire and forget - don't fail the main operation)
  try {
    await supabase
      .from('transacciones')
      .insert([{
        comercio_id,
        tarjeta_id: tarjeta.id,
        tipo: accion,
        cantidad,
        descripcion: `${accion === 'sumar' ? '+' : '-'}${cantidad} ${tipo}`,
      }]);
  } catch (logError) {
    console.error('Transaction log error (non-critical):', logError);
  }

  return updatedCard;
};

/**
 * Obtiene estadísticas del dashboard
 */
const getDashboardStats = async (comercio_id) => {
  const stats = {
    activeCards: 0,
    weekScans: 0,
    totalRewardsActive: 0,
    weeklyBreakdown: [],
    recentTransactions: [],
  };

  // Active cards
  const { count: cardsCount } = await supabase
    .from('tarjetas_activas')
    .select('*', { count: 'exact', head: true })
    .eq('comercio_id', comercio_id);
  stats.activeCards = cardsCount || 0;

  // Week transactions
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  try {
    const { data: transactions } = await supabase
      .from('transacciones')
      .select('*')
      .eq('comercio_id', comercio_id)
      .gte('created_at', oneWeekAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(100);

    if (transactions) {
      stats.weekScans = transactions.length;
      stats.recentTransactions = transactions.slice(0, 10);
    }
  } catch {
    // table might not exist
  }

  // Active rewards count
  try {
    const { count: rewardsCount } = await supabase
      .from('recompensas')
      .select('*', { count: 'exact', head: true })
      .eq('comercio_id', comercio_id)
      .eq('activa', true);
    stats.totalRewardsActive = rewardsCount || 0;
  } catch {
    // table might not exist
  }

  return stats;
};

/**
 * Lista clientes de un comercio con sus tarjetas
 */
const getCustomers = async (comercio_id) => {
  const { data, error } = await supabase
    .from('tarjetas_activas')
    .select('*, clientes(*)')
    .eq('comercio_id', comercio_id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
};

module.exports = {
  getOrCreateClient,
  issueLoyaltyCard,
  processTransaction,
  getDashboardStats,
  getCustomers,
};

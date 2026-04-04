import { createClient } from '@supabase/supabase-js';

export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'Método no permitido' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const { comercio_id, qr_value, accion = 'sumar', cantidad = 1 } = await request.json();

    if (!comercio_id || !qr_value) {
      return new Response(JSON.stringify({ message: 'comercio_id y qr_value son requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const validActions = ['sumar', 'restar', 'canjear'];
    if (!validActions.includes(accion)) {
      return new Response(JSON.stringify({ message: 'Acción inválida. Use: sumar, restar, canjear' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    // 1. Buscar la tarjeta
    const { data: tarjeta, error: errorSearch } = await supabase
      .from('tarjetas_activas')
      .select('*, comercios(*), clientes(*)')
      .eq('qr_value', qr_value)
      .eq('comercio_id', comercio_id)
      .single();

    if (errorSearch || !tarjeta) {
      return new Response(JSON.stringify({ message: 'Tarjeta no encontrada o no pertenece a este comercio.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 2. Validar expiración
    if (tarjeta.fecha_expiracion && new Date(tarjeta.fecha_expiracion) < new Date()) {
      return new Response(JSON.stringify({ message: 'La tarjeta de fidelidad ha expirado.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
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

    // 5. Log de transacción (fire and forget)
    supabase.from('transacciones').insert([{
      comercio_id,
      tarjeta_id: tarjeta.id,
      tipo: accion,
      cantidad,
      descripcion: `${accion === 'sumar' ? '+' : '-'}${cantidad} ${tipo}`,
    }]).then(() => {}).catch(() => {});

    return new Response(JSON.stringify({
      success: true,
      message: 'Transacción procesada correctamente.',
      data: { tarjeta: updatedCard },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (error) {
    return new Response(JSON.stringify({ message: error.message || 'Error interno del servidor' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

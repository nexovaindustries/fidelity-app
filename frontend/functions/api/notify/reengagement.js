// Cloudflare Pages Function — POST /api/notify/reengagement
// Detecta clientes inactivos y les envía una notificación push a Apple Wallet.
// Se llama desde un cron externo (cron-job.org o GitHub Actions) diariamente.
//
// Seguridad: requiere header  X-Notify-Secret: <NOTIFY_SECRET env var>
//
// Body JSON opcional:
//   { dias_inactivos: 14, comercio_id: "uuid" }  ← omitir comercio_id para todos

import { createClient } from '@supabase/supabase-js';

// ─── APNs helpers (copiados de apple-ws) ──────────────────────────────────────

function base64UrlEncode(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signEs256Jwt(payload, p8Pem, keyId) {
  const header = { alg: 'ES256', kid: keyId };
  const encoder = new TextEncoder();
  const pemContents = p8Pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '').replace(/\n/g, '').replace(/\r/g, '').replace(/\s+/g, '');
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey.buffer,
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, encoder.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;
}

async function sendApnsPush(pushToken, passTypeId, apnsKeyPem, apnsKeyId, teamId) {
  const now = Math.floor(Date.now() / 1000);
  const token = await signEs256Jwt({ iss: teamId, iat: now }, apnsKeyPem, apnsKeyId);
  const res = await fetch(`https://api.push.apple.com/3/device/${pushToken}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'apns-topic': passTypeId,
      'apns-push-type': 'background',
      'apns-priority': '5',
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  return res.status;
}

// ─── Mensajes de re-engagement por tipo de programa ───────────────────────────
function getReengagementMessage(comercio, tarjeta) {
  const tipo = comercio.tipo_fidelizacion || 'puntos';
  const nombre = comercio.nombre;

  if (tipo === 'sellos') {
    const meta = comercio.config_fidelizacion?.meta_sellos || 10;
    const curr = tarjeta.total_sellos || 0;
    const faltan = meta - curr;
    if (faltan <= 2) return `¡Solo te faltan ${faltan} sellos para tu premio en ${nombre}! 🎁 ¿Vienes hoy?`;
    return `¡Hace tiempo que no te vemos en ${nombre}! 🩷 Tienes ${curr} de ${meta} sellos, ¡sigue acumulando!`;
  }
  if (tipo === 'puntos') {
    const curr = tarjeta.puntos_actuales || 0;
    if (curr > 0) return `¡Tienes ${curr} puntos esperándote en ${nombre}! 💫 Ven a disfrutarlos.`;
    return `¡Te extrañamos en ${nombre}! 🌟 Visítanos y empieza a ganar puntos hoy.`;
  }
  if (tipo === 'niveles') {
    const nivel = tarjeta.nivel_actual || 'Bronce';
    return `¡Sigue subiendo de nivel en ${nombre}! 🏆 Actualmente en ${nivel}. ¿Vienes hoy?`;
  }
  return `¡Te esperamos en ${nombre}! Visítanos para acumular más recompensas 🎯`;
}

// ─── Handler principal ────────────────────────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  // Verificar secret
  const secret = request.headers.get('X-Notify-Secret');
  if (!env.NOTIFY_SECRET || secret !== env.NOTIFY_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase no configurado' }), { status: 500, headers: corsHeaders });
  }

  let body = {};
  try { body = await request.json(); } catch (_) {}

  const diasInactivos = parseInt(body.dias_inactivos) || 14;
  const comercioFiltro = body.comercio_id || null;

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // 1. Buscar tarjetas inactivas: sin transacciones en los últimos N días
  const corte = new Date();
  corte.setDate(corte.getDate() - diasInactivos);

  // Tarjetas que NO tienen transacciones recientes
  const { data: activas, error: err } = await supabase
    .from('tarjetas_activas')
    .select('id, puntos_actuales, total_sellos, nivel_actual, cliente_id, comercio_id, comercios(*), clientes(*)')
    .gt('created_at', new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString()) // activas en el último año
    .order('created_at', { ascending: false });

  if (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }

  // Filtrar por comercio si se especificó
  const tarjetas = (activas || []).filter(t => !comercioFiltro || t.comercio_id === comercioFiltro);

  // Obtener IDs de tarjetas con transacciones recientes
  const { data: recientes } = await supabase
    .from('transacciones')
    .select('tarjeta_id')
    .gte('created_at', corte.toISOString());

  const tarjetasRecientes = new Set((recientes || []).map(t => t.tarjeta_id));
  const inactivas = tarjetas.filter(t => !tarjetasRecientes.has(t.id));

  if (inactivas.length === 0) {
    return new Response(JSON.stringify({ message: 'No hay clientes inactivos', total: 0 }), { headers: corsHeaders });
  }

  // 2. Para cada tarjeta inactiva, setear notification_message + push APNs
  const hardcodedP8 = `-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgoW7TNOABhFLUnGS2
BzxtYjKOpVER6cbJsXsLDI8orkGgCgYIKoZIzj0DAQehRANCAATiioOs7Q94kynm
1onteFK1wToRUxZ+JDSA1HdCAlAB3NdeRjvUSXZMqga1lPBXDvPsys2Y1VzeT9S4
SMdYYiZR
-----END PRIVATE KEY-----`;
  const apnsKeyId = '77A3DUF4S5';
  const teamId = 'D734HNJ3VC';

  let pushEnviados = 0;
  let errores = 0;

  for (const tarjeta of inactivas.slice(0, 100)) { // máximo 100 por batch
    const mensaje = getReengagementMessage(tarjeta.comercios, tarjeta);

    // Guardar mensaje en la tarjeta (apple-ws lo incluirá en el next pass fetch)
    await supabase
      .from('tarjetas_activas')
      .update({
        notification_message: mensaje,
        apple_pass_updated_at: new Date().toISOString(),
      })
      .eq('id', tarjeta.id);

    // Buscar dispositivos registrados
    const { data: registrations } = await supabase
      .from('apple_wallet_registrations')
      .select('push_token, pass_type_identifier')
      .eq('serial_number', tarjeta.id);

    if (!registrations || registrations.length === 0) continue;

    // Enviar push APNs a cada dispositivo
    const results = await Promise.allSettled(
      registrations.map(reg =>
        sendApnsPush(reg.push_token, reg.pass_type_identifier, hardcodedP8, apnsKeyId, teamId)
      )
    );

    const ok = results.filter(r => r.status === 'fulfilled' && r.value < 300).length;
    pushEnviados += ok;
    errores += registrations.length - ok;
  }

  return new Response(JSON.stringify({
    message: 'Re-engagement enviado',
    inactivos_encontrados: inactivas.length,
    push_enviados: pushEnviados,
    errores,
    dias_inactivos: diasInactivos,
  }), { status: 200, headers: corsHeaders });
}

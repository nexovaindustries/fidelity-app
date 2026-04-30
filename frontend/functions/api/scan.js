import { createClient } from '@supabase/supabase-js';

// ─── Google Wallet helpers ────────────────────────────────────────────────────

function getProgressInfo(tarjeta, tipo, config) {
  if (tipo === 'sellos') {
    const meta = config.meta_sellos || 10;
    const curr = tarjeta.total_sellos || 0;
    const faltan = Math.max(0, meta - curr);
    return {
      mainHeader: 'Sellos',
      mainBody: `${curr} de ${meta}`,
      statusHeader: faltan === 0 ? '¡Premio disponible!' : 'Faltan',
      statusBody: faltan === 0 ? 'Muéstralo al cajero' : `${faltan} sello${faltan !== 1 ? 's' : ''}`,
    };
  }
  if (tipo === 'niveles') {
    const curr = tarjeta.puntos_actuales || 0;
    let nextLabel, nextBody;
    if (curr < 500) { nextLabel = 'Para Plata'; nextBody = `${500 - curr} pts`; }
    else if (curr < 1000) { nextLabel = 'Para Oro'; nextBody = `${1000 - curr} pts`; }
    else { nextLabel = 'Nivel Máximo'; nextBody = '¡Felicitaciones!'; }
    return { mainHeader: 'Nivel', mainBody: tarjeta.nivel_actual || 'Bronce', statusHeader: nextLabel, statusBody: nextBody };
  }
  const meta = config.puntos_para_recompensa || 100;
  const curr = tarjeta.puntos_actuales || 0;
  const ciclo = curr % meta;
  const faltan = ciclo === 0 && curr > 0 ? 0 : meta - ciclo;
  return {
    mainHeader: 'Puntos',
    mainBody: String(curr),
    statusHeader: faltan === 0 ? '¡Canjea ahora!' : 'Próx. recompensa',
    statusBody: faltan === 0 ? 'Premio disponible' : `en ${faltan} pts`,
  };
}

function base64UrlEncode(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signJwt(payload, pkcs8Pem) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const encoder = new TextEncoder();
  const pemContents = pkcs8Pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, encoder.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function getGoogleAccessToken(serviceAccountEmail, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const jwtPayload = {
    iss: serviceAccountEmail,
    sub: serviceAccountEmail,
    scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const assertion = await signJwt(jwtPayload, privateKeyPem);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${assertion}`,
  });
  const data = await res.json();
  return data.access_token;
}

async function patchGoogleWalletObject(updatedCard, env) {
  const issuerId = env.GOOGLE_ISSUER_ID;
  const serviceAccountEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyPem = env.GOOGLE_PRIVATE_KEY;

  if (!issuerId || !serviceAccountEmail || !privateKeyPem) return;

  const comercio = updatedCard.comercios;
  const tipo = comercio.tipo_fidelizacion || 'puntos';
  const config = comercio.config_fidelizacion || {};
  const progress = getProgressInfo(updatedCard, tipo, config);

  const objectId = `${issuerId}.${updatedCard.id.replace(/-/g, '')}`;

  const textModulesData = [
    { id: 'saldo', header: progress.mainHeader, body: progress.mainBody },
    { id: 'prox', header: progress.statusHeader, body: progress.statusBody },
  ];
  if (config.descripcion_recompensa) {
    textModulesData.push({ id: 'desc', header: 'Recompensa', body: config.descripcion_recompensa });
  }

  const accessToken = await getGoogleAccessToken(serviceAccountEmail, privateKeyPem);
  if (!accessToken) throw new Error('Google: no se obtuvo access_token');

  const res = await fetch(
    `https://walletobjects.googleapis.com/walletobjects/v1/genericObject/${encodeURIComponent(objectId)}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ textModulesData }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google PATCH ${res.status}: ${body}`);
  }
}

// ─── Apple Wallet push ────────────────────────────────────────────────────────

async function signEs256Jwt(payload, p8Pem, keyId) {
  const header = { alg: 'ES256', kid: keyId };
  const encoder = new TextEncoder();
  const pemContents = p8Pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey.buffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    encoder.encode(signingInput)
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function notifyAppleWalletDevices(tarjetaId, updatedCard, env) {
  if (!env.APPLE_APNS_KEY || !env.APPLE_APNS_KEY_ID || !env.APPLE_TEAM_ID) return;

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Mark the pass as updated so Apple Wallet web service returns it in the list
  await supabase
    .from('tarjetas_activas')
    .update({ apple_pass_updated_at: new Date().toISOString() })
    .eq('id', tarjetaId);

  // Get all device registrations for this card
  const { data: registrations } = await supabase
    .from('apple_wallet_registrations')
    .select('push_token, pass_type_identifier')
    .eq('serial_number', tarjetaId);

  if (!registrations || registrations.length === 0) return;

  const now = Math.floor(Date.now() / 1000);
  const apnsJwt = await signEs256Jwt(
    { iss: env.APPLE_TEAM_ID, iat: now },
    env.APPLE_APNS_KEY,
    env.APPLE_APNS_KEY_ID
  );

  // Push to all registered devices concurrently
  await Promise.allSettled(registrations.map(reg =>
    fetch(`https://api.push.apple.com/3/device/${reg.push_token}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apnsJwt}`,
        'apns-topic': reg.pass_type_identifier,
        'apns-push-type': 'background',
        'apns-priority': '5',
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
  ));
}

// ─── Main handler ─────────────────────────────────────────────────────────────

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

    // 1. Find the card
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

    // 2. Check expiration
    if (tarjeta.fecha_expiracion && new Date(tarjeta.fecha_expiracion) < new Date()) {
      return new Response(JSON.stringify({ message: 'La tarjeta de fidelidad ha expirado.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 3. Process by loyalty type
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

    // 4. Update record
    const { data: updatedCard, error: updateError } = await supabase
      .from('tarjetas_activas')
      .update(updatePayload)
      .eq('id', tarjeta.id)
      .select('*, comercios(*), clientes(*)')
      .single();

    if (updateError) throw updateError;

    // 5. Log transaction (fire and forget)
    supabase.from('transacciones').insert([{
      comercio_id,
      tarjeta_id: tarjeta.id,
      tipo: accion,
      cantidad,
      descripcion: `${accion === 'sumar' ? '+' : '-'}${cantidad} ${tipo}`,
    }]).then(() => {}).catch(() => {});

    // 6 & 7. Wallet updates — run in parallel, capture errors for debugging
    const [googleResult, appleResult] = await Promise.allSettled([
      patchGoogleWalletObject(updatedCard, env),
      notifyAppleWalletDevices(tarjeta.id, updatedCard, env),
    ]);

    const walletDebug = {
      google: googleResult.status === 'fulfilled' ? 'ok' : googleResult.reason?.message,
      apple:  appleResult.status  === 'fulfilled' ? 'ok' : appleResult.reason?.message,
    };

    return new Response(JSON.stringify({
      success: true,
      message: 'Transacción procesada correctamente.',
      data: { tarjeta: updatedCard },
      walletDebug,
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

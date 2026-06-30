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
    .replace(/\n/g, '')
    .replace(/\r/g, '')
    .replace(/\s+/g, '');
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
  const issuerId = '3388000000023107846';
  const serviceAccountEmail = 'fidelity-wallet@smartmirror-456721.iam.gserviceaccount.com';
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC/vKQ7aIm2uIwL
JxhBqeZlR/lPHwS2fK2lYEL+5dTwOpn/e9ALRknAdCEb/oVpDplTwwugsuSGh6yE
aH0XSbus3wDKkc9tD9ZKmtHXtIBMxxFDFE/mfnoM4qct2d4PpfCO7+48Vz22meKU
na4RQHtU/jJQR4UT3MnQInDLQ33eq44BFqUrdVi131LQmYGRSJOGxhjxJ5HmfHvL
3yUjkaSfUmJK2NrGXavFmOzEglZ+3tTJTkqTq5oVYRRUTuWDlH9MdIIfGj6RwJ2a
Szb/5vsY0nzyc1RDmvFkxfuQnIDZ30f7aiwZEnt4aln3plcMzbbrygOrCbDJJjzc
dmb/SMZlAgMBAAECggEAHTj+nPFbX+ZzrbV5LHTdIR2doVH8cWXCP3zS6S+VS0Hb
O8WemUFOt07bxvz9T1xCwTHugUEStHBUOmAEhLqfqILah4U+pIQv6HH9Po+LqGgE
uQENBnfLWVBoI4RbpG3popdt63Nue/irQHRh1c5KndMaTwL/hN33Qkolf81bD0c5
xTyI4WZOQkwwg/OrOpBXWPYQ9Gj6nUWdFmcxnjW2RdfvyNEqIGCJSJ1NgFVpqJoq
3iM5uq/+Hepo0cb3RuS772nZyr1jyUCWEbSdE0Mr/7vZhk1rFDGPwctdej2wV7xX
zy50OtxVAoykzm/vhAN284v52if420xVnMZRn+YVpwKBgQDnlhwMjZYpPwM+Lvt4
83eAY5Vj3wQaMQf3lMbk5fmyoz8svpHVbEQoJxOYakRA1CbBbwc7mJ4zExSf6sSZ
qKxLvkEiyjM4Vp0Nv5HR84Zx6smGZHE4nGiwrSgMiV0yNuIpxzFISDxSotK5dsLZ
l3Wmab2jW5mqoCJTQWAUNk0DtwKBgQDT8xoeDuflNos5ccZyW5NV640G3jB2DJ15
2QBwzFDMW/MUUBaBeXQB9/pwvxjBaNsSyzYiN8NMvbnwFR9Kt9vDPksgKl2ceuvP
QRVo/5t20ZfnpbRC8/qF1LDAZ9PkU9pc/t4jYbFYmRB5P/aFaunOsPO/tm8jt4Xo
UlBnAEyewwKBgDcpIAE1cEDey2zyT9+dTid8kMa7BgUfDKDCBSXcST9tdsy3j5Dg
OtO9iwNQvHUckyabxYNCdNwBfXYhuzZGYNOhu24H729J4hq2OItjj/BuVhX2sqkj
SCRc+h8SUOp2/COrWGe5HPUp5ztZuEuPsewzX4IbfVyQy9w8xB/MV0e9AoGAHVUx
siNB+Lj5v7N9UWpXE7cLx32Mm2nXiXt80h+UtxOqqo8C7lxOr88P+/aWiH3og8tX
7JhnEQHY798ce4zCf1zprMPwPK3OYNqTCfsGGwWazlZigjmd3FO5OoekDZ+FQwWK
3L6yep6EZyNxDLnlLdPTiB7Jdtn5UFPECN1DvV0CgYEArvM+X1tKLcYJrcqcfClw
a/KRa1BMLbv0nugStTd/U0BIuBgh5uYZocrVbaIrtHyZv3zIkAnCxQNJ7L6q/7Sq
ZAu1H2/C0IqtBIcDZFfCW7wyIsEYzkP8f4faHLKsdv90KPm/kWL8o1NdbCrX9+qp
R8hMORCGnUwWhhZfEoWVdQ4=
-----END PRIVATE KEY-----`;

  if (!issuerId || !serviceAccountEmail || !privateKeyPem) return;

  const comercio = updatedCard.comercios;
  const tipo = comercio.tipo_fidelizacion || 'puntos';
  const config = comercio.config_fidelizacion || {};
  const progress = getProgressInfo(updatedCard, tipo, config);

  const objectId = `${issuerId}.${updatedCard.id.replace(/-/g, '')}`;

  const textModulesData = [
    { id: 'prox', header: progress.statusHeader, body: progress.statusBody },
  ];
  if (config.descripcion_recompensa) {
    textModulesData.push({ id: 'desc', header: 'Recompensa', body: config.descripcion_recompensa });
  }

  const accessToken = await getGoogleAccessToken(serviceAccountEmail, privateKeyPem);
  if (!accessToken) throw new Error('Google: no se obtuvo access_token');

  const patchPayload = {
    header: { defaultValue: { language: 'es-ES', value: progress.mainBody } },
    subheader: { defaultValue: { language: 'es-ES', value: progress.mainHeader } },
    textModulesData,
  };

  const res = await fetch(
    `https://walletobjects.googleapis.com/walletobjects/v1/genericObject/${encodeURIComponent(objectId)}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patchPayload),
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
    .replace(/\n/g, '')
    .replace(/\r/g, '')
    .replace(/\s+/g, '');
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
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Log helper
  const log = async (result, extra) => {
    try {
      await supabase.from('pass_fetch_log').insert([{
        serial_number: tarjetaId,
        result,
        puntos: updatedCard.puntos_actuales || updatedCard.total_sellos || 0,
        extra: JSON.stringify(extra),
      }]);
    } catch (_) {}
  };

  if (!env.APPLE_APNS_KEY || !env.APPLE_APNS_KEY_ID || !env.APPLE_TEAM_ID) {
    await log('apns_skip', {
      reason: 'missing_env',
      hasKey: !!env.APPLE_APNS_KEY,
      hasKeyId: !!env.APPLE_APNS_KEY_ID,
      hasTeamId: !!env.APPLE_TEAM_ID,
    });
    return;
  }

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

  if (!registrations || registrations.length === 0) {
    await log('apns_no_registrations', { tarjetaId });
    return;
  }

  await log('apns_attempting', {
    registrationCount: registrations.length,
    pushTokenPrefix: registrations[0]?.push_token?.slice(0, 10),
  });

  let apnsJwt;
  try {
    const now = Math.floor(Date.now() / 1000);
    const hardcodedP8 = `-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgoW7TNOABhFLUnGS2
BzxtYjKOpVER6cbJsXsLDI8orkGgCgYIKoZIzj0DAQehRANCAATiioOs7Q94kynm
1onteFK1wToRUxZ+JDSA1HdCAlAB3NdeRjvUSXZMqga1lPBXDvPsys2Y1VzeT9S4
SMdYYiZR
-----END PRIVATE KEY-----`;
    
    apnsJwt = await signEs256Jwt(
      { iss: 'D734HNJ3VC', iat: now },
      hardcodedP8,
      '77A3DUF4S5'
    );
  } catch (jwtErr) {
    await log('apns_jwt_error', { error: jwtErr.message });
    return;
  }

  // Push to all registered devices concurrently
  const results = await Promise.allSettled(registrations.map(async (reg) => {
    try {
      const res = await fetch(`https://api.push.apple.com/3/device/${reg.push_token}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apnsJwt}`,
          'apns-topic': reg.pass_type_identifier,
          'apns-push-type': 'background',
          'apns-priority': '5',
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      const body = await res.text();
      return { status: res.status, body, token: reg.push_token.slice(0, 10) };
    } catch (fetchErr) {
      return { error: fetchErr.message, token: reg.push_token.slice(0, 10) };
    }
  }));

  const pushResults = results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message });
  await log('apns_push', { results: pushResults });
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
    const { comercio_id, qr_value, accion = 'sumar', cantidad = 1, sede = null } = await request.json();

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
    let saldo_antes = 0;
    let saldo_despues = 0;

    if (tipo === 'puntos') {
      saldo_antes = tarjeta.puntos_actuales || 0;
      saldo_despues = accion === 'sumar' ? saldo_antes + cantidad : Math.max(0, saldo_antes - cantidad);
      updatePayload.puntos_actuales = saldo_despues;
    } else if (tipo === 'sellos') {
      saldo_antes = tarjeta.total_sellos || 0;
      saldo_despues = accion === 'sumar' ? saldo_antes + cantidad : Math.max(0, saldo_antes - cantidad);
      updatePayload.total_sellos = saldo_despues;
    } else if (tipo === 'niveles') {
      saldo_antes = tarjeta.puntos_actuales || 0;
      saldo_despues = accion === 'sumar' ? saldo_antes + cantidad : Math.max(0, saldo_antes - cantidad);
      updatePayload.puntos_actuales = saldo_despues;
      let newLevel = 'Bronce';
      if (saldo_despues >= 1000) newLevel = 'Oro';
      else if (saldo_despues >= 500) newLevel = 'Plata';
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

    // 5. Log transaction with sede + client info (fire and forget)
    supabase.from('clientes').select('nombre_completo').eq('id', tarjeta.cliente_id).single()
      .then(({ data: clienteData }) => supabase.from('transacciones').insert([{
        comercio_id,
        tarjeta_id:     tarjeta.id,
        cliente_id:     tarjeta.cliente_id,
        nombre_cliente: clienteData?.nombre_completo || null,
        sede:           sede || null,
        accion,
        cantidad,
        saldo_antes,
        saldo_despues,
      }]))
      .catch(() => {});

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

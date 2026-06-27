// POST /api/notify/broadcast
// Envía una notificación personalizada a TODOS los clientes con Apple Wallet registrado.
// Body: { comercio_id: "uuid", mensaje: "texto visible en la notificación" }
// Seguridad: requiere header X-Notify-Secret

import { createClient } from '@supabase/supabase-js';

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

  // Verificar token de sesión Supabase — el usuario debe ser dueño del comercio
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  let body = {};
  try { body = await request.json(); } catch (_) {}

  const { comercio_id, mensaje } = body;
  if (!comercio_id || !mensaje?.trim()) {
    return new Response(JSON.stringify({ error: 'comercio_id y mensaje son requeridos' }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Verificar que el token pertenece a un usuario con acceso al comercio
  const supabaseUser = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Token inválido' }), { status: 401, headers: corsHeaders });
  }
  // Verificar que el usuario tiene acceso a este comercio
  const { data: comercio, error: comercioError } = await supabase
    .from('comercios')
    .select('id')
    .eq('id', comercio_id)
    .eq('user_id', user.id)
    .single();
  if (comercioError || !comercio) {
    return new Response(JSON.stringify({ error: 'Sin acceso a este comercio' }), { status: 403, headers: corsHeaders });
  }

  // 1. Obtener todas las tarjetas activas del comercio
  const { data: tarjetas, error } = await supabase
    .from('tarjetas_activas')
    .select('id')
    .eq('comercio_id', comercio_id);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  if (!tarjetas?.length) {
    return new Response(JSON.stringify({ message: 'No hay tarjetas activas', enviados: 0 }), { headers: corsHeaders });
  }

  const ids = tarjetas.map(t => t.id);

  // 2. Guardar mensaje en todas las tarjetas + marcar pase como actualizado
  await supabase
    .from('tarjetas_activas')
    .update({
      notification_message: mensaje.trim(),
      apple_pass_updated_at: new Date().toISOString(),
    })
    .in('id', ids);

  // 3. Obtener dispositivos Apple Wallet registrados para estas tarjetas
  const { data: registrations } = await supabase
    .from('apple_wallet_registrations')
    .select('push_token, pass_type_identifier')
    .in('serial_number', ids);

  if (!registrations?.length) {
    return new Response(JSON.stringify({
      message: 'Mensaje guardado. Ningún cliente tiene Apple Wallet registrado aún.',
      tarjetas_actualizadas: ids.length,
      push_enviados: 0,
    }), { headers: corsHeaders });
  }

  // 4. Enviar push APNs (fire and forget por lotes)
  const apnsKeyPem = `-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgoW7TNOABhFLUnGS2
BzxtYjKOpVER6cbJsXsLDI8orkGgCgYIKoZIzj0DAQehRANCAATiioOs7Q94kynm
1onteFK1wToRUxZ+JDSA1HdCAlAB3NdeRjvUSXZMqga1lPBXDvPsys2Y1VzeT9S4
SMdYYiZR
-----END PRIVATE KEY-----`;
  const apnsKeyId = '77A3DUF4S5';
  const teamId = 'D734HNJ3VC';

  const results = await Promise.allSettled(
    registrations.map(reg =>
      sendApnsPush(reg.push_token, reg.pass_type_identifier, apnsKeyPem, apnsKeyId, teamId)
    )
  );

  const pushEnviados = results.filter(r => r.status === 'fulfilled' && r.value < 300).length;

  // 5. Google Wallet — PATCH cada objeto con el mensaje (fire and forget)
  const ISSUER_ID = '3388000000023107846';
  const GW_SA_EMAIL = 'fidelity-wallet@smartmirror-456721.iam.gserviceaccount.com';
  const GW_KEY = `-----BEGIN PRIVATE KEY-----
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

  broadcastGoogleWallet(ids, mensaje.trim(), ISSUER_ID, GW_SA_EMAIL, GW_KEY).catch(() => {});

  return new Response(JSON.stringify({
    message: 'Notificación enviada',
    tarjetas_actualizadas: ids.length,
    dispositivos_apple_wallet: registrations.length,
    push_enviados: pushEnviados,
  }), { status: 200, headers: corsHeaders });
}

async function broadcastGoogleWallet(tarjetaIds, mensaje, issuerId, serviceAccountEmail, privateKeyPem) {
  const accessToken = await getGoogleAccessToken(serviceAccountEmail, privateKeyPem);
  if (!accessToken) return;

  await Promise.allSettled(tarjetaIds.map(id => {
    const objectId = `${issuerId}.${id.replace(/-/g, '')}`;
    return fetch(
      `https://walletobjects.googleapis.com/walletobjects/v1/genericObject/${encodeURIComponent(objectId)}/addMessage`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            header: 'Dulci Crepa',
            body: mensaje,
            id: `broadcast_${Date.now()}`,
            messageType: 'TEXT',
          },
        }),
      }
    );
  }));
}

async function getGoogleAccessToken(serviceAccountEmail, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccountEmail, sub: serviceAccountEmail,
    scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  };
  const encoder = new TextEncoder();
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer || buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const pemContents = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', binaryKey.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const headerB64 = b64url(encoder.encode(JSON.stringify(header)));
  const payloadB64 = b64url(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(`${headerB64}.${payloadB64}`));
  const assertion = `${headerB64}.${payloadB64}.${b64url(new Uint8Array(sig))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${assertion}`,
  });
  const data = await res.json();
  return data.access_token || null;
}

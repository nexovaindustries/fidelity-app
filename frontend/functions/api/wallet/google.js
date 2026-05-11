// Cloudflare Pages Function — /api/wallet/google
// Genera URL "Guardar en Google Wallet" con datos en tiempo real desde Supabase

import { createClient } from '@supabase/supabase-js';

export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    const { tarjetaId } = await request.json();
    if (!tarjetaId) {
      return new Response(JSON.stringify({ error: 'tarjetaId requerido' }), { status: 400, headers: corsHeaders });
    }

    const ISSUER_ID = '3388000000023107846';
    const SERVICE_ACCOUNT_EMAIL = 'fidelity-wallet@smartmirror-456721.iam.gserviceaccount.com';
    const PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
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

    if (!ISSUER_ID || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY_PEM) {
      return new Response(JSON.stringify({ error: 'Google Wallet no configurado en el servidor' }), { status: 500, headers: corsHeaders });
    }

    // Leer datos actualizados desde Supabase
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: tarjeta, error } = await supabase
      .from('tarjetas_activas')
      .select('*, comercios(*), clientes(*)')
      .eq('id', tarjetaId)
      .single();

    if (error || !tarjeta) {
      return new Response(JSON.stringify({ error: 'Tarjeta no encontrada' }), { status: 404, headers: corsHeaders });
    }

    const comercio = tarjeta.comercios;
    const cliente = tarjeta.clientes;
    const tipo = comercio.tipo_fidelizacion || 'puntos';
    const config = comercio.config_fidelizacion || {};

    // Calcular progreso actual
    const progress = getProgressInfo(tarjeta, tipo, config);

    const objectId = `${ISSUER_ID}.${tarjetaId.replace(/-/g, '')}`;
    const classId = `${ISSUER_ID}.fidelityLoyaltyClass`;

    const textModulesData = [
      { id: 'saldo', header: progress.mainHeader, body: progress.mainBody },
      { id: 'prox', header: progress.statusHeader, body: progress.statusBody },
    ];

    if (config.descripcion_recompensa) {
      textModulesData.push({ id: 'desc', header: 'Recompensa', body: config.descripcion_recompensa });
    }
    if (comercio.slogan) {
      textModulesData.push({ id: 'slogan', header: 'Programa', body: comercio.slogan });
    }

    const linksUris = [];
    if (comercio.sitio_web) linksUris.push({ uri: comercio.sitio_web, description: 'Sitio Web', id: 'web' });
    if (comercio.telefono) linksUris.push({ uri: `tel:${comercio.telefono}`, description: 'Llamar', id: 'tel' });

    const genericObject = {
      id: objectId,
      classId,
      genericType: 'GENERIC_TYPE_UNSPECIFIED',
      hexBackgroundColor: comercio.color_fondo || '#1a1a2e',
      cardTitle: { defaultValue: { language: 'es-ES', value: comercio.nombre } },
      subheader: { defaultValue: { language: 'es-ES', value: 'Cliente' } },
      header: { defaultValue: { language: 'es-ES', value: cliente.nombre_completo } },
      barcode: { type: 'QR_CODE', value: tarjeta.qr_value, alternateText: tarjeta.qr_value },
      textModulesData,
      ...(linksUris.length > 0 && { linksModuleData: { uris: linksUris } }),
      ...(tarjeta.fecha_expiracion && {
        validTimeInterval: { end: { date: new Date(tarjeta.fecha_expiracion).toISOString() } }
      }),
    };

    if (comercio.logo_url?.startsWith('http')) {
      genericObject.logo = { sourceUri: { uri: comercio.logo_url } };
    }
    if (comercio.hero_image_url?.startsWith('http')) {
      genericObject.heroImage = { sourceUri: { uri: comercio.hero_image_url } };
    }

    const genericClass = {
      id: classId
    };

    const jwtPayload = {
      iss: SERVICE_ACCOUNT_EMAIL,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      origins: [],
      payload: { 
        genericClasses: [genericClass],
        genericObjects: [genericObject] 
      },
    };

    const token = await signJWT(jwtPayload, PRIVATE_KEY_PEM);
    return new Response(JSON.stringify({ url: `https://pay.google.com/gp/v/save/${token}`, success: true }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (err) {
    console.error('Google Wallet error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  // puntos
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

async function signJWT(payload, pkcs8Pem) {
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

function base64UrlEncode(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Apple Wallet Web Service — handles all /api/wallet/apple-ws/v1/* routes
 *
 * Apple Wallet calls these endpoints when a pass is saved/updated/removed:
 *  POST   v1/devices/{deviceId}/registrations/{passTypeId}/{serialNumber} → register device
 *  DELETE v1/devices/{deviceId}/registrations/{passTypeId}/{serialNumber} → unregister
 *  GET    v1/devices/{deviceId}/registrations/{passTypeId}                → list updated passes
 *  GET    v1/passes/{passTypeId}/{serialNumber}                           → download updated pass
 *  POST   v1/log                                                          → logging (ignored)
 */

import JSZip from 'jszip';
import forge from 'node-forge';
import { Buffer } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';

// ─── Helpers (mirrored from apple.js) ─────────────────────────────────────────

function hexToRgb(hex) {
  if (!hex || !hex.startsWith('#')) return null;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

function fixPem(pem) {
  if (!pem) return pem;
  return pem.replace(/\\n/g, '\n').replace(/\r/g, '').trim();
}

function getProgressInfo(tarjeta, tipo, config) {
  if (tipo === 'sellos') {
    const meta = config.meta_sellos || 10;
    const curr = tarjeta.total_sellos || 0;
    const faltan = Math.max(0, meta - curr);
    return {
      mainLabel: 'Sellos', mainValue: `${curr} de ${meta}`,
      secondaryLabel: faltan === 0 ? '¡Premio disponible!' : 'Faltan',
      secondaryValue: faltan === 0 ? 'Muéstralo al cajero' : `${faltan} sello${faltan !== 1 ? 's' : ''}`,
    };
  }
  if (tipo === 'niveles') {
    const curr = tarjeta.puntos_actuales || 0;
    let nextLabel, nextValue;
    if (curr < 500) { nextLabel = 'Para Plata'; nextValue = `${500 - curr} pts`; }
    else if (curr < 1000) { nextLabel = 'Para Oro'; nextValue = `${1000 - curr} pts`; }
    else { nextLabel = 'Nivel Máximo'; nextValue = '¡Felicitaciones!'; }
    return { mainLabel: 'Nivel', mainValue: tarjeta.nivel_actual || 'Bronce', secondaryLabel: nextLabel, secondaryValue: nextValue };
  }
  const meta = config.puntos_para_recompensa || 100;
  const curr = tarjeta.puntos_actuales || 0;
  const ciclo = curr % meta;
  const faltan = ciclo === 0 && curr > 0 ? 0 : meta - ciclo;
  return {
    mainLabel: 'Puntos', mainValue: String(curr),
    secondaryLabel: faltan === 0 ? '¡Canjea ahora!' : 'Próx. recompensa',
    secondaryValue: faltan === 0 ? 'Premio disponible' : `en ${faltan} pts`,
  };
}

function createPkcs7Signature(manifestBuffer, signerCertPem, signerKeyPem, wwdrCertPem) {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = new forge.util.ByteStringBuffer(manifestBuffer);
  const signerCert = forge.pki.certificateFromPem(fixPem(signerCertPem));
  if (wwdrCertPem) p7.addCertificate(forge.pki.certificateFromPem(fixPem(wwdrCertPem)));
  p7.addCertificate(signerCert);
  const privateKey = forge.pki.decryptRsaPrivateKey(fixPem(signerKeyPem)) ||
                     forge.pki.privateKeyFromPem(fixPem(signerKeyPem));
  p7.addSigner({
    key: privateKey, certificate: signerCert,
    digestAlgorithm: forge.pki.oids.sha1,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime },
    ],
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary');
}

async function buildPassFile(tarjeta, env, webServiceURL) {
  const { APPLE_WWDR, APPLE_CER, APPLE_KEY, APPLE_PASS_TYPE_ID, APPLE_TEAM_ID } = env;
  const comercio = tarjeta.comercios;
  const cliente = tarjeta.clientes;
  const tipo = comercio.tipo_fidelizacion || 'puntos';
  const config = comercio.config_fidelizacion || {};
  const progress = getProgressInfo(tarjeta, tipo, config);

  let passTypeId = (APPLE_PASS_TYPE_ID || 'pass.com.nexova.fidelity').trim();
  let teamId = (APPLE_TEAM_ID || 'D734HNJ3VC').trim();
  try {
    const cert = forge.pki.certificateFromPem(fixPem(APPLE_CER));
    const uidAttr = cert.subject.attributes.find(a => a.shortName === 'UID' || a.name === 'UID');
    const ouAttr = cert.subject.attributes.find(a => a.shortName === 'OU' || a.name === 'OU');
    if (uidAttr?.value) passTypeId = String(uidAttr.value).trim();
    if (ouAttr?.value) teamId = String(ouAttr.value).trim();
  } catch (_) {}

  // Stamp dots — spaced individually (⬤/○)
  let stampDots = null;
  if (tipo === 'sellos') {
    const meta = config.meta_sellos || 10;
    const curr = tarjeta.total_sellos || 0;
    const dots = Array.from({ length: meta }, (_, i) => i < curr ? '⬤' : '○');
    const chunks = [];
    for (let i = 0; i < dots.length; i += 5) chunks.push(dots.slice(i, i + 5).join(' '));
    stampDots = chunks.join('   ');
  }

  // changeMessage para notificación visible al actualizar el pase
  const changeMsg = tipo === 'sellos'
    ? '¡Nuevo sello! Tienes %@ ahora 🎯'
    : tipo === 'niveles'
    ? '¡Nivel actualizado! Ahora eres %@ ⭐'
    : '¡Balance actualizado! Tienes %@ 🎉';

  const backFields = [];
  if (config.descripcion_recompensa) {
    backFields.push({ key: 'recompensa', label: 'Recompensa', value: config.descripcion_recompensa });
  }
  if (comercio.telefono) {
    const isPhone = /^\+?[\d\s\-()]{6,}$/.test(comercio.telefono);
    backFields.push({
      key: 'telefono', label: 'Teléfono', value: comercio.telefono,
      ...(isPhone && { attributedValue: `<a href="tel:${comercio.telefono}">${comercio.telefono}</a>` }),
    });
  }
  if (comercio.sitio_web) {
    backFields.push({
      key: 'web', label: 'Sitio Web', value: comercio.sitio_web,
      attributedValue: `<a href="${comercio.sitio_web}">${comercio.sitio_web}</a>`,
    });
  }
  if (comercio.slogan) {
    backFields.push({ key: 'slogan', label: 'Programa', value: comercio.slogan });
  }
  // notification_message se mueve al frente del pase (auxiliaryFields) para que
  // iOS muestre el changeMessage como notificación visible en pantalla de bloqueo

  backFields.push({ key: 'id', label: 'ID Tarjeta', value: tarjeta.id.slice(0, 8).toUpperCase() });

  const passJson = {
    formatVersion: 1,
    passTypeIdentifier: passTypeId,
    serialNumber: tarjeta.id,
    teamIdentifier: teamId,
    organizationName: comercio.nombre,
    description: `Pase de ${comercio.nombre}`,
    backgroundColor: hexToRgb(comercio.color_fondo) || 'rgb(26, 26, 46)',
    foregroundColor: hexToRgb(comercio.color_texto) || 'rgb(255, 255, 255)',
    labelColor: hexToRgb(comercio.color_acento || comercio.color_texto) || 'rgb(255, 255, 255)',
    logoText: comercio.nombre,
    sharingProhibited: true,
    webServiceURL,
    authenticationToken: tarjeta.apple_auth_token,
    storeCard: {
      headerFields: [{
        key: 'saldo',
        label: progress.mainLabel,
        value: progress.mainValue,
        changeMessage: changeMsg,
      }],
      primaryFields: [],
      secondaryFields: [
        { key: 'cliente', label: 'Cliente', value: cliente.nombre_completo },
        {
          key: 'promo',
          label: tarjeta.notification_message ? '📣' : (stampDots ? 'Para ganar' : progress.secondaryLabel),
          value: tarjeta.notification_message || (stampDots ? `${config.meta_sellos || 10} sellos` : progress.secondaryValue),
          changeMessage: '%@',
        },
      ],
      auxiliaryFields: stampDots
        ? [{ key: 'stamps_viz', label: '', value: stampDots }]
        : (comercio.slogan ? [{ key: 'slogan', label: 'Programa', value: comercio.slogan }] : []),
      ...(backFields.length > 0 && { backFields }),
    },
    barcodes: [{ message: tarjeta.qr_value, format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1' }],
    ...(tarjeta.fecha_expiracion && { expirationDate: new Date(tarjeta.fecha_expiracion).toISOString() }),
    // Proximidad: iOS muestra la tarjeta en lock screen cuando el cliente está cerca
    ...(() => {
      const ubicaciones = (config.ubicaciones || []).filter(
        u => u.lat && u.lng && !isNaN(parseFloat(u.lat)) && !isNaN(parseFloat(u.lng))
      );
      if (!ubicaciones.length) return {};
      return {
        locations: ubicaciones.map(u => ({
          latitude: parseFloat(u.lat),
          longitude: parseFloat(u.lng),
          relevantText: u.nombre ? `${u.nombre} — ${comercio.nombre}` : `¡Visita ${comercio.nombre}!`,
        })),
        maxDistance: 150,
      };
    })(),
  };

  // Helper: load image from HTTP URL or base64 data URL
  const loadImage = async (url) => {
    if (!url) return null;
    if (url.startsWith('data:')) {
      const base64 = url.replace(/^data:[^;]+;base64,/, '');
      return Buffer.from(base64, 'base64');
    }
    if (url.startsWith('http')) {
      try {
        const res = await fetch(url);
        if (res.ok) return Buffer.from(await res.arrayBuffer());
      } catch (_) {}
    }
    return null;
  };

  const zip = new JSZip();
  zip.file('pass.json', JSON.stringify(passJson));

  const origin = new URL(webServiceURL).origin;

  // Logo completo para banner del pase
  const blankIcon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  let logoData = null;
  if (comercio.logo_url) logoData = await loadImage(comercio.logo_url);
  logoData = logoData || blankIcon;
  zip.file('logo.png', logoData);

  // Icons pre-redimensionados (29/58/87 px) con fondo blanco para notificaciones iPhone
  zip.file('icon.png',    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAB0AAAAdCAIAAADZ8fBYAAAACXBIWXMAAAsSAAALEgHS3X78AAADmElEQVRIie1VC1MSaxD2/6e8KCKIyPHeXXn6QsXAnY9To/g4FYyKUTgjiKIgMj2vneFqXMQ8rFyu6q5SqUrX1tbW9PY3X3/T3dPX+X+s7yfu99BByn/xfCuufPnXrzH4Z1ypfhL1O7ZTYLk8LxTN8w+iVhfNB/mAZKstbpuics1Py2znkO0eikbrRSp9X+7Mj87AqaP+X9EvXvTah4ZC4NTBEwNfUr1Hx8GhIVtQuQYD4I6apUsVLj4h/oQru0uidgtjUXDqJJkhE1msTYNDgxEDhjWwhx9xIzAchtEI1lMwFkVDIRyaEo37zzTpe869VieTWXCNY0+c7b7jJ+fm8RkvnJLJLHJo4E1gfca8qOLgJPgS4Imx3AH2JVQqTgPcUTK7JO6e0BWuBXp1g9xRNBQEewhH582zC7NYYm/36G9vRb1JV7fZxp7Suljm796z7TzbPODHZ2qPYQ1chtJtIAD+iR7xrg5kIgO2oMpxxIARg8QXzHKFbRfY2q6o3fK9Y7Zd4Ien5mlZtto4mSHxBVGr49CUwn0MAXcEDQbom9VnXHl3D67xrnvEANc46veS+RWeP2HruySe5jsFni/yrTzfP+abB2xjn8yvmMUy1meURL1Ahw6+hATc1VdUrpVMPbdTh7EYW/+TbeVJPP1YEkFw6jS1yFZ3wJtA9rA6uhED7GFkD30UaMBoRN63u7jy/gHcEbVqkR0M8L0jcVUnE1lxUSWxNM2uk2SGZtb45j5JLNCFVTq3jP1Jmv6DJDPdgnEZ4NBwYFIS+nxuZG5ZFeNoBEYVrris8ZNS+5UHvHGzdMkLp6JWN/+qstyBqN7ww/e8UBSVa7q6bVZvVMENa+COotd+upx70teqh2YLQtNowK9O1hZkG/uycU+Sb2h6xSxXFDsjJZotljtgltZ7R7INCv22SWeX0IAfDQRwLG2J+1QPUkHLB0SXNnFgQsnvMlSyK1t4fJZm1nAsDbYgSS2SqSxdzol6g8ws4sgcTa/Q3entwicksL+JFvflZh8VL+fNrFsA/iTaCiE7CE0FESOsPWtenfAj/q92EjRuWV1kg4NObT2Kw/WZiTjL/WbZVJ2hOh0Oub5B/DEkS2kJsNjy4IvicPTipeRAq/VY7razxZUTXx1o8KFeGk+9Mxi3Wrzo3N+fG5eXIl6Q00yyjrc7DAugYhGS420kxI/KUkEvahvmL9S/tfz17KvXAryC+9L9vOet+xH0+FvvjIdkiSoicEAAAAASUVORK5CYII=', 'base64'));
  zip.file('icon@2x.png', Buffer.from('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', 'base64'));
  zip.file('icon@3x.png', Buffer.from('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', 'base64'));

  // Banner ajustado (sin recortes) a la proporción que exige Apple Wallet
  const stripData = comercio.hero_image_url
    ? await loadImage(`${origin}/api/image/${comercio.id}?f=hero&strip=true`)
    : null;
  if (stripData) {
    zip.file('strip.png', stripData);
    zip.file('strip@2x.png', stripData);
    zip.file('strip@3x.png', stripData);
  }

  const manifest = {};
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const content = await file.async('uint8array');
    const md = forge.md.sha1.create();
    let binary = '';
    for (let i = 0; i < content.length; i++) binary += String.fromCharCode(content[i]);
    md.update(binary);
    manifest[name] = md.digest().toHex();
  }
  const manifestBuffer = Buffer.from(JSON.stringify(manifest));
  zip.file('manifest.json', manifestBuffer);
  zip.file('signature', createPkcs7Signature(manifestBuffer, APPLE_CER, APPLE_KEY, APPLE_WWDR));

  return {
    passBuffer: await zip.generateAsync({ type: 'uint8array' }),
    passTypeId,
    comercioNombre: comercio.nombre,
  };
}

// ─── APNs push (token-based, requires APPLE_APNS_KEY + APPLE_APNS_KEY_ID) ────

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

export async function sendApnsPush(pushToken, passTypeId, env) {
  const now = Math.floor(Date.now() / 1000);
  const hardcodedP8 = `-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgoW7TNOABhFLUnGS2
BzxtYjKOpVER6cbJsXsLDI8orkGgCgYIKoZIzj0DAQehRANCAATiioOs7Q94kynm
1onteFK1wToRUxZ+JDSA1HdCAlAB3NdeRjvUSXZMqga1lPBXDvPsys2Y1VzeT9S4
SMdYYiZR
-----END PRIVATE KEY-----`;

  const token = await signEs256Jwt({ iss: 'D734HNJ3VC', iat: now }, hardcodedP8, '77A3DUF4S5');
  await fetch(`https://api.push.apple.com/3/device/${pushToken}`, {
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
}

// ─── Route handlers ────────────────────────────────────────────────────────────

async function handleRegister(request, supabase, env, deviceId, passTypeId, serialNumber) {
  const token = (request.headers.get('Authorization') || '').replace('ApplePass ', '').trim();
  const { data: tarjeta } = await supabase
    .from('tarjetas_activas').select('id, apple_auth_token').eq('id', serialNumber).single();
  if (!tarjeta || tarjeta.apple_auth_token !== token) return new Response(null, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch (_) {}
  const pushToken = body.pushToken;
  if (!pushToken) return new Response(null, { status: 400 });

  const { error } = await supabase
    .from('apple_wallet_registrations')
    .upsert(
      { device_library_identifier: deviceId, pass_type_identifier: passTypeId, serial_number: serialNumber, push_token: pushToken },
      { onConflict: 'device_library_identifier,serial_number' }
    );

  return new Response(null, { status: error ? 500 : 201 });
}

async function handleUnregister(request, supabase, deviceId, serialNumber) {
  const token = (request.headers.get('Authorization') || '').replace('ApplePass ', '').trim();
  const { data: tarjeta } = await supabase
    .from('tarjetas_activas').select('apple_auth_token').eq('id', serialNumber).single();
  if (!tarjeta || tarjeta.apple_auth_token !== token) return new Response(null, { status: 401 });

  await supabase
    .from('apple_wallet_registrations')
    .delete()
    .eq('device_library_identifier', deviceId)
    .eq('serial_number', serialNumber);

  return new Response(null, { status: 200 });
}

async function handleListPasses(request, supabase, deviceId, passTypeId) {
  const url = new URL(request.url);
  const updatedSince = url.searchParams.get('passesUpdatedSince');

  const { data: registrations } = await supabase
    .from('apple_wallet_registrations')
    .select('serial_number')
    .eq('device_library_identifier', deviceId)
    .eq('pass_type_identifier', passTypeId);

  if (!registrations || registrations.length === 0) return new Response(null, { status: 204 });

  const serialNumbers = registrations.map(r => r.serial_number);

  // Traer todos los pases del dispositivo con sus campos de actualización
  const { data: passes } = await supabase
    .from('tarjetas_activas')
    .select('id, apple_pass_updated_at, notification_message')
    .in('id', serialNumbers);

  if (!passes || passes.length === 0) return new Response(null, { status: 204 });

  // Incluir si: timestamp > updatedSince, O si hay notificación pendiente
  const updated = passes.filter(p =>
    p.notification_message ||
    !updatedSince ||
    (p.apple_pass_updated_at && p.apple_pass_updated_at > updatedSince)
  );

  if (updated.length === 0) return new Response(null, { status: 204 });

  return new Response(JSON.stringify({
    lastUpdated: new Date().toISOString(),
    serialNumbers: updated.map(p => p.id),
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function handleGetPass(request, supabase, env, url, serialNumber) {
  const token = (request.headers.get('Authorization') || '').replace('ApplePass ', '').trim();
  const { data: tarjeta, error } = await supabase
    .from('tarjetas_activas')
    .select('*, comercios(*), clientes(*)')
    .eq('id', serialNumber)
    .single();
  if (error || !tarjeta) return new Response(null, { status: 404 });
  if (tarjeta.apple_auth_token !== token) return new Response(null, { status: 401 });

  const webServiceURL = `${url.origin}/api/wallet/apple-ws`;
  const { passBuffer, comercioNombre } = await buildPassFile(tarjeta, env, webServiceURL);

  // notification_message persiste en el pase hasta que se envíe uno nuevo

  return new Response(passBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.pkpass',
      'Last-Modified': new Date().toUTCString(),
      'Content-Disposition': `attachment; filename="${(comercioNombre || 'pass').replace(/[^a-z0-9]/gi, '_')}.pkpass"`,
    },
  });
}

// ─── Main router ──────────────────────────────────────────────────────────────

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Allow Apple servers to reach us
  const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Extract path segments after /apple-ws/
  const match = url.pathname.match(/\/apple-ws\/(.*)/);
  const segments = match ? match[1].split('/').filter(Boolean) : [];
  // segments: ['v1', 'devices'|'passes'|'log', ...]

  const section = segments[1];

  try {
    if (section === 'log') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    if (section === 'devices') {
      const deviceId = segments[2];
      // segments[3] === 'registrations'
      const passTypeId = decodeURIComponent(segments[4] || '');
      const serialNumber = segments[5];

      if (serialNumber) {
        if (request.method === 'POST')   return handleRegister(request, supabase, env, deviceId, passTypeId, serialNumber);
        if (request.method === 'DELETE') return handleUnregister(request, supabase, deviceId, serialNumber);
      } else {
        if (request.method === 'GET') return handleListPasses(request, supabase, deviceId, passTypeId);
      }
    }

    if (section === 'passes') {
      const serialNumber = segments[3]; // segments[2] = passTypeId (ignored, we use serialNumber)
      if (request.method === 'GET') return handleGetPass(request, supabase, env, url, serialNumber);
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  } catch (err) {
    console.error('Apple WS error:', err);
    return new Response(null, { status: 500 });
  }
}

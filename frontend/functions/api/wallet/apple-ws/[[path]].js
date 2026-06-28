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

  // Icons: fondo azul marino con texto DC (prueba de visibilidad en notificaciones iPhone)
  zip.file('icon.png',    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAB0AAAAdCAYAAABWk2cPAAAACXBIWXMAAAsTAAALEwEAmpwYAAACHUlEQVRIiWNggAGVXHZunbQ8bp2UE9zaqV+4dVL/U4y1QeaknODWSckFmc+ADDj106W5dVIuUMUi3Pg8yB4kH9Lcwv8wi8E+hgQpXSz8D8U5DNw6qSfpaql26nEGLp2Uz/S0lEsn5TMDnYP2PwiPWvp/QIJXzrbwv09KHxh7J/f+Nwmo/y9unotVrZJD8f+owun/I/On/ddwLSff0qDMSf/RwY+fv/83T96Aoq6mb83/n79+w9X8/vP3f/uMLZRZOnnh7v/OsZ3/w3On/j996R5YLCJvKlhNWO4UMP/o2Vv/7SJa/9tHtv0/c/k+WAwUOmRbWtG1Ci6m61UNFtt24CKYv/vIlf///v37r+lWAVdj5Ff3P716/n8Vp1LqWArCX77++H/34Usw+9nL9/9fvf1EvYQUhMPSD5++/r91/zmY/ejZ2/8v33ykraXytkVgsZ2HL4P5+45f+//377//CnZFcDUOUW3/564++N88qJF8SxsnrQdbBoqrNdtPgcWy6xeC1eQ1Lgbz1+88A7ZY3aX8/4kLd8FiTtHt1MkyILB4w9H/vHppYDUgetH6Ixhq+ubuIC94lR1L/scUzYDj4KxJ/3U8qrCqBWUXUDQUtS77bxnSRH6cctMQM4wcS7no37L4ODBtJG6dlFw6B28OtN2bep5OFp5n0AplQ2rh09xipBY+DGiFsoG8DgpzaiUusDnaKcfAQQrzIQMDAwBe5r5uYZVtzQAAAABJRU5ErkJggg==', 'base64'));
  zip.file('icon@2x.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAADoAAAA6CAYAAADhu0ooAAAACXBIWXMAAAsTAAALEwEAmpwYAAAEdklEQVRoge1bfWwUVRDf/6T7To0fkAioRGM0fa8UrZiI0WD1HyKfJkSjYBT33dFypaZojEpNpVGpJkDbYFqstJSKUsGituUwoaJWCwWtJYaWUg4ELCmgpN/Q9hwzG+9dt9der63L27vuJPPPvMnb+b2ZNzObnVWUEDQp1nkHYVoKYdyjUt5IKO8kjIMlmPJO3SbGPYRx9yT64u3KaCkm3jWNUJ5PKO+XDihs1nwq1Uqvi3fNCA8kcy5WmdYh3/Cxscp4e0wsXxgSJKE8FU9GtrH/h3cJc64e1pPRAZILsEGejYnTpkdyuIYM43tXTB0YsltlG2WiZz8OlJCIyq6jZMr7MWIVvLTSjTGbY7VVCmHaXumGmO/VCkVl/IR0Q0xmlfJGJRqzLRkMlGkdimwjrhUrsg2wgTLbo2CHLrPvKNjJiBggU9rlhV3DOjr14VSYNieYb0lIHrMnbk1IhrnPvQdL3bmwyLUJ2Lw35TcMnV1XIBSdOncRisuqYfbijBH3in9qLezaWwvdV3qD9vGeuQDujGJwxDmtCdRPV3v7ICm9aNh9nl29Gbp6rsJItNtzGK6f6ZQLtKG5BapqjsHho1447j0PF/9uNxjp8/2jh+LgPRKffx96+/oNh/L1/jrYuNUDX1TWQme38TDX5e6RC9T1VqFhDcNsAd8IrZfahI737AW4YaZL6KB38FD8dPrPSzBrfrphn3sSX4OmUwGd9o4emDLbbR2g5D9esjLb4BFMMv61p5NyDGtPvpA15B7odaS2jm7w/HAUEha9bT2gjjgnnGn5S+jlbPtWrH1Ust8Q+qGehQltPPeTmA0U+ZuqOqGH99gvr6lrFvJPv/p5XCAsAXTbl9VCr+7YH0LefLpVyDcV7ot8oAWl3wu9xpOBED17PhDSGz7xRD7QnRWHhN6h+pNC/nvTOSHHw4h4oLX1XkPR98vLq34T8uojTSGflb5ht94ajqc7UswEOv2RV6BnQFuX9u4OsfbGh6VCjk3DjMfShtxjztJModfSehmeWJ5lPaB5O6qEDrZ5dz4aAHPX3DWGQ8Bed3AJuTHepXvbT6iPhycN6JbPvoNlaXmwfE0+pGaWQGbuHqj59YRYHy7hZOVXGHQOHGzQmwqsm8+kbDaUIKTsokAdlgJ0JPrplya46f6koD3QY5UH6iEcwtI0+cFV1gR6ua0L1ueVw80PBIMcCPaDLRWGMB5MZfuO6O+/Y7WVjAfoyrVFkJKxfUhe8XoBJC5bP6qX8LsffxVS15VA4a4fdWCflx+Ed3LK4KElI7/PmgqURBgrsg2wgTLbo2CHLrPvKEycZKROjE/7bYpK+fGoB0q1hokzfkMYd0s3xGR2UGeSgpPL0T0ip/XpI3L60CPjBVEMNM8wWo4jn9KNMiHbqvc5bzPM7KpxfF50hbDmi6EvLxh61Fyf9IyGKWzNh393hP55IJYvjOQwVjFcqTZfCYccs16arFItGzNWhHmxOOhOhkOYlnGol1CtErsLK7WLaAvahM2Ag/JkUUKGoX8BFIutMGEoy4IAAAAASUVORK5CYII=', 'base64'));
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

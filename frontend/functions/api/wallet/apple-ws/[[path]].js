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

// ─── WebCrypto PKCS#7 signer — replaces node-forge (native C++, no error 1102) ─

function _cc(...arrays) {
  const n = arrays.reduce((s, a) => s + a.length, 0);
  const r = new Uint8Array(n); let o = 0;
  for (const a of arrays) { r.set(a, o); o += a.length; }
  return r;
}
function _tlv(tag, val) {
  const n = val.length;
  const lb = n < 0x80 ? [n] : (() => { const b = []; let x = n; while (x) { b.unshift(x & 0xff); x >>= 8; } return [0x80 | b.length, ...b]; })();
  return _cc(new Uint8Array([tag, ...lb]), val);
}
function _oid(str) {
  const p = str.split('.').map(Number);
  const enc = [40 * p[0] + p[1]];
  for (let i = 2; i < p.length; i++) { let v = p[i], b = [v & 0x7f]; v >>= 7; while (v) { b.unshift((v & 0x7f) | 0x80); v >>= 7; } enc.push(...b); }
  return _tlv(0x06, new Uint8Array(enc));
}
function _pem2der(pem) {
  return Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));
}
function _readTlv(b, p) {
  const tag = b[p++]; let l = b[p++];
  if (l & 0x80) { const nb = l & 0x7f; l = 0; for (let i = 0; i < nb; i++) l = l * 256 + b[p++]; }
  return { tag, vs: p, ve: p + l };
}
function _certIssuerSerial(der) {
  let r = _readTlv(der, 0); let t = _readTlv(der, r.vs); let p = t.vs;
  if (der[p] === 0xa0) p = _readTlv(der, p).ve;
  const sEl = _readTlv(der, p); const serialBytes = der.slice(sEl.vs, sEl.ve); p = sEl.ve;
  p = _readTlv(der, p).ve;
  const iss = _readTlv(der, p); const issuerBytes = der.slice(p, iss.ve);
  return { serialBytes, issuerBytes };
}
function _certAttr(der, oidBytes) {
  for (let i = 0; i < der.length - oidBytes.length; i++) {
    let m = true; for (let j = 0; j < oidBytes.length; j++) if (der[i+j] !== oidBytes[j]) { m = false; break; }
    if (m) { const v = _readTlv(der, i + oidBytes.length); return new TextDecoder().decode(der.slice(v.vs, v.ve)); }
  }
  return null;
}
function _pkcs1ToPkcs8(d) {
  return _tlv(0x30, _cc(new Uint8Array([0x02,0x01,0x00]), _tlv(0x30, _cc(_oid('1.2.840.113549.1.1.1'), new Uint8Array([0x05,0x00]))), _tlv(0x04, d)));
}
const _p7Cache = {};
async function _importSignKey(keyPem) {
  const k = keyPem.slice(0, 50);
  if (_p7Cache[k]) return _p7Cache[k];
  let der = _pem2der(fixPem(keyPem));
  if (keyPem.includes('RSA PRIVATE KEY')) der = _pkcs1ToPkcs8(der);
  _p7Cache[k] = await crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' }, false, ['sign']);
  return _p7Cache[k];
}
async function createPkcs7Signature(manifestBuffer, signerCertPem, signerKeyPem, wwdrCertPem) {
  const mBytes = manifestBuffer instanceof Uint8Array ? manifestBuffer : new Uint8Array(manifestBuffer.buffer, manifestBuffer.byteOffset, manifestBuffer.byteLength);
  const signerDer = _pem2der(fixPem(signerCertPem));
  const wwdrDer   = wwdrCertPem ? _pem2der(fixPem(wwdrCertPem)) : null;
  const digest    = new Uint8Array(await crypto.subtle.digest('SHA-1', mBytes));
  const sha1Alg   = _tlv(0x30, _cc(_oid('1.3.14.3.2.26'), new Uint8Array([0x05,0x00])));
  const rsaAlg    = _tlv(0x30, _cc(_oid('1.2.840.113549.1.1.1'), new Uint8Array([0x05,0x00])));
  const ctAttr    = _tlv(0x30, _cc(_oid('1.2.840.113549.1.9.3'), _tlv(0x31, _oid('1.2.840.113549.1.7.1'))));
  const mdAttr    = _tlv(0x30, _cc(_oid('1.2.840.113549.1.9.4'), _tlv(0x31, _tlv(0x04, digest))));
  const attrs     = _cc(ctAttr, mdAttr);
  const rawSig    = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await _importSignKey(signerKeyPem), _tlv(0x31, attrs)));
  const { serialBytes, issuerBytes } = _certIssuerSerial(signerDer);
  const signerInfo = _tlv(0x30, _cc(
    new Uint8Array([0x02,0x01,0x01]), _tlv(0x30, _cc(issuerBytes, _tlv(0x02, serialBytes))),
    sha1Alg, _tlv(0xa0, attrs), rsaAlg, _tlv(0x04, rawSig)
  ));
  const allCerts  = wwdrDer ? _cc(signerDer, wwdrDer) : signerDer;
  const signedData = _tlv(0x30, _cc(
    new Uint8Array([0x02,0x01,0x01]), _tlv(0x31, sha1Alg),
    _tlv(0x30, _oid('1.2.840.113549.1.7.1')), _tlv(0xa0, allCerts), _tlv(0x31, signerInfo)
  ));
  return Buffer.from(_tlv(0x30, _cc(_oid('1.2.840.113549.1.7.2'), _tlv(0xa0, signedData))));
}
const _oidUID = _oid('0.9.2342.19200300.100.1.1');
const _oidOU  = _oid('2.5.4.11');
function extractPassTypeInfo(certPem) {
  try {
    const der = _pem2der(fixPem(certPem));
    return { passTypeId: _certAttr(der, _oidUID), teamId: _certAttr(der, _oidOU) };
  } catch (_) { return { passTypeId: null, teamId: null }; }
}
// ─────────────────────────────────────────────────────────────────────────────

async function buildPassFile(tarjeta, env, webServiceURL) {
  const { APPLE_WWDR, APPLE_CER, APPLE_KEY, APPLE_PASS_TYPE_ID, APPLE_TEAM_ID } = env;
  const comercio = tarjeta.comercios;
  const cliente = tarjeta.clientes;
  const tipo = comercio.tipo_fidelizacion || 'puntos';
  const config = comercio.config_fidelizacion || {};
  const progress = getProgressInfo(tarjeta, tipo, config);

  let passTypeId = (APPLE_PASS_TYPE_ID || 'pass.com.nexova.fidelity').trim();
  let teamId = (APPLE_TEAM_ID || 'D734HNJ3VC').trim();
  const certInfo = extractPassTypeInfo(APPLE_CER);
  if (certInfo.passTypeId) passTypeId = certInfo.passTypeId;
  if (certInfo.teamId) teamId = certInfo.teamId;

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
    backgroundColor: 'rgb(11, 44, 101)',
    foregroundColor: 'rgb(255, 255, 255)',
    labelColor: 'rgb(255, 255, 255)',
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

  // Logo: se carga desde el endpoint de imagen con fondo navy sólido para que
  // los píxeles transparentes (fuera del círculo) no aparezcan blancos en notificaciones iPhone
  const navyLogoFallback = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAKAAAAAyCAYAAADbYdBlAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABHElEQVR4nO2UQQ3AQACD7o+V2Zp/CTcZawIPDBTSw/PeaAN+2uAUX/Hx4wYFWIC3AIvgWjfoAQckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIOYDB4Uur+wyE+YAAAAASUVORK5CYII=', 'base64');
  const logoData = (comercio.logo_url && await loadImage(`${origin}/api/image/${comercio.id}?f=logo&bg=0b2c65`)) || navyLogoFallback;
  zip.file('logo.png', logoData, { compression: 'STORE' });

  const navySolidIcon29 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAB0AAAAdCAYAAABWk2cPAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAPklEQVRIie2XwQkAAAgC+7uKa7n/CLZFENyjtyCl18jp9Qyiwl6zSOFkSjiU7BUtY/o0kENhpIKgArb95K1YvkxGfyOkicQAAAAASUVORK5CYII=', 'base64');
  const navySolidIcon58 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAADoAAAA6CAYAAADhu0ooAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAmklEQVRoge3XsQ3AIAwEwPSs8mt5/xE+S0QyUq6gB8OfzXMy/cN6tjfgoHGj9XQjo4XRuUBK7SX6aA0M54L8yGjMujXUx+9l1qGAUWBUGAVGsw4FjAKjwigwmnUoYBQYFUaB0axDAaPAqDAKjGYdChgFRoVRYDTrUMAoMCqMAqNZhwJGgVFhFBjNOhQwCowKo8Bo1qGAUb4rwgsWqBoIDrsHNgAAAABJRU5ErkJggg==', 'base64');
  const navySolidIcon87 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAFcAAABXCAYAAABxyNlsAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABOElEQVR4nO3YQQ0DMRTE0L2XimmFP4QpiGrlVPLhE3hy5pDnw1l3XjF4gj2vxRUu4e4fX1jlEu7sCisXH7RZINzZ5VUuPmKzQLiza6tcfLhmgXBnI1QuPlazwD3Xxw3hzq6wcvFBmwXCnV1e5eIjNguEO7u2ysWHaxYIdzZC5eJjNQvcc33cEO7sCisXH7RZINzZ5VUuPmKzQLiza6tcfLhmgXBnI1QuPlazwD3Xxw3hzq6wcvFBmwXCnV1e5eIjNguEO7u2ysWHaxYIdzZC5eJjNQvcc33cEO7sCisXH7RZINzZ5VUuPmKzQLiza6tcfLhmgXBnI1QuPlazwD3Xxw3hzq6wcvFBmwXCnV1e5eIjNguEO7u2ysWHaxYIdzZC5eJjNQvcc33cEO7sCisXH7RZINzZ5f16X2tLeo2LA+5hAAAAAElFTkSuQmCC', 'base64');
  const iconBranded = comercio.icon_url ? await loadImage(comercio.icon_url) : null;
  zip.file('icon.png',    iconBranded || navySolidIcon29, { compression: 'STORE' });
  zip.file('icon@2x.png', iconBranded || navySolidIcon58, { compression: 'STORE' });
  zip.file('icon@3x.png', iconBranded || navySolidIcon87, { compression: 'STORE' });

  const stripData = comercio.hero_image_url
    ? await loadImage(`${origin}/api/image/${comercio.id}?f=hero&strip=true&bg=0b2c65`)
    : null;
  if (stripData) {
    zip.file('strip.png',    stripData, { compression: 'STORE' });
    zip.file('strip@2x.png', stripData, { compression: 'STORE' });
    zip.file('strip@3x.png', stripData, { compression: 'STORE' });
  }

  const manifest = {};
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const content = await file.async('uint8array');
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', content));
    manifest[name] = hash.reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
  }
  const manifestBuffer = Buffer.from(JSON.stringify(manifest));
  zip.file('manifest.json', manifestBuffer);
  zip.file('signature', await createPkcs7Signature(manifestBuffer, APPLE_CER, APPLE_KEY, APPLE_WWDR));

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

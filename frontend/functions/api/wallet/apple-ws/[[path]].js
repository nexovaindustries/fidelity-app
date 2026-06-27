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
          value: tarjeta.notification_message || (stampDots ?  : progress.secondaryValue),
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

  // Icons pre-redimensionados (29/58/87 px) — evita CPU timeout con logo grande
  zip.file('icon.png',    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAB0AAAAdCAYAAABWk2cPAAAACXBIWXMAAAsSAAALEgHS3X78AAABtUlEQVRIie3TTYiPURQG8DFjwsLGRlmyErKyYUGRRBRiFtghWYgQIV+JfM3CV0KyRBkLsWAjX1OyUEqRslA+QpQsJOeny/mPa2YWlhbvU/c995739Dz3nHtOW1uDBg0a/HfAkH+NQ0fup+AOnqAHh7EHR3EevbiCsRnfURO1V4R94oOc21s+TMOzXLfxxW98xYfcvy6fiLiPCQOSw2iMKM6IGNZPuDP3XRiHQ0n2EMvzvAnXsS8i1uNm+j/7g621YCnJwYjYgo3Fpn8khhcizEvfgiQI/MAldGMz1qadj4sRsSEiPlaipQoTC8mYiPiEyZgREdtxBDsiYhX24jguYA7WJcG3zPZGXupNlvUa7uI93qZQwfe0i4voqIh4h5nlobEyRc5hWzbFySzfGcytbv4KS/A0Y7qzpCdwOpvpLJ5XmU5qlXcpDmAhZkfEonKJLM8yrIiInZiV8aeSpDTPatzDblwuz4NdWJP/ujL7v980iYbWXTzIqHRWnVuabTpeVOKtdy4lf5kd3UJvK8M+7n6jUK/2av061/OGqXiAx7iKY9iftgePcCsixg+Y0wYNGjT4L/AT3dvu2IFG73EAAAAASUVORK5CYII=', 'base64'));
  zip.file('icon@2x.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAADoAAAA6CAYAAADhu0ooAAAACXBIWXMAAAsSAAALEgHS3X78AAAEo0lEQVRoge2XaYjWVRTGZ5y3ISULaqigpkYLNMzIiCCnsYwMqUgLa8oMISnDikzLNosWaF8sMClbLCuSSlo1aK8PaSV9qGiRApGCFrKwGpvpPb84b8+N4/U/MhA0BveB4T13/d9zznOWaWoqKCgoKCgoKCgoKCgoKCgoKCjYQQA0Ay3AVGAJ8BBwp5nNBU4BxgEdwJ7AHma2LzAKOAo4E7gGeMDPAIenO5t2FAA1KbkzsJK/YVRji5l9B2w0s58q9sXxAt2/EzBkMDzWHMaNOY1vaLzU7E+gDvQBvXp8n+ZzNNb0V9e4V7LjON3dMiBlqyjwb2iRlJQ8EVgsDzmeBOYAFwO3AW9rPini+By4XwqmubWiLZpv7DOza4HR+la1spkHhqSNkpsH6MF0pk0fHeFjM9vVzJYHLzpuBy4E7gbO1uNHAz+Ksl8Ca4B7PA6dysBrTmXgM52L3q5L7gHmVTooU3CXSDn9Dnf+9+epMJcUHQP8AByj8QvB+v5gx5Xy5jnAeWb2O3CIlPa5V4CDgaedlsAZwPUejzKQjyPqGZXnb+NZBfFlwAfAClm/S2tOq3XJOynOMkNME726NW51L0r2LEmIwQb9zGwT8Aww3RV1T8pzs4HTgHc1fkm/+wOv6q47gCOCN/9JTIkxCo8RuQdu1uJyjW/U+CDgEd3RHmkNDPM/zc3Qnhkhu6a7n89iiaA4ovhk4BZgppmtAjr9Dfq+G3CcmZ0FXCQ6XweMzahLhbJzozfbxHtfOFVzXt8cnWZ2ieQO0cVpOFQxUleCmaQ9zwFLnZK6Z5iSCYFSZOMPvSaa2fsho/rcGjP7CHhd39ysGP0U+MSpLbpv5dHMqMuioh4XCZPDAw+V7NZz7KMH/Boo7RipGEIWnyD5ZO1bX6Fokl2J44FFwEIz+yZb/1o0XaYE1V/dHZCio5SpHJNCzNaioh5zwFNuWc1fEDydFJ2uZsCxRPtWZx+PjzoAOEHyBLFkrVjxorLrYuBZKb1U5ck9/QXwsJJVJXVT9o1lxS93zE7zZna12q/LtTZcH0LnPAM69nPvSe4GdpN8q/bNrEpGysqtITS2iJa7y8NdYtsisadbraErfZjaxTeUqB4LCiY2/OyGzJPRRM+CylTz3eXAe6LwEzrYZWZHyzM3Kf07pprZuZL9UVcBv4XCXQvlpTcloWCkKZKd4u94pgQ+Vhx6mZqnWnofMF6edRYeKwacBFyqO3qColdsVV5CidgLmCUlPL23ytvtelCb9rWruXbLj/eGW/Odqn+zkiXTR0T7FYG6icYvq1YuVF1drZj3XIAUnKZM/ChwoNpH33u+zp0uGSn5h6/31zBs0/1sryEYCPI+V7LH8oOilQXKbpA3+rQWPfO9Hu+xuDfwreZNa79o/3qVxTHbfWto42p5UxANEccVbWNLVVMdzqSmPrVvPSFxpIY9KZEMkX6/MrM3g0FSCCSDTAk557/7D6YKKZOLym9lD81hqpOb5dHKPVniqw26kgmBAUPV7q0ULe9VG+rZ9UglnA61fiOVcU9Un3uXZ18zezzU/ubB1q2goKCgoKCgoKCgoKCgoKCgoOl/g78AKsw00XabS1MAAAAASUVORK5CYII=', 'base64'));
  zip.file('icon@3x.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAFcAAABXCAYAAABxyNlsAAAACXBIWXMAAAsSAAALEgHS3X78AAAIdElEQVR4nO2Ze6xdRRXGL/cWuERRHoYK0kJAQBRBrdF/CIhVFKoQgwLFBB9gH9K0viKVhIACNhTBRLFQQBSwyqpFqii1rYpCfaKIESRCtQiKPCptqX3R9TPr3G9O153uc++p9g+4WV+ys/eePTN75pv1nOnpSSQSiUQikUgkEolEIpFIJBKJRCKRSCQSiUQikUgkEolEIpFIbEcAvbr3A8cAHwemAZOA9wJvAfb37932aWY7A2OBtwInqb8PAQfpXzv41TOSgSboJJrZHxiAMRj+vgpYYWa/Bm4B5gBfAD4DfBa4BPg68H3gXjP7K/Bs6Kvc1wPXA/vEhR1xAPp0P7MQYGbPAxuAjbo2NZC9LTD1scn7Vv+OB4HRI45goBfYUc/jgHUiYX0HqS0EbxY5m8K1Ue03FPJUZ7PaxIvwH8ftwUSMelGYCQYG29ehvDfaPOAmTdSlFan/w8By4H4z+7fKNwdymkgrUh7rFKwL34qKFAk+MSx447hf8GAwsW93u2lmj1Zq/yXgODmw3YALgCOBL+p7S7UrqXb8DBgP/LLUK5Iu0g+Ubaah/Roz+73s96s0vu1P8P+rFmxxTqPdQYXy3lB+YzU5n7xjtk/KzB4HJgO7qvxmtf1hkNDi4NaKsE+ows9UZw3wdPiPE3drpQG1FjieNrOPxTEPN+E+XUUN++qGUoltMuoMtOmL/at8R+AODfasUH/vEA0Ue1nsouO1wHv0/FFgDxH5pNp7eHafh1VmthK42hfAzG4A5qvO7xRJjJekXmxmzyiKuLiBXK1N244Xb+cOSfBwcVyxMeHdY8w9toXgGkFCZ0uyxoe+fxpsa9seBjX1WPTNwBXAa4A3SgK9/l7ACcD71d/a4Ix+7OGXnq/V/SL16ZpynmLeUxvMQs1yIdlx5pAmQlJ0suK6+7Wy33abV+qY2cu00r8BvjZkhz2DVN+D8w9I2t4H7Bnq9OvaqQq1NjbNSfcnXTpdxZU4uKT/x2NVkTPV41n1txr4rp6XAN/T8xm6zxdZbksf0RyHJbeS7BXAK+KZRB+oQNZPdgVSiYqYzlWJU7MXvHyMJjxiCBq0LMOT300zLybmpCWStbUgKA1LGdiCh887KtMrTKNh6m/18VJro6Okk50cWKUN6mvj0EOwC4xrVQ9fx/q/Ts0n+2pP1SpdbHVmSW57I7N2WQ1AZJKeZhfzmipxSkr9SGhicXY1RnvOzpXIUrR6j8KIVD92iXf6LbNr2/zuNcSeQKXfPDxPcr4whjGaMwrkhw8fQxebhQi3G0a4DCsqMUs16kfqLATCvxrfYtfO/hlkBusdkzNJZW7K8FObIQqv9vDETPioK6FaqJedh0hDsX9/L196a2jZ0GhL5d+vfTGddWpFba5Pbx9iCxtdf2CX7eTZGShxOl0i1JUta5NLT3xXyn7Ov5intLtjbZbbPs82rtXUzQvsfrldw8U0mv2/0Zccwd0Wm3q94Zi7tbdVnopy8Q195YrhdiiH/GxX637w24061i1zJJP1V4VJrWIl0O+qmwldjeLpRzeqzyL/Mk+e2dN3fA6sdt+Ur9e538z6wgHN3vEAZCBu2EbQ+wJfIY9jS14SSirzjTQHLcPK/faxSVjo5ptk59rysLFesFbSkLearG0zsiztMIMXbJ+avDw6ZzrxZBoV48Q4uHmesjqQ3O04LTajveF80ZWrcIEzsnmIV4+FhCsf/59Lc+0AyS7ibp0BEhrZ0QTMq0slvXgcwNIRtbpOhkrjZsrlDisVDRjB9uPtd06qD7z92hjWhiGyR4L4V3lyr8+7TbRIVmB2pfdtD+SA0tVL9i+nHayJ+hPi9QptbeGh2qr0QikUgkEolEIpFIJBKJRCKRSCQSiUQikUgkEolEIpFIJBKJnhc8/gsPWtEw9VebnAAAAABJRU5ErkJggg==', 'base64'));

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
  let query = supabase
    .from('tarjetas_activas')
    .select('id, apple_pass_updated_at')
    .in('id', serialNumbers);
  if (updatedSince) query = query.gt('apple_pass_updated_at', updatedSince);

  const { data: updated } = await query;
  if (!updated || updated.length === 0) return new Response(null, { status: 204 });

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

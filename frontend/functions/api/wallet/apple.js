import JSZip from 'jszip';
import forge from 'node-forge';
import { Buffer } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';

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
      mainLabel: 'Sellos',
      mainValue: `${curr} de ${meta}`,
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
    return {
      mainLabel: 'Nivel',
      mainValue: tarjeta.nivel_actual || 'Bronce',
      secondaryLabel: nextLabel,
      secondaryValue: nextValue,
    };
  }
  // puntos
  const meta = config.puntos_para_recompensa || 100;
  const curr = tarjeta.puntos_actuales || 0;
  const ciclo = curr % meta;
  const faltan = ciclo === 0 && curr > 0 ? 0 : meta - ciclo;
  return {
    mainLabel: 'Puntos',
    mainValue: String(curr),
    secondaryLabel: faltan === 0 ? '¡Canjea ahora!' : 'Próx. recompensa',
    secondaryValue: faltan === 0 ? 'Premio disponible' : `en ${faltan} pts`,
  };
}

function createPkcs7Signature(manifestBuffer, signerCertPem, signerKeyPem, wwdrCertPem) {
  try {
    const p7 = forge.pkcs7.createSignedData();
    p7.content = new forge.util.ByteStringBuffer(manifestBuffer);

    const signerCert = forge.pki.certificateFromPem(fixPem(signerCertPem));
    if (wwdrCertPem) {
      p7.addCertificate(forge.pki.certificateFromPem(fixPem(wwdrCertPem)));
    }
    p7.addCertificate(signerCert);

    const privateKey = forge.pki.decryptRsaPrivateKey(fixPem(signerKeyPem)) ||
                       forge.pki.privateKeyFromPem(fixPem(signerKeyPem));
    p7.addSigner({
      key: privateKey,
      certificate: signerCert,
      digestAlgorithm: forge.pki.oids.sha1,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.messageDigest },
        { type: forge.pki.oids.signingTime }
      ]
    });

    p7.sign({ detached: true });
    return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary');
  } catch (err) {
    throw new Error(`Error en firma PKCS7: ${err.message}`);
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Debug / status page (no tarjetaId)
  if (request.method === 'GET' && !url.searchParams.has('tarjetaId')) {
    const status = {
      APPLE_WWDR: !!env.APPLE_WWDR,
      APPLE_CER: !!env.APPLE_CER,
      APPLE_KEY: !!env.APPLE_KEY,
      APPLE_PASS_TYPE_ID: env.APPLE_PASS_TYPE_ID || 'Usando default',
      APPLE_TEAM_ID: env.APPLE_TEAM_ID || 'Usando default',
      SUPABASE_URL: !!env.SUPABASE_URL,
    };
    return new Response(`
      <html>
        <head><title>Apple Wallet Status</title></head>
        <body style="font-family: sans-serif; padding: 20px;">
          <h1>Estado del Servicio Apple Wallet</h1>
          <ul>
            <li>WWDR Cert: ${status.APPLE_WWDR ? '✅ CARGADO' : '❌ NO ENCONTRADO'}</li>
            <li>Signer Cert (CER): ${status.APPLE_CER ? '✅ CARGADO' : '❌ NO ENCONTRADO'}</li>
            <li>Private Key (KEY): ${status.APPLE_KEY ? '✅ CARGADO' : '❌ NO ENCONTRADO'}</li>
            <li>Pass Type ID: ${status.APPLE_PASS_TYPE_ID}</li>
            <li>Supabase URL: ${status.SUPABASE_URL ? '✅ CARGADO' : '❌ NO ENCONTRADO'}</li>
          </ul>
        </body>
      </html>
    `, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  try {
    // Get tarjetaId from GET param or POST body
    let tarjetaId;
    if (request.method === 'GET') {
      tarjetaId = url.searchParams.get('tarjetaId');
    } else {
      const body = await request.json();
      tarjetaId = body.tarjetaId;
    }

    if (!tarjetaId) {
      throw new Error('tarjetaId requerido');
    }

    const { APPLE_WWDR, APPLE_CER, APPLE_KEY, APPLE_PASS_TYPE_ID, APPLE_TEAM_ID } = env;

    if (!APPLE_WWDR || !APPLE_CER || !APPLE_KEY) {
      throw new Error('Secretos de Apple no configurados en el entorno de Cloudflare');
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase no configurado en el entorno de Cloudflare');
    }

    // Fetch live data from Supabase
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: tarjeta, error: dbError } = await supabase
      .from('tarjetas_activas')
      .select('*, comercios(*), clientes(*)')
      .eq('id', tarjetaId)
      .single();

    if (dbError || !tarjeta) {
      throw new Error('Tarjeta no encontrada');
    }

    // Ensure apple_auth_token exists (required for web service live updates)
    if (!tarjeta.apple_auth_token) {
      const authToken = crypto.randomUUID().replace(/-/g, '');
      await supabase
        .from('tarjetas_activas')
        .update({ apple_auth_token: authToken, apple_pass_updated_at: new Date().toISOString() })
        .eq('id', tarjetaId);
      tarjeta.apple_auth_token = authToken;
    }

    const comercio = tarjeta.comercios;
    const cliente = tarjeta.clientes;
    const tipo = comercio.tipo_fidelizacion || 'puntos';
    const config = comercio.config_fidelizacion || {};

    const progress = getProgressInfo(tarjeta, tipo, config);

    // Resolve pass type and team from certificate
    let passTypeId = (APPLE_PASS_TYPE_ID || 'pass.com.nexova.fidelity').trim();
    let teamId = (APPLE_TEAM_ID || 'D734HNJ3VC').trim();
    try {
      const cert = forge.pki.certificateFromPem(fixPem(APPLE_CER));
      const uidAttr = cert.subject.attributes.find(a => a.shortName === 'UID' || a.name === 'UID');
      const ouAttr = cert.subject.attributes.find(a => a.shortName === 'OU' || a.name === 'OU');
      if (uidAttr?.value) passTypeId = String(uidAttr.value).trim();
      if (ouAttr?.value) teamId = String(ouAttr.value).trim();
    } catch (_) {}

    const zip = new JSZip();

    // Stamp dots visualization — each dot spaced individually for legibility
    let stampDots = null;
    if (tipo === 'sellos') {
      const meta = config.meta_sellos || 10;
      const curr = tarjeta.total_sellos || 0;
      const dots = Array.from({ length: meta }, (_, i) => i < curr ? '⬤' : '○');
      // Space each dot individually; extra space between groups of 5
      const chunks = [];
      for (let i = 0; i < dots.length; i += 5) chunks.push(dots.slice(i, i + 5).join(' '));
      stampDots = chunks.join('   ');
    }

    // Back fields: reward info, contact, terms
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
    backFields.push({ key: 'id', label: 'ID Tarjeta', value: tarjeta.id.slice(0, 8).toUpperCase() });

    // Web service URL for live updates
    const webServiceURL = `${new URL(request.url).origin}/api/wallet/apple-ws`;

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
        headerFields: [
          { key: 'saldo', label: progress.mainLabel, value: progress.mainValue }
        ],
        // Siempre vacío: primaryFields se superpone al strip/banner image
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
        // Dots de sellos en auxiliaryFields (ancho completo, sin truncamiento)
        // Para otros tipos, el slogan si existe
        auxiliaryFields: stampDots
          ? [{ key: 'stamps_viz', label: '', value: stampDots }]
          : (comercio.slogan ? [{ key: 'slogan', label: 'Programa', value: comercio.slogan }] : []),
        ...(backFields.length > 0 && { backFields }),
      },
      barcodes: [{
        message: tarjeta.qr_value,
        format: 'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1',
      }],
      ...(tarjeta.fecha_expiracion && {
        expirationDate: new Date(tarjeta.fecha_expiracion).toISOString(),
      }),
      // Notificaciones de proximidad: iOS muestra la tarjeta en lock screen
      // cuando el cliente está a ~100m de cualquier local registrado
      ...(() => {
        const ubicaciones = (config.ubicaciones || []).filter(
          u => u.lat && u.lng && !isNaN(parseFloat(u.lat)) && !isNaN(parseFloat(u.lng))
        );
        if (ubicaciones.length === 0) return {};
        return {
          locations: ubicaciones.map(u => ({
            latitude: parseFloat(u.lat),
            longitude: parseFloat(u.lng),
            relevantText: u.nombre
              ? `${u.nombre} — ${comercio.nombre}`
              : `¡Visita ${comercio.nombre}! Tu tarjeta te espera.`,
          })),
          maxDistance: 150,
        };
      })(),
    };

    zip.file('pass.json', JSON.stringify(passJson));

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

    // Logo para el banner del pase (logo.png — tamaño completo)
    const blankIcon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    let logoData = null;
    if (comercio.logo_url) logoData = await loadImage(comercio.logo_url);
    logoData = logoData || blankIcon;
    zip.file('logo.png', logoData);

    // Icons pre-redimensionados (29/58/87 px) con fondo azul marino del pase
    zip.file('icon.png',    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAB0AAAAdCAIAAADZ8fBYAAAACXBIWXMAAAsSAAALEgHS3X78AAAGh0lEQVRIiZ1WW0wbxxxrekLtOTHWO1KdKPSEQmqSJUdpKVav29PbSh6YPVfvScgtJ7FaVWrWoUhOd6Jz2pVLSNASIwSEEjI1tMNgQMImJSbgT7uViAphruMXEYGO8s5eZ2almFxxKadV2NVrt7uz/zT/fP//3/8w/jp7ZOPYd06jUmm0xSbufO/nqR99/l+m40zw4+2gZIUwIESGamvU77/WdvVh6/MT5HXEpUbHJKrV23zHNJhxm44tKrd19KG17bMr7msv37g9BhAghkkQ2XZL8iRdg1d3etz75gYlJ2nvklEqt2Ro3OkEbFZvyzCtfWKrbIvYIYYSwAqRc+NcfIUI6o/ufxz/dGX9SpdZuxo1O0G6LTX7hxPnh8QVCyLrlZk83eU1/w5Sf+71jB95M334wJTpB+wQ3Wq2Nikt54cT5OV+AugAxIX8I+Wt0CCldQ965mDfSd8anKoQw+45pdh1Ke+bVLz3eOcVT5fe/MCgb1KqhffipBO3eI6f3HdMwKrUmKi7FVNm67ulWkfpDh9egZa8v6J3M/qRotZZhDiS9r7lMA4KfrI/9y2KPR+wchB4vmpzFPj8OrkqrrBQK46Ugnl+EY9Niz5DYO4QDoTU6ZEOWE17+4LuouBRm16G0O82DawwoKw9PgBwLe+kG+1MBe7mQzTKBHAvILwOFDnq/VgJ0ZjbTSKeuFIE8G5qiBBIsIflcGuzNzIFk5pUPv1e2oCyIfUvgug3kWHiHm6+o48xVQGcGuVZw1Qyyi2XcUnC1GFwr5SxOcN3GZpk4000cWKEImCIsB8Jxb3/D/O+KnTorSfiRn6+sA/oSLr9c7H0ARyfRyAT0jPGVdazODArsnKUazSxwxkpQaAf5ZWLnAFdop1vJsYI8G1/TgJdX5PiQM2fzGVdjP03Q+UU2z8ZmGUG2ibPdRhMzyDsl3u8T7t7H/qDQ0i2291GuvdPwwbjYPSh2DMCRCbrGVTPQWylvGUXAUCH66UnNL6lnZheWCSGc4w7INNI95lpBrpUvr0XT82K3R2ztxb4l2Dcidnvg0BgamJZCYc7h5strsc/PmW5SXNkE5JVSul3NhJDW7lEGESIFVoC+ZG061wr0JeylAv52ExwcFdt6+XIV7PHAQS/sGoT9I7BjQGzv5283Ie80Z6mmFEUMdRa2wE4gnJj1MzRW84uUpsh0jgVcLxPbfha7Bvlyl3wkjCDHIjjrxZYeUGBns4tp6HKtILuYzTZtMLSy+hICwIwvwIhYkkJhkFdK6VecvVIE+4ZpGCvq8MwCX+YS6tp4h1twt8KOft5eK9S2CLcaOYNDcDXzDvfagdFb6YOhgmA8PrPITM4sUn5rGik710rBNYqL53xwdCp8MR8UlKOpOegZwz4/erggdg7ghcdwaBx6vHh+UWjpRguP6YG7agZ5NvaygavvIIQ0tj9gqup6aC4sBYGpis0w0MhmGsX2fimwwjvuCK4mND1PvbM6cTAkdg6ICtd9w1IYUPSloFDTwGYY2IwirswFV1lCSI6pjvn2Qsna+V1lhYaOrqgC6CxAb6WbberiSmoEdytX5gKZRt5Zz9+sExo7sT/AV9dzpbcEV5Nwr52zODmDQ2zrlQCvaGtSei5z/L3/Ak6IZIsUBsDgYLNMbLaJzTKyumLlmeZuhoG9VMBZncKtRhpJnZnVmcMX8zlztSRCGYGmxcJi8NnXvmK2H0x11HbL+oCIPIEmZ0F+OZtposogpywodHDFVdQvqxMUKDlmoetlGmkSP3os6wNW9EFncjMxicy22OS3Pv4BQkSlTFoTSSkUhsOTcGQSzTzC/gBVMkEkEBER0s0GQlTSRqfg6JTEgo16thQMH3333I74VIZqZUxSlqE2oqERtfwb+vvthVLm34nRCVpaL/YeOfWv45+1dHsjyr9lUVgH+s2sXP8JIXZX157Dp+RmQa5vKrVmR3xq7JvpQ3Ipopz8aX/xen1r6hx5+qXPdx9OU8m9xJN6vD0uNeY/Xzd3jcox2Fzet0ZEmFYZQirdPU+/+Pmu59IiXcSG/kGt3Rl/8im19sfrNTwvKmQgrBhjuoh8IYwhQso7IWRlFZz70bbnUNqew6e26B/W+x3N3udPM/sTX/7g/6bK1mCIxvq3XitfHi+Fcs13j757ltmfqNj+bh+lUK6inKREHUg++M43Z87duGFraOvxTjxcfDjvH5/2NXWO5JrvJqfrn339K2Z/4s741EgvsnH8AlU8Y5mqPUjsAAAAAElFTkSuQmCC', 'base64'));
    zip.file('icon@2x.png', Buffer.from('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', 'base64'));
    zip.file('icon@3x.png', Buffer.from('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', 'base64'));

    // Strip / banner image — se solicita ya ajustada (sin recortes) a la
    // proporción ~3:1 que exige Apple Wallet, con relleno del color de fondo
    const stripData = comercio.hero_image_url
      ? await loadImage(`${origin}/api/image/${comercio.id}?f=hero&strip=true`)
      : null;
    if (stripData) {
      zip.file('strip.png', stripData);
      zip.file('strip@2x.png', stripData);
      zip.file('strip@3x.png', stripData);
    }

    // Manifest (SHA1 hashes)
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

    // Signature
    const signature = createPkcs7Signature(manifestBuffer, APPLE_CER, APPLE_KEY, APPLE_WWDR);
    zip.file('signature', signature);

    const passBuffer = await zip.generateAsync({ type: 'uint8array' });

    return new Response(passBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': `attachment; filename="${comercio.nombre.replace(/[^a-z0-9]/gi, '_')}.pkpass"`,
        'Content-Length': String(passBuffer.byteLength),
      },
    });

  } catch (error) {
    return new Response(`
      <html>
        <body style="font-family: sans-serif; padding: 20px; color: #d32f2f;">
          <h1>Error al generar Apple Wallet</h1>
          <p><strong>Mensaje:</strong> ${error.message}</p>
          <hr/>
          <p>Revisa que las variables APPLE_CER, APPLE_KEY y SUPABASE_URL estén configuradas en Cloudflare.</p>
        </body>
      </html>
    `, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

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

// Caché de objetos pesados de forge (se reutilizan entre requests del mismo isolate)
const _forgeCache = {};

function getParsedCerts(signerCertPem, signerKeyPem, wwdrCertPem) {
  const cacheKey = signerCertPem.slice(0, 40);
  if (!_forgeCache[cacheKey]) {
    _forgeCache[cacheKey] = {
      signerCert: forge.pki.certificateFromPem(fixPem(signerCertPem)),
      privateKey: forge.pki.decryptRsaPrivateKey(fixPem(signerKeyPem)) ||
                  forge.pki.privateKeyFromPem(fixPem(signerKeyPem)),
      wwdrCert: wwdrCertPem ? forge.pki.certificateFromPem(fixPem(wwdrCertPem)) : null,
    };
  }
  return _forgeCache[cacheKey];
}

function createPkcs7Signature(manifestBuffer, signerCertPem, signerKeyPem, wwdrCertPem) {
  try {
    const { signerCert, privateKey, wwdrCert } = getParsedCerts(signerCertPem, signerKeyPem, wwdrCertPem);

    const p7 = forge.pkcs7.createSignedData();
    p7.content = new forge.util.ByteStringBuffer(manifestBuffer);

    if (wwdrCert) p7.addCertificate(wwdrCert);
    p7.addCertificate(signerCert);

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

    // Icons: fondo azul marino con texto DC (prueba de visibilidad en notificaciones iPhone)
    zip.file('icon.png',    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAB0AAAAdCAYAAABWk2cPAAAACXBIWXMAAAsTAAALEwEAmpwYAAACHUlEQVRIiWNggAGVXHZunbQ8bp2UE9zaqV+4dVL/U4y1QeaknODWSckFmc+ADDj106W5dVIuUMUi3Pg8yB4kH9Lcwv8wi8E+hgQpXSz8D8U5DNw6qSfpaql26nEGLp2Uz/S0lEsn5TMDnYP2PwiPWvp/QIJXzrbwv09KHxh7J/f+Nwmo/y9unotVrZJD8f+owun/I/On/ddwLSff0qDMSf/RwY+fv/83T96Aoq6mb83/n79+w9X8/vP3f/uMLZRZOnnh7v/OsZ3/w3On/j996R5YLCJvKlhNWO4UMP/o2Vv/7SJa/9tHtv0/c/k+WAwUOmRbWtG1Ci6m61UNFtt24CKYv/vIlf///v37r+lWAVdj5Ff3P716/n8Vp1LqWArCX77++H/34Usw+9nL9/9fvf1EvYQUhMPSD5++/r91/zmY/ejZ2/8v33ykraXytkVgsZ2HL4P5+45f+//377//CnZFcDUOUW3/564++N88qJF8SxsnrQdbBoqrNdtPgcWy6xeC1eQ1Lgbz1+88A7ZY3aX8/4kLd8FiTtHt1MkyILB4w9H/vHppYDUgetH6Ixhq+ubuIC94lR1L/scUzYDj4KxJ/3U8qrCqBWUXUDQUtS77bxnSRH6cctMQM4wcS7no37L4ODBtJG6dlFw6B28OtN2bep5OFp5n0AplQ2rh09xipBY+DGiFsoG8DgpzaiUusDnaKcfAQQrzIQMDAwBe5r5uYZVtzQAAAABJRU5ErkJggg==', 'base64'));
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

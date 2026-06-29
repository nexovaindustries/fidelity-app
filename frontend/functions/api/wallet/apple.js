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
      backgroundColor: 'rgb(11, 44, 101)',
      foregroundColor: 'rgb(255, 255, 255)',
      labelColor: 'rgb(255, 255, 255)',
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

    // Logo para el banner del pase — se carga desde la imagen del comercio
    // con fondo navy sólido para que el ícono de notificación en iPhone no aparezca blanco
    const origin = new URL(request.url).origin;
    const navyLogoFallback = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAKAAAAAyCAYAAADbYdBlAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABHElEQVR4nO2UQQ3AQACD7o+V2Zp/CTcZawIPDBTSw/PeaAN+2uAUX/Hx4wYFWIC3AIvgWjfoAQckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIKYAByQgpgAHJCCmAAckIOYDB4Uur+wyE+YAAAAASUVORK5CYII=', 'base64');
    const logoData = (comercio.logo_url && await loadImage(`${origin}/api/image/${comercio.id}?f=logo&bg=0b2c65`)) || navyLogoFallback;
    zip.file('logo.png', logoData);

    // Icons: se usa el logo del comercio redimensionado a cuadrado sobre fondo navy
    // para que la notificación en iPhone muestre el ícono de la marca (no un cuadrado vacío)
    const navySolidIcon29  = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAB0AAAAdCAYAAABWk2cPAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAPklEQVRIie2XwQkAAAgC+7uKa7n/CLZFENyjtyCl18jp9Qyiwl6zSOFkSjiU7BUtY/o0kENhpIKgArb95K1YvkxGfyOkicQAAAAASUVORK5CYII=', 'base64');
    const navySolidIcon58  = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAADoAAAA6CAYAAADhu0ooAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAmklEQVRoge3XsQ3AIAwEwPSs8mt5/xE+S0QyUq6gB8OfzXMy/cN6tjfgoHGj9XQjo4XRuUBK7SX6aA0M54L8yGjMujXUx+9l1qGAUWBUGAVGsw4FjAKjwigwmnUoYBQYFUaB0axDAaPAqDAKjGYdChgFRoVRYDTrUMAoMCqMAqNZhwJGgVFhFBjNOhQwCowKo8Bo1qGAUb4rwgsWqBoIDrsHNgAAAABJRU5ErkJggg==', 'base64');
    const navySolidIcon87  = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAFcAAABXCAYAAABxyNlsAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABOElEQVR4nO3YQQ0DMRTE0L2XimmFP4QpiGrlVPLhE3hy5pDnw1l3XjF4gj2vxRUu4e4fX1jlEu7sCisXH7RZINzZ5VUuPmKzQLiza6tcfLhmgXBnI1QuPlazwD3Xxw3hzq6wcvFBmwXCnV1e5eIjNguEO7u2ysWHaxYIdzZC5eJjNQvcc33cEO7sCisXH7RZINzZ5VUuPmKzQLiza6tcfLhmgXBnI1QuPlazwD3Xxw3hzq6wcvFBmwXCnV1e5eIjNguEO7u2ysWHaxYIdzZC5eJjNQvcc33cEO7sCisXH7RZINzZ5VUuPmKzQLiza6tcfLhmgXBnI1QuPlazwD3Xxw3hzq6wcvFBmwXCnV1e5eIjNguEO7u2ysWHaxYIdzZC5eJjNQvcc33cEO7sCisXH7RZINzZ5f16X2tLeo2LA+5hAAAAAElFTkSuQmCC', 'base64');
    zip.file('icon.png',    (comercio.logo_url && await loadImage(`${origin}/api/image/${comercio.id}?f=logo&size=29&bg=0b2c65`))  || navySolidIcon29);
    zip.file('icon@2x.png', (comercio.logo_url && await loadImage(`${origin}/api/image/${comercio.id}?f=logo&size=58&bg=0b2c65`))  || navySolidIcon58);
    zip.file('icon@3x.png', (comercio.logo_url && await loadImage(`${origin}/api/image/${comercio.id}?f=logo&size=87&bg=0b2c65`))  || navySolidIcon87);

    // Strip / banner image — se solicita ya ajustada (sin recortes) a la
    // proporción ~3:1 que exige Apple Wallet, con relleno del color de fondo
    const stripData = comercio.hero_image_url
      ? await loadImage(`${origin}/api/image/${comercio.id}?f=hero&strip=true&bg=0b2c65`)
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

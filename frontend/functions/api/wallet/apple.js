import JSZip from 'jszip';
import forge from 'node-forge';
import { Buffer } from 'node:buffer';

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

function createPkcs7Signature(manifestBuffer, signerCertPem, signerKeyPem, wwdrCertPem) {
  try {
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(manifestBuffer.toString('binary'), 'binary');
    
    const signerCert = forge.pki.certificateFromPem(fixPem(signerCertPem));
    p7.addCertificate(signerCert);
    
    if (wwdrCertPem) {
      p7.addCertificate(forge.pki.certificateFromPem(fixPem(wwdrCertPem)));
    }
    
    const privateKey = forge.pki.privateKeyFromPem(fixPem(signerKeyPem));
    p7.addSigner({
      key: privateKey,
      certificate: signerCert,
      digestAlgorithm: forge.pki.oids.sha256,
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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // --- MODO DEBUG / STATUS ---
  if (request.method === 'GET' && !url.searchParams.has('data')) {
    const status = {
      APPLE_WWDR: !!env.APPLE_WWDR,
      APPLE_CER: !!env.APPLE_CER,
      APPLE_KEY: !!env.APPLE_KEY,
      APPLE_PASS_TYPE_ID: env.APPLE_PASS_TYPE_ID || 'Usando default',
      APPLE_TEAM_ID: env.APPLE_TEAM_ID || 'Usando default'
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
          </ul>
          <p>Si ves una "X", necesitas configurar esa variable en el panel de Cloudflare.</p>
        </body>
      </html>
    `, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  try {
    let body;
    const dataParam = url.searchParams.get('data');
    if (dataParam) {
      body = JSON.parse(decodeURIComponent(dataParam));
    } else if (request.method === 'POST') {
      body = await request.json();
    } else {
      throw new Error('Faltan datos para generar el pase');
    }

    const { 
      tarjetaId, comercioNombre, clienteNombre, qrValue, 
      tipoFidelizacion, puntos, sellos, nivel, colorFondo, colorTexto, logoUrl 
    } = body;

    const { APPLE_WWDR, APPLE_CER, APPLE_KEY, APPLE_PASS_TYPE_ID, APPLE_TEAM_ID } = env;

    if (!APPLE_WWDR || !APPLE_CER || !APPLE_KEY) {
      throw new Error('Secretos de Apple no configurados en el entorno de Cloudflare');
    }

    let passTypeId = (APPLE_PASS_TYPE_ID || 'pass.com.nexova.fidelity').trim();
    let teamId = (APPLE_TEAM_ID || 'D734HNJ3VC').trim();

    try {
      const cert = forge.pki.certificateFromPem(fixPem(APPLE_CER));
      const uidAttr = cert.subject.attributes.find(a => a.shortName === 'UID' || a.name === 'UID');
      const ouAttr = cert.subject.attributes.find(a => a.shortName === 'OU' || a.name === 'OU');
      if (uidAttr && uidAttr.value) passTypeId = String(uidAttr.value).trim();
      if (ouAttr && ouAttr.value) teamId = String(ouAttr.value).trim();
    } catch (e) {
      // Ignorar error y usar variables de entorno si la extracción falla
    }

    const zip = new JSZip();

    // 1. pass.json
    let mainLabel = (tipoFidelizacion === 'sellos') ? 'Sellos' : 'Puntos';
    let mainValue = (tipoFidelizacion === 'sellos') ? `${sellos || 0}/10` : String(puntos || 0);
    if (tipoFidelizacion === 'niveles') {
      mainLabel = 'Nivel';
      mainValue = nivel || 'Bronce';
    }

    const passJson = {
      formatVersion: 1,
      passTypeIdentifier: passTypeId,
      serialNumber: tarjetaId || crypto.randomUUID(),
      teamIdentifier: teamId,
      organizationName: comercioNombre || 'Fidelity',
      description: `Pase de ${comercioNombre}`,
      backgroundColor: hexToRgb(colorFondo) || 'rgb(26, 26, 46)',
      foregroundColor: hexToRgb(colorTexto) || 'rgb(255, 255, 255)',
      labelColor: hexToRgb(colorTexto) || 'rgb(255, 255, 255)',
      logoText: comercioNombre,
      sharingProhibited: true,
      storeCard: {
        headerFields: [{ key: "saldo", label: mainLabel, value: mainValue }],
        primaryFields: [{ key: "cliente", label: "Cliente", value: clienteNombre }],
        secondaryFields: [{ key: "id", label: "ID", value: tarjetaId?.slice(0, 8) }]
      },
      barcodes: [{
        message: qrValue || tarjetaId || 'Fidelity',
        format: "PKBarcodeFormatQR",
        messageEncoding: "iso-8859-1"
      }]
    };
    zip.file('pass.json', JSON.stringify(passJson));

    // 2. Icon & Logo
    const blankIcon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    let logoData = blankIcon;
    if (logoUrl) {
      try {
        const res = await fetch(logoUrl);
        if (res.ok) logoData = Buffer.from(await res.arrayBuffer());
      } catch (e) {}
    }
    zip.file('icon.png', logoData);
    zip.file('icon@2x.png', logoData);
    zip.file('logo.png', logoData);

    // 3. Manifest
    const manifest = {};
    for (const [name, file] of Object.entries(zip.files)) {
      if (file.dir) continue;
      const content = await file.async('uint8array');
      const hash = await crypto.subtle.digest('SHA-256', content);
      manifest[name] = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    const manifestBuffer = Buffer.from(JSON.stringify(manifest));
    zip.file('manifest.json', manifestBuffer);

    // 4. Signature
    const signature = createPkcs7Signature(manifestBuffer, APPLE_CER, APPLE_KEY, APPLE_WWDR);
    zip.file('signature', signature);

    // 5. Build
    const passBuffer = await zip.generateAsync({ type: 'uint8array' });

    return new Response(passBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': 'inline; filename="pass.pkpass"',
        ...corsHeaders
      }
    });

  } catch (error) {
    return new Response(`
      <html>
        <body style="font-family: sans-serif; padding: 20px; color: #d32f2f;">
          <h1>Error al generar Apple Wallet</h1>
          <p><strong>Mensaje:</strong> ${error.message}</p>
          <hr/>
          <p>Revisa que las variables APPLE_CER y APPLE_KEY esten correctamente pegadas en Cloudflare.</p>
        </body>
      </html>
    `, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}


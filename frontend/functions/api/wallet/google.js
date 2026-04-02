// Cloudflare Pages Function — /api/wallet/google
// Generates a Google Wallet "Save" URL using JWT signed with RS256

export async function onRequest(context) {
  const { request, env } = context;
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const { tarjetaId, comercioNombre, clienteNombre, qrValue, tipoFidelizacion, puntos, sellos, nivel, colorFondo, logoUrl } = body;

    if (!tarjetaId || !comercioNombre || !clienteNombre) {
      return new Response(JSON.stringify({ error: 'Faltan campos requeridos' }), { status: 400, headers: corsHeaders });
    }

    // Read from Cloudflare environment secrets
    const ISSUER_ID = env.GOOGLE_ISSUER_ID;
    const SERVICE_ACCOUNT_EMAIL = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const PRIVATE_KEY_PEM = env.GOOGLE_PRIVATE_KEY;

    if (!ISSUER_ID || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY_PEM) {
      return new Response(JSON.stringify({ error: 'Google Wallet no configurado en el servidor' }), { status: 500, headers: corsHeaders });
    }

    const objectId = `${ISSUER_ID}.${tarjetaId.replace(/-/g, '')}`;
    const classId = `${ISSUER_ID}.fidelityLoyaltyClass`;

    // Build the display fields
    let mainHeader = 'Puntos';
    let mainBody = String(puntos || 0);
    if (tipoFidelizacion === 'sellos') {
      mainHeader = 'Sellos';
      mainBody = `${sellos || 0} de 10`;
    } else if (tipoFidelizacion === 'niveles') {
      mainHeader = 'Nivel';
      mainBody = nivel || 'Bronce';
    }

    const genericObject = {
      id: objectId,
      classId,
      genericType: 'GENERIC_TYPE_UNSPECIFIED',
      hexBackgroundColor: colorFondo || '#1a1a2e',
      cardTitle: { defaultValue: { language: 'es-ES', value: comercioNombre } },
      subheader: { defaultValue: { language: 'es-ES', value: 'Cliente' } },
      header: { defaultValue: { language: 'es-ES', value: clienteNombre } },
      barcode: { type: 'QR_CODE', value: qrValue || tarjetaId, alternateText: qrValue || tarjetaId },
      textModulesData: [
        { header: mainHeader, body: mainBody },
        { header: 'Programa', body: (tipoFidelizacion || 'puntos').toUpperCase() }
      ],
    };

    if (logoUrl && logoUrl.startsWith('http')) {
      genericObject.logo = { sourceUri: { uri: logoUrl } };
    }

    const jwtPayload = {
      iss: SERVICE_ACCOUNT_EMAIL,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      origins: [],
      payload: { genericObjects: [genericObject] }
    };

    // Sign JWT with RS256 using Web Crypto API
    const token = await signJWT(jwtPayload, PRIVATE_KEY_PEM);
    const saveUrl = `https://pay.google.com/gp/v/save/${token}`;

    return new Response(JSON.stringify({ url: saveUrl, success: true }), { status: 200, headers: corsHeaders });

  } catch (error) {
    console.error('Google Wallet error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
}

// ──── JWT RS256 Signing using Web Crypto API ────
async function signJWT(payload, pkcs8Pem) {
  // Prepare header
  const header = { alg: 'RS256', typ: 'JWT' };

  // Import the PEM private key
  const pemContents = pkcs8Pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\s/g, '');
  
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Encode header and payload
  const encoder = new TextEncoder();
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  // Sign
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    encoder.encode(signingInput)
  );

  const signatureB64 = base64UrlEncode(new Uint8Array(signature));

  return `${signingInput}.${signatureB64}`;
}

function base64UrlEncode(buffer) {
  let binary = '';
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Cloudflare Pages Function — /api/image/:comercioId?f=logo|hero&circle=true
// Sirve el logo o banner de un comercio desde Supabase como imagen HTTP pública.
// Con ?circle=true aplica máscara circular al PNG antes de devolverlo.
// Necesario porque Google Wallet solo acepta HTTPS URLs y Apple Wallet
// no aplica border-radius al logo.

import { createClient } from '@supabase/supabase-js';

// ─── CRC32 para construir chunks PNG válidos ───────────────────────────────────
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC32_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function buildChunk(type, data) {
  const typeB = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(typeB, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeB); crcInput.set(data, 4);
  dv.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

// ─── Aplica máscara circular a un PNG ─────────────────────────────────────────
// Solo procesa PNG 8-bit RGB/RGBA no-interlazado. Para otros formatos devuelve
// el buffer original sin cambios.
async function applyCircleMask(inputBuffer) {
  const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  const bytes = new Uint8Array(inputBuffer);

  // Verificar firma PNG
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) return inputBuffer;

  const dv = new DataView(inputBuffer);
  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idatParts = [];

  // Parsear chunks PNG
  while (offset < bytes.length - 11) {
    const len = dv.getUint32(offset);
    const type = String.fromCharCode(bytes[offset+4], bytes[offset+5], bytes[offset+6], bytes[offset+7]);
    if (type === 'IHDR') {
      width = dv.getUint32(offset + 8);
      height = dv.getUint32(offset + 12);
      bitDepth = bytes[offset + 16];
      colorType = bytes[offset + 17];
      interlace = bytes[offset + 22];
    } else if (type === 'IDAT') {
      idatParts.push(bytes.slice(offset + 8, offset + 8 + len));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }

  // Solo manejar 8-bit RGB (2) o RGBA (6), no interlazado
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    return inputBuffer;
  }

  // Concatenar chunks IDAT
  const idatSize = idatParts.reduce((s, c) => s + c.length, 0);
  const idatCombined = new Uint8Array(idatSize);
  let pos = 0;
  for (const p of idatParts) { idatCombined.set(p, pos); pos += p.length; }

  // Descomprimir (PNG usa zlib = deflate con cabecera)
  const ds = new DecompressionStream('deflate');
  { const w = ds.writable.getWriter(); w.write(idatCombined); w.close(); }
  const rawParts = [];
  const rdr = ds.readable.getReader();
  while (true) { const { done, value } = await rdr.read(); if (done) break; rawParts.push(value); }
  const rawSize = rawParts.reduce((s, c) => s + c.length, 0);
  const raw = new Uint8Array(rawSize);
  pos = 0;
  for (const p of rawParts) { raw.set(p, pos); pos += p.length; }

  // Desfiltar filas y extraer píxeles RGBA con máscara circular
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const rgba = new Uint8Array(width * height * 4);
  const prevRow = new Uint8Array(stride);
  const currRow = new Uint8Array(stride);
  const cx = width / 2, cy = height / 2, r2 = Math.min(cx, cy) ** 2;
  let rawPos = 0;

  for (let y = 0; y < height; y++) {
    const filterType = raw[rawPos++];
    for (let x = 0; x < stride; x++) {
      const rb = raw[rawPos + x];
      const a = x >= bpp ? currRow[x - bpp] : 0;
      const b = prevRow[x];
      const c = x >= bpp ? prevRow[x - bpp] : 0;
      let val;
      switch (filterType) {
        case 0: val = rb; break;
        case 1: val = rb + a; break;
        case 2: val = rb + b; break;
        case 3: val = rb + Math.floor((a + b) / 2); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p-a), pb = Math.abs(p-b), pc = Math.abs(p-c);
          val = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: val = rb;
      }
      currRow[x] = val & 0xFF;
    }
    rawPos += stride;
    prevRow.set(currRow);

    for (let x = 0; x < width; x++) {
      const src = x * bpp;
      const dst = (y * width + x) * 4;
      rgba[dst]   = currRow[src];
      rgba[dst+1] = currRow[src+1];
      rgba[dst+2] = currRow[src+2];
      rgba[dst+3] = bpp === 4 ? currRow[src+3] : 255;
      const dx = x - cx + 0.5, dy = y - cy + 0.5;
      if (dx*dx + dy*dy > r2) rgba[dst+3] = 0;
    }
  }

  // Recodificar como PNG RGBA con filtro 0 (None)
  const newRowSize = 1 + width * 4;
  const newRaw = new Uint8Array(height * newRowSize);
  for (let y = 0; y < height; y++) {
    newRaw[y * newRowSize] = 0;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = y * newRowSize + 1 + x * 4;
      newRaw.set(rgba.subarray(src, src + 4), dst);
    }
  }

  // Comprimir con zlib
  const cs = new CompressionStream('deflate');
  { const w = cs.writable.getWriter(); w.write(newRaw); w.close(); }
  const compParts = [];
  const cr = cs.readable.getReader();
  while (true) { const { done, value } = await cr.read(); if (done) break; compParts.push(value); }
  const compSize = compParts.reduce((s, c) => s + c.length, 0);
  const compData = new Uint8Array(compSize);
  pos = 0;
  for (const p of compParts) { compData.set(p, pos); pos += p.length; }

  // Construir PNG de salida
  const ihdrData = new Uint8Array(13);
  const ihdrDv = new DataView(ihdrData.buffer);
  ihdrDv.setUint32(0, width); ihdrDv.setUint32(4, height);
  ihdrData[8] = 8; ihdrData[9] = 6; // 8-bit RGBA

  const sig = new Uint8Array(PNG_SIG);
  const ihdr = buildChunk('IHDR', ihdrData);
  const idat = buildChunk('IDAT', compData);
  const iend = buildChunk('IEND', new Uint8Array(0));

  const total = sig.length + ihdr.length + idat.length + iend.length;
  const out = new Uint8Array(total);
  out.set(sig, 0);
  out.set(ihdr, sig.length);
  out.set(idat, sig.length + ihdr.length);
  out.set(iend, sig.length + ihdr.length + idat.length);
  return out.buffer;
}

// ─── Handler principal ────────────────────────────────────────────────────────
export async function onRequest(context) {
  const { params, env, request } = context;
  const comercioId = params.comercioId;
  const url = new URL(request.url);
  const field = url.searchParams.get('f') === 'hero' ? 'hero_image_url' : 'logo_url';
  const applyCircle = url.searchParams.get('circle') === 'true';

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
  };

  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return new Response('Supabase no configurado', { status: 500, headers });
    }

    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const { data } = await supabase
      .from('comercios')
      .select('logo_url, hero_image_url, logo_shape')
      .eq('id', comercioId)
      .single();

    const imageData = data?.[field];
    if (!imageData) return new Response('No encontrado', { status: 404, headers });

    let binary;
    let contentType;

    if (imageData.startsWith('http')) {
      // URL pública — fetch directo
      const res = await fetch(imageData);
      if (!res.ok) return new Response('Error fetching image', { status: 502, headers });
      contentType = res.headers.get('Content-Type') || 'image/png';
      binary = await res.arrayBuffer();
    } else if (imageData.startsWith('data:')) {
      const match = imageData.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return new Response('Datos de imagen inválidos', { status: 400, headers });
      contentType = match[1];
      binary = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)).buffer;
    } else {
      return new Response('Formato de imagen no soportado', { status: 400, headers });
    }

    // Aplicar máscara circular si se solicita y la imagen es PNG
    if (applyCircle && contentType === 'image/png') {
      binary = await applyCircleMask(binary);
      contentType = 'image/png';
    }

    return new Response(binary, {
      status: 200,
      headers: { 'Content-Type': contentType, ...headers },
    });

  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500, headers });
  }
}

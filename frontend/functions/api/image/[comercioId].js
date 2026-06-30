// Cloudflare Pages Function — /api/image/:comercioId?f=logo|hero&circle=true&strip=true
// Sirve imágenes desde Supabase como HTTP público.
// ?circle=true  → máscara circular (logos, soporta PNG y JPEG)
// ?strip=true   → ajusta la imagen a la proporción del banner de Apple Wallet
//                 (~3:1) SIN recortar, rellenando con el color de fondo del comercio

import { createClient } from '@supabase/supabase-js';
import jpeg from 'jpeg-js';

// ─── CRC32 ─────────────────────────────────────────────────────────────────────
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
  const ci = new Uint8Array(4 + data.length);
  ci.set(typeB); ci.set(data, 4);
  dv.setUint32(8 + data.length, crc32(ci));
  return out;
}

// ─── Codifica píxeles RGBA crudos como PNG ─────────────────────────────────────
async function rgbaToPng(rgba, width, height) {
  const rowSize = 1 + width * 4;
  const rawData = new Uint8Array(height * rowSize);
  for (let y = 0; y < height; y++) {
    rawData[y * rowSize] = 0; // filtro None
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4, d = y * rowSize + 1 + x * 4;
      rawData.set(rgba.subarray(s, s + 4), d);
    }
  }

  const cs = new CompressionStream('deflate');
  { const w = cs.writable.getWriter(); w.write(rawData); w.close(); }
  const parts = [];
  const rdr = cs.readable.getReader();
  while (true) { const { done, value } = await rdr.read(); if (done) break; parts.push(value); }
  const compSize = parts.reduce((s, c) => s + c.length, 0);
  const compData = new Uint8Array(compSize);
  let pos = 0;
  for (const p of parts) { compData.set(p, pos); pos += p.length; }

  const ihdrData = new Uint8Array(13);
  const ihdrDv = new DataView(ihdrData.buffer);
  ihdrDv.setUint32(0, width); ihdrDv.setUint32(4, height);
  ihdrData[8] = 8; ihdrData[9] = 6; // 8-bit RGBA

  const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = buildChunk('IHDR', ihdrData);
  const idat = buildChunk('IDAT', compData);
  const iend = buildChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(PNG_SIG.length + ihdr.length + idat.length + iend.length);
  let o = 0;
  for (const part of [PNG_SIG, ihdr, idat, iend]) { out.set(part, o); o += part.length; }
  return out.buffer;
}

function applyCircleMaskInPlace(rgba, width, height) {
  const cx = width / 2, cy = height / 2;
  const r2 = Math.min(cx, cy) ** 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx + 0.5, dy = y - cy + 0.5;
      if (dx * dx + dy * dy > r2) rgba[(y * width + x) * 4 + 3] = 0;
    }
  }
}

function compositeOntoBackground(rgba, width, height, r, g, b) {
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3] / 255;
    if (a < 1) {
      rgba[i * 4]     = Math.round(r * (1 - a) + rgba[i * 4]     * a);
      rgba[i * 4 + 1] = Math.round(g * (1 - a) + rgba[i * 4 + 1] * a);
      rgba[i * 4 + 2] = Math.round(b * (1 - a) + rgba[i * 4 + 2] * a);
      rgba[i * 4 + 3] = 255;
    }
  }
}

// ─── Decodifica JPEG/PNG → { rgba, width, height } ─────────────────────────────
function decodeJpeg(buffer) {
  const decoded = jpeg.decode(new Uint8Array(buffer), { useTArray: true });
  return { rgba: new Uint8Array(decoded.data), width: decoded.width, height: decoded.height };
}

function decodePng(inputBuffer) {
  const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  const bytes = new Uint8Array(inputBuffer);
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) return null; // no es PNG

  const dv = new DataView(inputBuffer);
  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idatParts = [];

  while (offset < bytes.length - 11) {
    const len = dv.getUint32(offset);
    const type = String.fromCharCode(bytes[offset+4], bytes[offset+5], bytes[offset+6], bytes[offset+7]);
    if (type === 'IHDR') {
      width = dv.getUint32(offset + 8); height = dv.getUint32(offset + 12);
      bitDepth = bytes[offset + 16]; colorType = bytes[offset + 17]; interlace = bytes[offset + 20];
    } else if (type === 'IDAT') {
      idatParts.push(bytes.slice(offset + 8, offset + 8 + len));
    } else if (type === 'IEND') break;
    offset += 12 + len;
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) return null;
  return { idatParts, width, height, colorType };
}

async function decodePngToRgba(inputBuffer) {
  const parsed = decodePng(inputBuffer);
  if (!parsed) return null;
  const { idatParts, width, height, colorType } = parsed;

  const idatSize = idatParts.reduce((s, c) => s + c.length, 0);
  const idatCombined = new Uint8Array(idatSize);
  let pos = 0;
  for (const p of idatParts) { idatCombined.set(p, pos); pos += p.length; }

  const ds = new DecompressionStream('deflate');
  { const w = ds.writable.getWriter(); w.write(idatCombined); w.close(); }
  const rawParts = [];
  const rdr = ds.readable.getReader();
  while (true) { const { done, value } = await rdr.read(); if (done) break; rawParts.push(value); }
  const rawSize = rawParts.reduce((s, c) => s + c.length, 0);
  const raw = new Uint8Array(rawSize);
  pos = 0;
  for (const p of rawParts) { raw.set(p, pos); pos += p.length; }

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const rgba = new Uint8Array(width * height * 4);
  const prevRow = new Uint8Array(stride);
  const currRow = new Uint8Array(stride);
  let rawPos = 0;

  for (let y = 0; y < height; y++) {
    const ft = raw[rawPos++];
    for (let x = 0; x < stride; x++) {
      const rb = raw[rawPos + x];
      const a = x >= bpp ? currRow[x - bpp] : 0;
      const b = prevRow[x];
      const c = x >= bpp ? prevRow[x - bpp] : 0;
      let val;
      switch (ft) {
        case 0: val = rb; break;
        case 1: val = rb + a; break;
        case 2: val = rb + b; break;
        case 3: val = rb + Math.floor((a + b) / 2); break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p-a), pb = Math.abs(p-b), pc = Math.abs(p-c);
          val = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break;
        }
        default: val = rb;
      }
      currRow[x] = val & 0xFF;
    }
    rawPos += stride;
    prevRow.set(currRow);
    for (let x = 0; x < width; x++) {
      const s = x * bpp, d = (y * width + x) * 4;
      rgba[d] = currRow[s]; rgba[d+1] = currRow[s+1]; rgba[d+2] = currRow[s+2];
      rgba[d+3] = bpp === 4 ? currRow[s+3] : 255;
    }
  }

  return { rgba, width, height };
}

// Decodifica cualquier formato soportado a RGBA. Devuelve null si no se puede.
async function decodeToRgba(buffer, contentType) {
  if (contentType === 'image/jpeg' || contentType === 'image/jpg') return decodeJpeg(buffer);
  if (contentType === 'image/png') return await decodePngToRgba(buffer);
  return null;
}

// Límite de seguridad: por encima de esto, decodificar+recodificar píxel a
// píxel arriesga exceder el límite de CPU de Cloudflare Workers (error 1102).
// Lee solo el header (barato) para decidir si vale la pena intentar procesar.
const MAX_SAFE_PIXELS = 600_000; // ~775x775, o el banner ya ajustado (1125x369=415k) entra holgado

function peekImageDimensions(buffer, contentType) {
  const bytes = new Uint8Array(buffer);
  try {
    if (contentType === 'image/png') {
      const dv = new DataView(buffer);
      // IHDR siempre es el primer chunk: width en offset 16, height en offset 20
      return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    if (contentType === 'image/jpeg' || contentType === 'image/jpg') {
      let i = 2; // saltar SOI (0xFFD8)
      while (i < bytes.length - 9) {
        if (bytes[i] !== 0xFF) { i++; continue; }
        const marker = bytes[i + 1];
        // Marcadores SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 contienen dimensiones
        if ((marker >= 0xC0 && marker <= 0xCF) && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          const height = (bytes[i + 5] << 8) | bytes[i + 6];
          const width = (bytes[i + 7] << 8) | bytes[i + 8];
          return { width, height };
        }
        const segmentLength = (bytes[i + 2] << 8) | bytes[i + 3];
        i += 2 + segmentLength;
      }
    }
  } catch (_) {}
  return null;
}

// ─── Redimensiona RGBA (nearest-neighbor) ──────────────────────────────────────
function resizeRGBA(src, srcW, srcH, dstW, dstH) {
  const dst = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const srcY = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      const s = (srcY * srcW + srcX) * 4, d = (y * dstW + x) * 4;
      dst[d] = src[s]; dst[d+1] = src[s+1]; dst[d+2] = src[s+2]; dst[d+3] = src[s+3];
    }
  }
  return dst;
}

// Encaja la imagen dentro de un cuadrado (contain — sin recorte), centrando
// y dejando los bordes transparentes para que compositeOntoBackground los rellene.
function fitToSquareContain(rgba, srcW, srcH, size) {
  const scale = Math.min(size / srcW, size / srcH);
  const newW = Math.max(1, Math.round(srcW * scale));
  const newH = Math.max(1, Math.round(srcH * scale));
  const resized = resizeRGBA(rgba, srcW, srcH, newW, newH);
  const canvas = new Uint8Array(size * size * 4); // transparent (zeros)
  const ox = Math.floor((size - newW) / 2);
  const oy = Math.floor((size - newH) / 2);
  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const s = (y * newW + x) * 4, d = ((y + oy) * size + (x + ox)) * 4;
      canvas[d] = resized[s]; canvas[d+1] = resized[s+1];
      canvas[d+2] = resized[s+2]; canvas[d+3] = resized[s+3];
    }
  }
  return canvas;
}

// Llena el canvas COMPLETO (sin relleno/letterbox) recortando el sobrante,
// pero con el punto de recorte vertical sesgado hacia arriba (verticalBias
// bajo) para priorizar el contenido superior de la imagen (logos, texto)
// y recortar de abajo en su lugar.
function fitToCanvas(srcRgba, srcW, srcH, canvasW, canvasH, verticalBias = 0.2) {
  const scale = Math.max(canvasW / srcW, canvasH / srcH); // cover: llena todo
  const newW = Math.max(1, Math.round(srcW * scale));
  const newH = Math.max(1, Math.round(srcH * scale));
  const resized = resizeRGBA(srcRgba, srcW, srcH, newW, newH);

  const offsetX = Math.floor((newW - canvasW) * 0.5);
  const offsetY = Math.floor((newH - canvasH) * verticalBias);

  const canvas = new Uint8Array(canvasW * canvasH * 4);

  for (let y = 0; y < canvasH; y++) {
    const srcY = y + offsetY;
    if (srcY < 0 || srcY >= newH) continue;
    for (let x = 0; x < canvasW; x++) {
      const srcX = x + offsetX;
      if (srcX < 0 || srcX >= newW) continue;
      const s = (srcY * newW + srcX) * 4, d = (y * canvasW + x) * 4;
      canvas[d]   = resized[s];
      canvas[d+1] = resized[s+1];
      canvas[d+2] = resized[s+2];
      canvas[d+3] = 255;
    }
  }
  return canvas;
}

// Dimensiones del strip de Apple Wallet @3x (storeCard sin thumbnail)
const STRIP_W = 1125, STRIP_H = 369;

// ─── Handler principal ────────────────────────────────────────────────────────
export async function onRequest(context) {
  const { params, env, request } = context;
  const comercioId = params.comercioId;
  const url = new URL(request.url);
  const fParam = url.searchParams.get('f');
  const field = fParam === 'hero' ? 'hero_image_url' : fParam === 'icon' ? 'icon_url' : 'logo_url';
  const applyCircle = url.searchParams.get('circle') === 'true';
  const fitStrip = url.searchParams.get('strip') === 'true';
  const bgHex = url.searchParams.get('bg'); // e.g. '0b2c65' — composite image onto this background
  const iconSize = parseInt(url.searchParams.get('size') || '0', 10); // resize to NxN square (contain)

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
      .select('logo_url, hero_image_url, icon_url')
      .eq('id', comercioId)
      .single();

    const imageData = data?.[field];
    if (!imageData) return new Response('No encontrado', { status: 404, headers });

    let binary;
    let contentType;

    if (imageData.startsWith('http')) {
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
      return new Response('Formato no soportado', { status: 400, headers });
    }

    // Guard de seguridad: si la imagen es muy grande, NO intentar decodificarla
    // pixel a pixel — eso es lo que causaba el error 1102 (límite de CPU de
    // Cloudflare). IMPORTANTE: en ese caso NO se debe devolver la imagen
    // original sin reducir tampoco — eso solo mueve el problema río abajo:
    // apple.js terminaría hasheando/firmando un archivo gigante dentro del
    // .pkpass y exceder su PROPIO límite de CPU igual. Por eso, cuando se pide
    // una versión procesada (?circle= o ?strip=) y la imagen es demasiado
    // grande, se responde "no disponible" — el caller (loadImage en apple.js)
    // ya maneja esto con gracia omitiendo el logo/banner en vez de fallar.
    const dims = (applyCircle || fitStrip) ? peekImageDimensions(binary, contentType) : null;
    const tooLargeToProcess = dims && (dims.width * dims.height) > MAX_SAFE_PIXELS;

    if (tooLargeToProcess) {
      return new Response('Imagen demasiado grande para procesar — re-sube una versión más liviana desde Configuración', {
        status: 413,
        headers,
      });
    }

    try {
      if (applyCircle) {
        const decoded = await decodeToRgba(binary, contentType);
        if (decoded) {
          applyCircleMaskInPlace(decoded.rgba, decoded.width, decoded.height);
          if (bgHex) {
            const r = parseInt(bgHex.slice(0, 2), 16);
            const g = parseInt(bgHex.slice(2, 4), 16);
            const b = parseInt(bgHex.slice(4, 6), 16);
            compositeOntoBackground(decoded.rgba, decoded.width, decoded.height, r, g, b);
          }
          binary = await rgbaToPng(decoded.rgba, decoded.width, decoded.height);
          contentType = 'image/png';
        }
      } else if (fitStrip) {
        const decoded = await decodeToRgba(binary, contentType);
        if (decoded) {
          const fitted = fitToCanvas(decoded.rgba, decoded.width, decoded.height, STRIP_W, STRIP_H);
          if (bgHex) {
            const r = parseInt(bgHex.slice(0, 2), 16);
            const g = parseInt(bgHex.slice(2, 4), 16);
            const b = parseInt(bgHex.slice(4, 6), 16);
            compositeOntoBackground(fitted, STRIP_W, STRIP_H, r, g, b);
          }
          binary = await rgbaToPng(fitted, STRIP_W, STRIP_H);
          contentType = 'image/png';
        }
      } else if (iconSize > 0) {
        const decoded = await decodeToRgba(binary, contentType);
        if (decoded) {
          let out = fitToSquareContain(decoded.rgba, decoded.width, decoded.height, iconSize);
          if (bgHex) {
            const r = parseInt(bgHex.slice(0, 2), 16);
            const g = parseInt(bgHex.slice(2, 4), 16);
            const b = parseInt(bgHex.slice(4, 6), 16);
            compositeOntoBackground(out, iconSize, iconSize, r, g, b);
          }
          binary = await rgbaToPng(out, iconSize, iconSize);
          contentType = 'image/png';
        }
      } else if (bgHex) {
        const decoded = await decodeToRgba(binary, contentType);
        if (decoded) {
          const r = parseInt(bgHex.slice(0, 2), 16);
          const g = parseInt(bgHex.slice(2, 4), 16);
          const b = parseInt(bgHex.slice(4, 6), 16);
          compositeOntoBackground(decoded.rgba, decoded.width, decoded.height, r, g, b);
          binary = await rgbaToPng(decoded.rgba, decoded.width, decoded.height);
          contentType = 'image/png';
        }
      }
    } catch (_) {
      // Si el procesamiento falla por cualquier motivo, servir la imagen
      // original sin modificar en vez de fallar la respuesta completa.
      // (Solo llega aquí si la imagen ya pasó el check de tamaño arriba,
      // por lo que es razonablemente chica y segura de embeber tal cual.)
    }

    return new Response(binary, {
      status: 200,
      headers: { 'Content-Type': contentType, ...headers },
    });

  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500, headers });
  }
}

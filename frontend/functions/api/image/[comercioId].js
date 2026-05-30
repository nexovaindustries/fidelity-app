// Cloudflare Pages Function — /api/image/:comercioId?f=logo|hero
// Sirve el logo o banner de un comercio desde Supabase como imagen HTTP pública.
// Necesario porque Google Wallet solo acepta HTTPS URLs, no data: URIs.

import { createClient } from '@supabase/supabase-js';

export async function onRequest(context) {
  const { params, env, request } = context;
  const comercioId = params.comercioId;
  const url = new URL(request.url);
  const field = url.searchParams.get('f') === 'hero' ? 'hero_image_url' : 'logo_url';

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
      .select('logo_url, hero_image_url')
      .eq('id', comercioId)
      .single();

    const imageData = data?.[field];
    if (!imageData) return new Response('No encontrado', { status: 404, headers });

    // Si ya es una URL pública, redirigir directamente
    if (imageData.startsWith('http')) {
      return Response.redirect(imageData, 302);
    }

    // Si es un data URL base64, decodificar y servir como imagen
    if (imageData.startsWith('data:')) {
      const match = imageData.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return new Response('Datos de imagen inválidos', { status: 400, headers });
      const contentType = match[1];
      const binary = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
      return new Response(binary, {
        status: 200,
        headers: { 'Content-Type': contentType, ...headers },
      });
    }

    return new Response('Formato de imagen no soportado', { status: 400, headers });
  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500, headers });
  }
}

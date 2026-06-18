-- ═══════════════════════════════════════════════════════════════════════════
-- Webhook automático hacia Make al registrar un nuevo cliente
-- ═══════════════════════════════════════════════════════════════════════════
-- Ejecutar UNA VEZ en el SQL Editor de Supabase (Dashboard → SQL Editor).
-- Dispara un POST a Make cada vez que se crea una fila en tarjetas_activas
-- (= un cliente nuevo se registró y recibió su tarjeta de fidelidad),
-- sin importar qué parte del código hizo el INSERT.
--
-- Antes de ejecutar, reemplaza 'PEGA_AQUI_TU_WEBHOOK_URL_DE_MAKE' más abajo
-- con la URL real que te da Make al crear el módulo "Custom Webhook".

-- 1. Habilitar la extensión pg_net (HTTP requests async desde Postgres)
create extension if not exists pg_net with schema extensions;

-- 2. Guardar la URL del webhook en Supabase Vault (seguro — no queda
--    expuesta en el código ni en logs de queries)
select vault.create_secret(
  'PEGA_AQUI_TU_WEBHOOK_URL_DE_MAKE',
  'make_webhook_url',
  'URL del webhook de Make para sincronizar nuevos clientes con Kommo'
);

-- Si ya existías el secret y necesitas actualizarlo, usa en su lugar:
-- select vault.update_secret(
--   (select id from vault.secrets where name = 'make_webhook_url'),
--   'NUEVA_URL_AQUI'
-- );

-- 3. Función que arma el payload y dispara el webhook
create or replace function public.notify_make_on_new_tarjeta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  webhook_url text;
  payload jsonb;
  cliente_row record;
  comercio_row record;
begin
  select decrypted_secret into webhook_url
  from vault.decrypted_secrets
  where name = 'make_webhook_url';

  if webhook_url is null or webhook_url = '' then
    raise warning 'notify_make_on_new_tarjeta: make_webhook_url no configurado en Vault, se omite el aviso';
    return new;
  end if;

  select * into cliente_row from clientes where id = new.cliente_id;
  select * into comercio_row from comercios where id = new.comercio_id;

  payload := jsonb_build_object(
    'evento', 'nuevo_registro_fidelidad',
    'tarjeta_id', new.id,
    'cliente_id', new.cliente_id,
    'nombre', cliente_row.nombre_completo,
    'telefono', cliente_row.telefono,
    'email', cliente_row.email,
    'fecha_registro', new.created_at,
    'comercio_id', new.comercio_id,
    'comercio_nombre', comercio_row.nombre,
    'tipo_fidelizacion', comercio_row.tipo_fidelizacion,
    'puntos_iniciales', coalesce(new.puntos_actuales, 0),
    'sellos_iniciales', coalesce(new.total_sellos, 0),
    'qr_value', new.qr_value,
    'fecha_expiracion', new.fecha_expiracion
  );

  -- pg_net es asíncrono: no bloquea ni falla el INSERT si Make está caído
  -- o tarda en responder. El resultado se puede auditar en net._http_response.
  perform net.http_post(
    url := webhook_url,
    body := payload,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );

  return new;
exception
  when others then
    -- Cualquier error en el armado del payload tampoco debe romper el registro
    raise warning 'notify_make_on_new_tarjeta error: %', sqlerrm;
    return new;
end;
$$;

-- 4. Trigger: se ejecuta automáticamente después de cada INSERT en tarjetas_activas
drop trigger if exists trg_notify_make_on_new_tarjeta on tarjetas_activas;
create trigger trg_notify_make_on_new_tarjeta
  after insert on tarjetas_activas
  for each row
  execute function public.notify_make_on_new_tarjeta();

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación: consulta para ver el historial de llamadas al webhook
-- (status_code, respuesta, errores) — útil para debugging
-- ═══════════════════════════════════════════════════════════════════════════
-- select * from net._http_response order by created desc limit 20;

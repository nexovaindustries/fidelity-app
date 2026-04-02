-- ==============================================
-- Fidelity App - Actualización de Esquema SQL
-- Soportar plantillas, mecánicas de fidelización y expiraciones
-- ==============================================

-- 1. Ampliar tabla comercios
ALTER TABLE public.comercios
  ADD COLUMN IF NOT EXISTS plantilla_diseño text DEFAULT 'estandar', -- 'estandar', 'cafeteria', 'restaurante', 'peluqueria'
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS hero_image_url text,
  ADD COLUMN IF NOT EXISTS tipo_fidelizacion text DEFAULT 'puntos', -- 'puntos', 'sellos', 'niveles'
  ADD COLUMN IF NOT EXISTS config_fidelizacion jsonb DEFAULT '{"dias_expiracion": 365, "meta_puntos": 100, "meta_sellos": 10}'::jsonb;

-- 2. Ampliar tabla tarjetas_activas
ALTER TABLE public.tarjetas_activas
  ADD COLUMN IF NOT EXISTS fecha_expiracion timestamptz,
  ADD COLUMN IF NOT EXISTS puntos_actuales integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_sellos integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nivel_actual text DEFAULT 'Bronce';

-- 3. (Opcional) Actualizar RLS si es necesario
-- Dado que dependemos de un Service Role Key para el backend
-- estas columas son modificables y visibles automáticamente por el Service Role.

-- ==============================================
-- Instrucciones:
-- Copia este script y ejecútalo en la pestaña "SQL Editor" de tu proyecto de Supabase.
-- Asegura que haya comercios creados antes de emitir tarjetas, y configúralos con los valores correctos.
-- ==============================================

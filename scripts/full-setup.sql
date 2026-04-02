-- ============================================================
-- Fidelity App - FULL Database Setup
-- Run this ENTIRE script in Supabase SQL Editor
-- ============================================================

-- 1. Tabla de Comercios (los clientes B2B que pagan por el servicio)
CREATE TABLE IF NOT EXISTS comercios (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  nombre text NOT NULL DEFAULT 'Mi Comercio',
  plantilla_diseno text DEFAULT 'default',
  tipo_fidelizacion text DEFAULT 'puntos' CHECK (tipo_fidelizacion IN ('puntos', 'sellos', 'niveles')),
  config_fidelizacion jsonb DEFAULT '{}',
  color_fondo text DEFAULT '#1a1a2e',
  color_texto text DEFAULT '#e0e0e0',
  color_acento text DEFAULT '#e94560',
  texto_personalizado text DEFAULT '',
  dias_expiracion integer DEFAULT 365,
  logo_url text DEFAULT '',
  hero_image_url text DEFAULT '',
  logo_size integer DEFAULT 50,
  logo_shape text DEFAULT 'circle',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Tabla de Clientes (consumidores finales)
CREATE TABLE IF NOT EXISTS clientes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre_completo text NOT NULL DEFAULT '',
  email text UNIQUE,
  telefono text,
  created_at timestamptz DEFAULT now()
);

-- 3. Tabla de Tarjetas Activas (relación Comercio <-> Cliente)
CREATE TABLE IF NOT EXISTS tarjetas_activas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  comercio_id uuid NOT NULL REFERENCES comercios(id) ON DELETE CASCADE,
  cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  qr_value text UNIQUE NOT NULL,
  puntos_actuales integer DEFAULT 0,
  total_sellos integer DEFAULT 0,
  nivel_actual text DEFAULT NULL,
  fecha_expiracion timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 4. Tabla de Transacciones (log de toda actividad)
CREATE TABLE IF NOT EXISTS transacciones (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  comercio_id uuid NOT NULL REFERENCES comercios(id) ON DELETE CASCADE,
  tarjeta_id uuid REFERENCES tarjetas_activas(id) ON DELETE SET NULL,
  tipo text NOT NULL DEFAULT 'sumar' CHECK (tipo IN ('sumar', 'restar', 'canjear')),
  cantidad integer NOT NULL DEFAULT 1,
  descripcion text,
  created_at timestamptz DEFAULT now()
);

-- 5. Tabla de Recompensas (configuradas por el comercio)
CREATE TABLE IF NOT EXISTS recompensas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  comercio_id uuid NOT NULL REFERENCES comercios(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  descripcion text,
  costo_puntos integer NOT NULL DEFAULT 100,
  activa boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- INDEXES para performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tarjetas_comercio ON tarjetas_activas(comercio_id);
CREATE INDEX IF NOT EXISTS idx_tarjetas_cliente ON tarjetas_activas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_tarjetas_qr ON tarjetas_activas(qr_value);
CREATE INDEX IF NOT EXISTS idx_transacciones_comercio ON transacciones(comercio_id);
CREATE INDEX IF NOT EXISTS idx_transacciones_created ON transacciones(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recompensas_comercio ON recompensas(comercio_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE comercios ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarjetas_activas ENABLE ROW LEVEL SECURITY;
ALTER TABLE transacciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE recompensas ENABLE ROW LEVEL SECURITY;

-- Policies: permitir todo para usuarios autenticados
-- (En producción se filtraría por comercio_id del usuario)
CREATE POLICY "allow_authenticated_comercios" ON comercios
  FOR ALL USING (auth.role() = 'authenticated' OR auth.role() = 'anon') WITH CHECK (true);

CREATE POLICY "allow_authenticated_clientes" ON clientes
  FOR ALL USING (auth.role() = 'authenticated' OR auth.role() = 'anon') WITH CHECK (true);

CREATE POLICY "allow_authenticated_tarjetas" ON tarjetas_activas
  FOR ALL USING (auth.role() = 'authenticated' OR auth.role() = 'anon') WITH CHECK (true);

CREATE POLICY "allow_authenticated_transacciones" ON transacciones
  FOR ALL USING (auth.role() = 'authenticated' OR auth.role() = 'anon') WITH CHECK (true);

CREATE POLICY "allow_authenticated_recompensas" ON recompensas
  FOR ALL USING (auth.role() = 'authenticated' OR auth.role() = 'anon') WITH CHECK (true);

-- ============================================================
-- DONE!
-- ============================================================
SELECT 'All tables created successfully!' as status;

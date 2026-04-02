-- ============================================================
-- Fidelity App - Database Migration Script
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ============================================================

-- 1. Tabla de Transacciones (log de toda actividad)
CREATE TABLE IF NOT EXISTS transacciones (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  comercio_id uuid NOT NULL,
  tarjeta_id uuid,
  tipo text NOT NULL DEFAULT 'sumar' CHECK (tipo IN ('sumar', 'restar', 'canjear')),
  cantidad integer NOT NULL DEFAULT 1,
  descripcion text,
  created_at timestamptz DEFAULT now()
);

-- Index para queries rápidas del dashboard
CREATE INDEX IF NOT EXISTS idx_transacciones_comercio ON transacciones(comercio_id);
CREATE INDEX IF NOT EXISTS idx_transacciones_created ON transacciones(created_at DESC);

-- 2. Tabla de Recompensas (configuradas por el comercio)
CREATE TABLE IF NOT EXISTS recompensas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  comercio_id uuid NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  costo_puntos integer NOT NULL DEFAULT 100,
  activa boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recompensas_comercio ON recompensas(comercio_id);

-- 3. Agregar columnas nuevas a comercios (ignorar si ya existen)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='comercios' AND column_name='logo_size') THEN
    ALTER TABLE comercios ADD COLUMN logo_size integer DEFAULT 50;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='comercios' AND column_name='logo_shape') THEN
    ALTER TABLE comercios ADD COLUMN logo_shape text DEFAULT 'circle';
  END IF;
END $$;

-- 4. RLS (Row Level Security) policies
ALTER TABLE transacciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE recompensas ENABLE ROW LEVEL SECURITY;

-- Permitir lectura/escritura a usuarios autenticados
CREATE POLICY IF NOT EXISTS "allow_all_transacciones" ON transacciones
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "allow_all_recompensas" ON recompensas
  FOR ALL USING (true) WITH CHECK (true);

-- Listo! Las tablas están creadas.
SELECT 'Migration completed successfully!' as status;

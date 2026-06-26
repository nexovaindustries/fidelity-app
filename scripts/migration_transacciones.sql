-- Historial de transacciones por escaneo
-- Ejecutar en Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS transacciones (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  comercio_id UUID        NOT NULL REFERENCES comercios(id) ON DELETE CASCADE,
  tarjeta_id  UUID        NOT NULL REFERENCES tarjetas_activas(id) ON DELETE CASCADE,
  cliente_id  UUID        NOT NULL,
  nombre_cliente TEXT,
  sede        TEXT,
  accion      TEXT        NOT NULL,
  cantidad    INTEGER     NOT NULL DEFAULT 1,
  saldo_antes INTEGER,
  saldo_despues INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trans_comercio ON transacciones(comercio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trans_tarjeta  ON transacciones(tarjeta_id,  created_at DESC);

-- Agrega la columna fecha_nacimiento a la tabla clientes
-- Ejecutar en Supabase Dashboard → SQL Editor
-- El email ya existía como columna; esta migración solo agrega fecha_nacimiento.

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE;

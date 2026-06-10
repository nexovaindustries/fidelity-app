// Migración: agrega notification_message a tarjetas_activas
// Ejecutar UNA VEZ: node scripts/add_notification_fields.js

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function migrate() {
  console.log('Ejecutando migración...\n');

  // Supabase permite agregar columnas via SQL usando la API de admin
  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      ALTER TABLE tarjetas_activas
        ADD COLUMN IF NOT EXISTS notification_message TEXT DEFAULT NULL;
    `
  });

  if (error) {
    // Si exec_sql no existe, usar el panel de Supabase manualmente
    console.warn('⚠️  No se pudo ejecutar via RPC. Ejecuta este SQL manualmente en el SQL Editor de Supabase:\n');
    console.log('ALTER TABLE tarjetas_activas ADD COLUMN IF NOT EXISTS notification_message TEXT DEFAULT NULL;\n');
    return;
  }

  console.log('✅ Columna notification_message agregada a tarjetas_activas');
}

migrate().catch(console.error);

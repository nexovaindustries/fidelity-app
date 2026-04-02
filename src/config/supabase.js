const { createClient } = require('@supabase/supabase-js');
const env = require('./env');

if (!env.supabase.url || !env.supabase.serviceRoleKey) {
  console.error('Faltan credenciales de Supabase en las variables de entorno');
}

// Inicializar cliente con Service Role para saltar RLS en operaciones de server
const supabase = createClient(env.supabase.url, env.supabase.serviceRoleKey);

module.exports = supabase;

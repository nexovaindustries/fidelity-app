/**
 * Script de Setup Inicial — Nexova Industries
 * Crea el usuario administrador y el primer negocio (Arly Heladería).
 *
 * Uso:
 *   node scripts/setup-users.js
 *
 * Requiere que el .env esté configurado con SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function createAuthUser(email, password, label) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    if (error.message.toLowerCase().includes('already registered') || error.message.toLowerCase().includes('already exists')) {
      console.log(`  ⚠️  ${label} ya existe en Auth — omitiendo.`);
      // Buscar el user existente
      const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      return users.find(u => u.email === email) || null;
    }
    throw error;
  }
  return data.user;
}

async function main() {
  console.log('\n🚀 Setup Inicial — Nexova Industries\n');

  // ─── 1. Administrador ─────────────────────────────────────────────────────
  console.log('👤 Creando cuenta Admin...');
  await createAuthUser('nexova.industries@gmail.com', 'Nexova2026@', 'Admin');
  console.log('  ✓ nexova.industries@gmail.com / Nexova2026@');

  // ─── 2. Arly Heladería ────────────────────────────────────────────────────
  console.log('\n🍦 Creando negocio: Arly Heladería...');
  const username = 'Arly.helados';
  const email = `${username}@nexova.app`;

  const arlyUser = await createAuthUser(email, 'Arly123', 'Arly.helados');

  if (arlyUser) {
    // Verificar si ya tiene comercio
    const { data: existing } = await supabase
      .from('comercios')
      .select('id')
      .eq('user_id', arlyUser.id)
      .single();

    if (existing) {
      console.log('  ⚠️  Comercio de Arly.helados ya existe — omitiendo.');
    } else {
      const { error: comercioError } = await supabase
        .from('comercios')
        .insert([{
          user_id: arlyUser.id,
          owner_email: email,
          nombre: 'Arly Heladería',
          slogan: 'El helado más fresco de la ciudad',
          tipo_fidelizacion: 'sellos',
          config_fidelizacion: {
            meta_sellos: 10,
            puntos_para_recompensa: 100,
            descripcion_recompensa: 'Helado gratis al completar 10 sellos',
          },
          plantilla_diseno: 'default',
          color_fondo: '#1a1a2e',
          color_texto: '#e0e0e0',
          color_acento: '#e94560',
          dias_expiracion: 365,
        }]);

      if (comercioError) {
        console.error('  ❌ Error creando comercio:', comercioError.message);
      } else {
        console.log('  ✓ Comercio creado exitosamente');
      }
    }
    console.log('  ✓ Arly.helados / Arly123');
  }

  // ─── Resumen ──────────────────────────────────────────────────────────────
  console.log('\n✅ Setup completo!\n');
  console.log('┌─────────────────────────────────────────────────────┐');
  console.log('│  ADMIN                                              │');
  console.log('│  Usuario: nexova.industries@gmail.com               │');
  console.log('│  Clave:   Nexova2026@                               │');
  console.log('│  URL:     /admin                                    │');
  console.log('├─────────────────────────────────────────────────────┤');
  console.log('│  ARLY HELADERÍA                                     │');
  console.log('│  Usuario: Arly.helados                              │');
  console.log('│  Clave:   Arly123                                   │');
  console.log('│  URL:     / (dashboard del negocio)                 │');
  console.log('└─────────────────────────────────────────────────────┘\n');

  console.log('⚠️  Recuerda agregar en tu .env del servidor:');
  console.log('   ADMIN_EMAILS=nexova.industries@gmail.com\n');
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});

const { createClient } = require('@supabase/supabase-js');
const env = require('../config/env');

const supabaseAdmin = createClient(env.supabase.url, env.supabase.serviceRoleKey);
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const adminAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Token de autenticación requerido.' });
  }

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Token inválido o expirado.' });
    }

    if (ADMIN_EMAILS.length === 0) {
      return res.status(403).json({ error: 'No hay administradores configurados. Revisa ADMIN_EMAILS en el .env del servidor.' });
    }

    if (!ADMIN_EMAILS.includes(user.email.toLowerCase())) {
      return res.status(403).json({ error: 'Acceso denegado. Solo administradores de Nexova Industries.' });
    }

    req.adminUser = user;
    next();
  } catch (err) {
    console.error('Admin auth error:', err);
    return res.status(500).json({ error: 'Error de autenticación.' });
  }
};

module.exports = adminAuth;

const { createClient } = require('@supabase/supabase-js');
const env = require('../config/env');

const supabaseAdmin = createClient(env.supabase.url, env.supabase.serviceRoleKey);

/** GET /api/admin/check — solo verifica que el middleware de admin pasó */
const checkAdmin = (req, res) => {
  res.json({ ok: true, admin: req.adminUser.email });
};

/** GET /api/admin/comercios — lista todos los negocios con estadísticas */
const listComercios = async (req, res, next) => {
  try {
    // 1. Traer todos los comercios
    const { data: comercios, error } = await supabaseAdmin
      .from('comercios')
      .select('id, nombre, slogan, tipo_fidelizacion, user_id, owner_email, created_at, plantilla_diseno, telefono, sitio_web')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // 2. Contar tarjetas por comercio
    const comercioIds = comercios.map((c) => c.id);
    let cardCounts = {};
    if (comercioIds.length > 0) {
      const { data: counts } = await supabaseAdmin
        .from('tarjetas_activas')
        .select('comercio_id')
        .in('comercio_id', comercioIds);

      (counts || []).forEach((row) => {
        cardCounts[row.comercio_id] = (cardCounts[row.comercio_id] || 0) + 1;
      });
    }

    // 3. Si owner_email falta, intentar traerlo de auth.users
    const missingEmails = comercios.filter((c) => !c.owner_email && c.user_id);
    if (missingEmails.length > 0) {
      try {
        const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
        const userMap = {};
        (users || []).forEach((u) => { userMap[u.id] = u.email; });
        missingEmails.forEach((c) => {
          c.owner_email = userMap[c.user_id] || '';
        });
      } catch {
        // no-op: email stays empty
      }
    }

    const result = comercios.map((c) => ({
      ...c,
      tarjetas_count: cardCounts[c.id] || 0,
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

/** POST /api/admin/comercios — crea un nuevo negocio + usuario Supabase Auth */
const createComercio = async (req, res, next) => {
  try {
    const {
      username,
      password,
      nombre,
      tipo_fidelizacion = 'puntos',
      slogan = '',
      telefono = '',
      sitio_web = '',
      meta_sellos = 10,
      puntos_para_recompensa = 100,
      descripcion_recompensa = '',
    } = req.body;

    if (!nombre || !username || !password) {
      return res.status(400).json({ error: 'nombre, username y password son obligatorios.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
      return res.status(400).json({ error: 'El usuario solo puede contener letras, números, puntos, guiones y guiones bajos.' });
    }

    // El email interno es username@nexova.app (nunca se muestra al cliente)
    const email = `${username}@nexova.app`;

    // 1. Crear usuario en Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      if (authError.message.includes('already registered')) {
        return res.status(409).json({ error: `El usuario "${username}" ya existe.` });
      }
      throw authError;
    }

    const userId = authData.user.id;

    // 2. Crear el registro del comercio
    const { data: comercio, error: comercioError } = await supabaseAdmin
      .from('comercios')
      .insert([{
        user_id: userId,
        owner_email: email,
        nombre,
        slogan,
        telefono,
        sitio_web,
        tipo_fidelizacion,
        config_fidelizacion: {
          meta_sellos: parseInt(meta_sellos),
          puntos_para_recompensa: parseInt(puntos_para_recompensa),
          descripcion_recompensa,
        },
        plantilla_diseno: 'default',
        color_fondo: '#1a1a2e',
        color_texto: '#e0e0e0',
        color_acento: '#e94560',
        dias_expiracion: 365,
      }])
      .select()
      .single();

    if (comercioError) {
      // Rollback: borrar el usuario si falló el comercio
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw comercioError;
    }

    res.status(201).json({
      success: true,
      message: 'Negocio creado exitosamente.',
      comercio,
      credentials: { username, password },
    });
  } catch (err) {
    next(err);
  }
};

/** PUT /api/admin/comercios/:id — actualiza datos del comercio */
const updateComercio = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { nombre, slogan, telefono, sitio_web, tipo_fidelizacion } = req.body;

    const { data, error } = await supabaseAdmin
      .from('comercios')
      .update({ nombre, slogan, telefono, sitio_web, tipo_fidelizacion })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

/** DELETE /api/admin/comercios/:id — elimina el comercio y su usuario Auth */
const deleteComercio = async (req, res, next) => {
  try {
    const { id } = req.params;

    // 1. Traer el user_id antes de borrar
    const { data: comercio, error: fetchError } = await supabaseAdmin
      .from('comercios')
      .select('user_id, nombre')
      .eq('id', id)
      .single();

    if (fetchError || !comercio) {
      return res.status(404).json({ error: 'Comercio no encontrado.' });
    }

    // 2. Borrar el comercio (ON DELETE CASCADE limpia tarjetas y transacciones)
    const { error: deleteError } = await supabaseAdmin
      .from('comercios')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    // 3. Borrar el usuario de Supabase Auth
    if (comercio.user_id) {
      await supabaseAdmin.auth.admin.deleteUser(comercio.user_id);
    }

    res.json({ success: true, message: `Negocio "${comercio.nombre}" eliminado.` });
  } catch (err) {
    next(err);
  }
};

/** GET /api/admin/stats — estadísticas globales */
const getGlobalStats = async (req, res, next) => {
  try {
    const [
      { count: totalComercios },
      { count: totalTarjetas },
      { count: totalClientes },
    ] = await Promise.all([
      supabaseAdmin.from('comercios').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('tarjetas_activas').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('clientes').select('*', { count: 'exact', head: true }),
    ]);

    res.json({
      success: true,
      data: {
        totalComercios: totalComercios || 0,
        totalTarjetas: totalTarjetas || 0,
        totalClientes: totalClientes || 0,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  checkAdmin,
  listComercios,
  createComercio,
  updateComercio,
  deleteComercio,
  getGlobalStats,
};

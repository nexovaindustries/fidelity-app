const supabaseService = require('../services/supabaseService');

/**
 * Maneja el endpoint de registro/suscripción
 * POST /api/registro
 * Body extricto requerido: { comercio_id, nombre_completo, email }
 */
const registerUser = async (req, res, next) => {
  try {
    const { comercio_id, nombre_completo, email } = req.body;

    if (!comercio_id || !nombre_completo || !email) {
      return res.status(400).json({ 
        error: 'Faltan parámetros requeridos: comercio_id, nombre_completo o email' 
      });
    }

    // 1. Obtener o crear el cliente central
    const cliente = await supabaseService.getOrCreateClient(email, nombre_completo);

    // 2. Emitir o recuperar la tarjeta de fidelidad de este comercio específico
    const tarjeta = await supabaseService.issueLoyaltyCard(comercio_id, cliente.id);

    // 3. Devolver los IDs y payload críticos para el Frontend
    res.status(201).json({
      message: 'Registro exitoso. Tarjeta de fidelidad vinculada.',
      tarjeta: {
        id: tarjeta.id,
        puntos_actuales: tarjeta.puntos_actuales,
        qr_value: tarjeta.qr_value,
        comercio: {
          id: tarjeta.comercios.id,
          nombre: tarjeta.comercios.nombre,
          tipo_fidelizacion: tarjeta.comercios.tipo_fidelizacion
        }
      },
      // En el JSON devolvemos las URLs dinámicas con las cuales
      // los frontend invocarán la descarga del Wallet correspondientemente
      walletLinks: {
        apple: `/api/pass/apple/${tarjeta.id}`,
        google: `/api/pass/google/${tarjeta.id}`
      }
    });

  } catch (error) {
    next(error); // Pasa al errorHandler.js global
  }
};

module.exports = {
  registerUser
};

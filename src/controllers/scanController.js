const supabaseService = require('../services/supabaseService');
const env = require('../config/env');

/**
 * Procesa el escaneo de un código QR por parte de un comercio.
 * Actualiza el balance de fidelización de la tarjeta asociada.
 */
const processScanRequest = async (req, res, next) => {
  try {
    const { comercio_id, qr_value, accion = 'sumar', cantidad = 1 } = req.body;

    if (!comercio_id || !qr_value) {
      return res.status(400).json({
        success: false,
        message: 'Parámetros obligatorios faltantes: comercio_id y qr_value son requeridos.'
      });
    }

    if (!['sumar', 'restar', 'canjear'].includes(accion)) {
      return res.status(400).json({
        success: false,
        message: 'Acción no válida. Use "sumar", "restar" o "canjear".'
      });
    }

    // Procesar la transacción
    const updatedCard = await supabaseService.processTransaction(
      comercio_id,
      qr_value,
      accion,
      parseInt(cantidad, 10)
    );

    // Retornar la tarjeta actualizada junto con los enlaces generados para que vuelva a agregarlo si desea.
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const applePassUrl = `${baseUrl}/api/pass/apple/${updatedCard.id}`;
    const googlePassUrl = `${baseUrl}/api/pass/google/${updatedCard.id}`;

    res.json({
      success: true,
      message: 'Transacción procesada correctamente.',
      data: {
        tarjeta: updatedCard,
        opciones_descarga: {
          appleWallet: applePassUrl,
          googleWallet: googlePassUrl
        }
      }
    });

  } catch (error) {
    // Interceptar mensajes de error controlados
    if (error.message.startsWith('STATUS_400:')) {
      return res.status(400).json({ success: false, message: error.message.split('STATUS_400: ')[1] });
    }
    if (error.message.startsWith('STATUS_404:')) {
      return res.status(404).json({ success: false, message: error.message.split('STATUS_404: ')[1] });
    }
    
    // Errores no controlados pasan al errorHandler global
    next(error);
  }
};

module.exports = {
  processScanRequest
};

const supabase = require('../config/supabase');
const appleWalletService = require('../services/appleWalletService');
const googleWalletService = require('../services/googleWalletService');

/**
 * Controller que gestiona la descarga HTTP del archivo de Apple Wallet (.pkpass)
 * GET /api/pass/apple/:tarjeta_id
 */
const getApplePass = async (req, res, next) => {
  try {
    const { tarjeta_id } = req.params;

    // 1. Obtener los datos completos desde la base de datos (con JOIN a comercio y cliente)
    const { data: tarjeta, error } = await supabase
      .from('tarjetas_activas')
      .select('*, comercios(*), clientes(*)')
      .eq('id', tarjeta_id)
      .single();

    if (error || !tarjeta) {
      return res.status(404).json({ error: 'Tarjeta no encontrada en el sistema' });
    }

    // 2. Generar el buffer local invocando PassKit
    const pkpassBuffer = await appleWalletService.generateApplePassBuffer(tarjeta);

    // 3. Descarga del archivo final
    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="${tarjeta.comercios.nombre_completo || 'fidelidad'}.pkpass"`
    });
    
    return res.send(pkpassBuffer);

  } catch (error) {
    next(error);
  }
};

/**
 * Controller que gestiona la redirección web a Google Wallet API
 * GET /api/pass/google/:tarjeta_id
 */
const getGooglePass = async (req, res, next) => {
  try {
    const { tarjeta_id } = req.params;

    const { data: tarjeta, error } = await supabase
      .from('tarjetas_activas')
      .select('*, comercios(*), clientes(*)')
      .eq('id', tarjeta_id)
      .single();

    if (error || !tarjeta) {
      return res.status(404).json({ error: 'Tarjeta no encontrada en el sistema' });
    }

    // A diferencia de Apple que envía un Buffer binario, Google utiliza una redirección web
    // con un JSON encriptado (JWT) apuntando al servidor universal 'pay.google.com'.
    const googlePayUrl = await googleWalletService.generateGooglePassUrl(tarjeta);

    // Redireccionamiento web HTTP directo hacia el popup del Wallet
    return res.redirect(googlePayUrl);
    
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getApplePass,
  getGooglePass
};

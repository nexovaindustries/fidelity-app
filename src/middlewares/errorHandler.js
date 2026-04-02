/**
 * Middleware para manejo global de errores en las rutas de Express
 */
const errorHandler = (err, req, res, next) => {
  console.error('[Error Handler]', err);

  const statusCode = err.status || 500;
  const message = err.message || 'Error interno del servidor';

  // Solo enviar el stack en desarrollo
  res.status(statusCode).json({
    error: message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
};

module.exports = errorHandler;

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const passController = require('../controllers/passController');
const scanController = require('../controllers/scanController');
const supabaseService = require('../services/supabaseService');

// Health Check
router.get('/', (req, res) => res.json({ message: 'API V1 - Fidelity App', version: '2.0.0' }));

// Registro de Usuario (Crear Cliente y Tarjeta)
router.post('/registro', authController.registerUser);

// Operaciones de Negocio (B2B)
router.post('/scan', scanController.processScanRequest);

// Motores Wallet
router.get('/pass/apple/:tarjeta_id', passController.getApplePass);
router.get('/pass/google/:tarjeta_id', passController.getGooglePass);

// ===== NEW: Dashboard Stats =====
router.get('/stats/:comercio_id', async (req, res, next) => {
  try {
    const stats = await supabaseService.getDashboardStats(req.params.comercio_id);
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

// ===== NEW: Customers List =====
router.get('/clientes/:comercio_id', async (req, res, next) => {
  try {
    const customers = await supabaseService.getCustomers(req.params.comercio_id);
    res.json({ success: true, data: customers });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

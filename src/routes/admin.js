const express = require('express');
const router = express.Router();
const adminAuth = require('../middlewares/adminAuth');
const adminController = require('../controllers/adminController');

// Todas las rutas requieren autenticación de admin
router.use(adminAuth);

router.get('/check', adminController.checkAdmin);
router.get('/stats', adminController.getGlobalStats);
router.get('/comercios', adminController.listComercios);
router.post('/comercios', adminController.createComercio);
router.put('/comercios/:id', adminController.updateComercio);
router.delete('/comercios/:id', adminController.deleteComercio);

module.exports = router;

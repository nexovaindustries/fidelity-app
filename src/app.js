const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// Rutas base
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Fidelity App Backend is running' });
});

app.use('/api', require('./routes/api'));

const errorHandler = require('./middlewares/errorHandler');

// Middlewares globales de error
app.use(errorHandler);

module.exports = app;

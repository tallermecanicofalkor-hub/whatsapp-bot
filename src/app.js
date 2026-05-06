const express = require('express');
const healthRoutes = require('./routes/health.routes');
const whatsappRoutes = require('./routes/whatsapp.routes');
const errorMiddleware = require('./middlewares/error.middleware');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use('/', healthRoutes);
app.use('/webhooks', whatsappRoutes);

app.use(errorMiddleware);

module.exports = app;

const app = require('./app');
const env = require('./config/env');

app.listen(env.port, () => {
  console.log(`[server] Escuchando en puerto ${env.port}`);
  console.log(`[server] Webhook WhatsApp: POST /webhooks/whatsapp`);
  console.log(`[server] Health: GET /health`);
});

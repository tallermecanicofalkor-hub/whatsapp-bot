const twilio = require('twilio');
const env = require('./env');

let client = null;

function getTwilioClient() {
  if (client) return client;
  if (!env.whatsapp.accountSid || !env.whatsapp.authToken) {
    console.warn('[whatsapp] Credenciales de Twilio no configuradas. Mensajes no se enviarán.');
    return null;
  }
  client = twilio(env.whatsapp.accountSid, env.whatsapp.authToken);
  return client;
}

module.exports = { getTwilioClient };

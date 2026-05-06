const env = require('../config/env');
const { getTwilioClient } = require('../config/whatsapp');

function normalizePhone(raw) {
  if (!raw) return raw;
  return raw.toString().replace(/^whatsapp:/, '');
}

async function sendMessage(toPhone, body) {
  if (!body) return null;

  if (env.whatsapp.provider === 'twilio') {
    const client = getTwilioClient();
    if (!client) {
      console.log(`[whatsapp:mock] -> ${toPhone}: ${body}`);
      return null;
    }
    const to = toPhone.startsWith('whatsapp:') ? toPhone : `whatsapp:${toPhone}`;
    return client.messages.create({
      from: env.whatsapp.fromNumber,
      to,
      body,
    });
  }

  throw new Error(`Provider no soportado: ${env.whatsapp.provider}`);
}

function parseIncoming(req) {
  // Twilio envía form-urlencoded: From, Body
  const from = normalizePhone(req.body.From || req.body.from);
  const text = (req.body.Body || req.body.body || '').toString();
  return { from, text };
}

module.exports = { sendMessage, parseIncoming, normalizePhone };

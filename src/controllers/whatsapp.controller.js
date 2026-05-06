const whatsappService = require('../services/whatsapp.service');
const conversationService = require('../services/conversation.service');

async function handleIncoming(req, res, next) {
  try {
    const { from, text } = whatsappService.parseIncoming(req);

    if (!from || !text) {
      return res.status(400).json({ error: 'Mensaje inválido' });
    }

    console.log(`[whatsapp] <- ${from}: ${text}`);

    const reply = await conversationService.processMessage(from, text);

    if (reply) {
      console.log(`[whatsapp] -> ${from}: ${reply}`);
      await whatsappService.sendMessage(from, reply);
    }

    // Responder con TwiML vacío para Twilio
    res.set('Content-Type', 'text/xml');
    return res.send('<Response></Response>');
  } catch (err) {
    next(err);
  }
}

module.exports = { handleIncoming };

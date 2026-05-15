require('dotenv').config();

const required = [
  'WHATSAPP_PROVIDER',
  'GOOGLE_CALENDAR_ID',
];

function validate() {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.warn(`[env] Faltan variables de entorno: ${missing.join(', ')}`);
  }
}

validate();

function parseGoogleCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      return { clientEmail: sa.client_email, privateKey: sa.private_key };
    } catch (e) {
      console.error('[env] GOOGLE_SERVICE_ACCOUNT_JSON inválido:', e.message);
    }
  }
  // fallback a variables individuales
  return {
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  };
}

const env = {
  port: parseInt(process.env.PORT || '3000', 10),

  whatsapp: {
    provider: process.env.WHATSAPP_PROVIDER || 'twilio',
    accountSid: process.env.WHATSAPP_ACCOUNT_SID,
    authToken: process.env.WHATSAPP_AUTH_TOKEN,
    fromNumber: process.env.WHATSAPP_FROM_NUMBER,
  },

  google: {
    ...parseGoogleCredentials(),
    calendarId: process.env.GOOGLE_CALENDAR_ID,
  },

  openai: {
    apiKey: process.env.OPENAI_KEY || process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  },

  schedule: {
    workStartHour: process.env.WORK_START_HOUR || '08:00',
    workEndHour: process.env.WORK_END_HOUR || '18:00',
    workDays: (process.env.WORK_DAYS || '1,2,3,4,5')
      .split(',')
      .map((d) => parseInt(d.trim(), 10)),
    timezone: process.env.TIMEZONE || 'America/Argentina/Buenos_Aires',
  },

  humanManagerPhone: process.env.HUMAN_MANAGER_PHONE || '3412606800',
};

module.exports = env;

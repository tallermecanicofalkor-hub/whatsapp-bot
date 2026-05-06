require('dotenv').config();

const required = [
  'WHATSAPP_PROVIDER',
  'GOOGLE_CLIENT_EMAIL',
  'GOOGLE_PRIVATE_KEY',
  'GOOGLE_CALENDAR_ID',
];

function validate() {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.warn(`[env] Faltan variables de entorno: ${missing.join(', ')}`);
  }
}

validate();

const env = {
  port: parseInt(process.env.PORT || '3000', 10),

  whatsapp: {
    provider: process.env.WHATSAPP_PROVIDER || 'twilio',
    accountSid: process.env.WHATSAPP_ACCOUNT_SID,
    authToken: process.env.WHATSAPP_AUTH_TOKEN,
    fromNumber: process.env.WHATSAPP_FROM_NUMBER,
  },

  google: {
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    calendarId: process.env.GOOGLE_CALENDAR_ID,
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

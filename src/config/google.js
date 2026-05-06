const { google } = require('googleapis');
const env = require('./env');

let calendarClient = null;

function getCalendarClient() {
  if (calendarClient) return calendarClient;

  const auth = new google.auth.JWT({
    email: env.google.clientEmail,
    key: env.google.privateKey,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  calendarClient = google.calendar({ version: 'v3', auth });
  return calendarClient;
}

module.exports = { getCalendarClient };

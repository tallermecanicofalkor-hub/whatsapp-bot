const { DateTime } = require('luxon');
const env = require('../config/env');

const TZ = env.schedule.timezone;

function now() {
  return DateTime.now().setZone(TZ);
}

function parseHour(hhmm) {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  return { hour: h, minute: m || 0 };
}

function isWorkDay(dt) {
  // Luxon weekday: 1=Mon..7=Sun
  return env.schedule.workDays.includes(dt.weekday);
}

function workDayBounds(dt) {
  const start = parseHour(env.schedule.workStartHour);
  const end = parseHour(env.schedule.workEndHour);
  return {
    start: dt.set({ ...start, second: 0, millisecond: 0 }),
    end: dt.set({ ...end, second: 0, millisecond: 0 }),
  };
}

function nextWorkDay(dt) {
  let d = dt.plus({ days: 1 }).startOf('day');
  while (!env.schedule.workDays.includes(d.weekday)) {
    d = d.plus({ days: 1 });
  }
  return d;
}

function formatHuman(dt) {
  return dt.setZone(TZ).setLocale('es').toFormat("cccc dd/LL 'a las' HH:mm");
}

module.exports = {
  DateTime,
  TZ,
  now,
  parseHour,
  isWorkDay,
  workDayBounds,
  nextWorkDay,
  formatHuman,
};

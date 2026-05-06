const { getCalendarClient } = require('../config/google');
const env = require('../config/env');
const {
  DateTime,
  TZ,
  now,
  isWorkDay,
  workDayBounds,
  nextWorkDay,
} = require('../utils/date.utils');

const CALENDAR_ID = env.google.calendarId;

async function getBusySlots(startISO, endISO) {
  const calendar = getCalendarClient();
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: startISO,
      timeMax: endISO,
      timeZone: TZ,
      items: [{ id: CALENDAR_ID }],
    },
  });
  const busy = res.data.calendars?.[CALENDAR_ID]?.busy || [];
  return busy.map((b) => ({
    start: DateTime.fromISO(b.start, { zone: TZ }),
    end: DateTime.fromISO(b.end, { zone: TZ }),
  }));
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

async function findAvailableSlots(durationHours, preferredDate, maxSuggestions = 3) {
  if (!durationHours) return [];

  let cursor = preferredDate
    ? DateTime.fromISO(preferredDate, { zone: TZ }).startOf('day')
    : now().startOf('day');

  if (cursor < now().startOf('day')) cursor = now().startOf('day');

  const horizonEnd = cursor.plus({ days: 21 });
  const busy = await getBusySlots(cursor.toISO(), horizonEnd.toISO());

  const slots = [];
  let day = cursor;

  while (slots.length < maxSuggestions && day < horizonEnd) {
    if (!isWorkDay(day)) {
      day = nextWorkDay(day);
      continue;
    }

    const { start: dayStart, end: dayEnd } = workDayBounds(day);

    let slotStart = dayStart;
    if (day.hasSame(now(), 'day') && now() > slotStart) {
      // redondear a la próxima hora
      slotStart = now().plus({ hours: 1 }).set({ minute: 0, second: 0, millisecond: 0 });
    }

    while (slotStart.plus({ hours: durationHours }) <= dayEnd) {
      const slotEnd = slotStart.plus({ hours: durationHours });

      const conflict = busy.some((b) => overlaps(slotStart, slotEnd, b.start, b.end));
      if (!conflict) {
        slots.push({ start: slotStart, end: slotEnd });
        if (slots.length >= maxSuggestions) break;
        // si pidió un día específico, ofrecer varios slots ese día
        slotStart = slotStart.plus({ hours: durationHours });
      } else {
        slotStart = slotStart.plus({ hours: 1 });
      }
    }

    day = nextWorkDay(day);
  }

  return slots;
}

async function validateSlotAvailability(startDateTime, durationHours) {
  const start = DateTime.fromISO(startDateTime, { zone: TZ });
  const end = start.plus({ hours: durationHours });
  const busy = await getBusySlots(start.toISO(), end.toISO());
  return !busy.some((b) => overlaps(start, end, b.start, b.end));
}

async function createAppointmentEvent(data) {
  const calendar = getCalendarClient();
  const start = DateTime.fromISO(data.startISO, { zone: TZ });
  const end = start.plus({ hours: data.durationHours });

  const summary = `Turno taller - ${data.name} - ${data.vehicle}`;
  const description = [
    `Cliente: ${data.name}`,
    `WhatsApp: ${data.phone}`,
    `Vehículo: ${data.vehicle}`,
    `Problema: ${data.problemDescription}`,
    `Duración estimada: ${data.durationHours} horas`,
    `Complejidad: ${data.complexity}`,
    `¿Se puede mover?: ${data.canMove ? 'Sí' : 'No'}`,
    `Creado: ${now().toISO()}`,
    '',
    'Conversación relevante:',
    ...(data.messages || []).slice(-10).map((m) => `- ${m.from}: ${m.text}`),
  ].join('\n');

  const res = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary,
      description,
      start: { dateTime: start.toISO(), timeZone: TZ },
      end: { dateTime: end.toISO(), timeZone: TZ },
    },
  });

  return res.data;
}

module.exports = {
  getBusySlots,
  findAvailableSlots,
  validateSlotAvailability,
  createAppointmentEvent,
};

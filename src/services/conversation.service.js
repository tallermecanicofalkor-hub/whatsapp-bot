const store = require('../data/conversation-store');
const { detectHumanHandoffIntent, buildHandoffMessage } = require('./handoff.service');
const {
  calculateAppointmentDuration,
  classificationQuestion,
  classifyByLevel,
} = require('./duration.service');
const calendarService = require('./calendar.service');
const appointmentService = require('./appointment.service');
const { parseVehicle, normalize } = require('../utils/text.utils');
const { formatHuman, DateTime, TZ, now } = require('../utils/date.utils');
const env = require('../config/env');

const STEPS = {
  START: 'START',
  ASK_NAME: 'ASK_NAME',
  ASK_VEHICLE: 'ASK_VEHICLE',
  ASK_PROBLEM: 'ASK_PROBLEM',
  ASK_CAN_MOVE: 'ASK_CAN_MOVE',
  ASK_COMPLEXITY: 'ASK_COMPLEXITY',
  ASK_PREFERRED_DATE: 'ASK_PREFERRED_DATE',
  OFFER_SLOTS: 'OFFER_SLOTS',
  CONFIRM_SLOT: 'CONFIRM_SLOT',
  COMPLETED: 'COMPLETED',
  HANDED_OFF_TO_HUMAN: 'HANDED_OFF_TO_HUMAN',
};

function isAffirmative(text) {
  const n = normalize(text);
  return ['si', 'sí', 'claro', 'dale', 'ok', 'okay', 'va', 'sip', 'obvio', 'puede', 'se puede'].some((w) => n.includes(w));
}

function isNegative(text) {
  const n = normalize(text);
  return ['no', 'nop', 'jamas', 'imposible', 'parado', 'no anda', 'no arranca', 'no se puede'].some((w) => n.includes(w));
}

function parsePreferredDate(text) {
  const n = normalize(text);
  const today = now();

  const dayMap = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7 };
  for (const [name, weekday] of Object.entries(dayMap)) {
    if (n.includes(name)) {
      let d = today.startOf('day');
      while (d.weekday !== weekday || d <= today.startOf('day')) {
        d = d.plus({ days: 1 });
      }
      return d.toISO();
    }
  }

  if (n.includes('mañana') || n.includes('manana')) {
    return today.plus({ days: 1 }).startOf('day').toISO();
  }
  if (n.includes('hoy')) {
    return today.startOf('day').toISO();
  }

  const dmy = text.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y ? (y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10)) : today.year;
    const dt = DateTime.fromObject({ year, month: parseInt(m, 10), day: parseInt(d, 10) }, { zone: TZ });
    if (dt.isValid) return dt.toISO();
  }

  return null;
}

async function processMessage(phone, text) {
  const conv = store.getOrCreate(phone);
  store.addMessage(phone, 'user', text);

  // Si ya derivado, no responder más
  if (conv.status === 'handed_off_to_human') {
    return null;
  }

  // Detectar intención de hablar con humano (siempre tiene prioridad)
  if (detectHumanHandoffIntent(text)) {
    store.update(phone, {
      status: 'handed_off_to_human',
      step: STEPS.HANDED_OFF_TO_HUMAN,
    });
    const reply = buildHandoffMessage(env.humanManagerPhone);
    store.addMessage(phone, 'bot', reply);
    return reply;
  }

  // Si la conversación está completa, ofrecer iniciar nuevo flujo
  if (conv.status === 'completed') {
    if (isAffirmative(text) || normalize(text).includes('turno') || normalize(text).includes('hola')) {
      store.reset(phone);
      const fresh = store.getOrCreate(phone);
      fresh.step = STEPS.ASK_NAME;
      const reply = 'Hola de nuevo. ¿A nombre de quién sería el nuevo turno?';
      store.addMessage(phone, 'bot', reply);
      return reply;
    }
    const reply = '¿Querés sacar otro turno? Respondé "sí" para empezar.';
    store.addMessage(phone, 'bot', reply);
    return reply;
  }

  let reply;

  switch (conv.step) {
    case STEPS.START: {
      conv.step = STEPS.ASK_NAME;
      reply = 'Hola, soy el asistente del taller. Te voy a ayudar a sacar un turno. ¿Cuál es tu nombre?';
      break;
    }

    case STEPS.ASK_NAME: {
      conv.data.name = text.trim().slice(0, 80);
      conv.step = STEPS.ASK_VEHICLE;
      reply = `Gracias ${conv.data.name}. ¿Qué vehículo tenés? Podés decirme marca, modelo y año.`;
      break;
    }

    case STEPS.ASK_VEHICLE: {
      const v = parseVehicle(text);
      conv.data.vehicleBrand = v.brand;
      conv.data.vehicleModel = v.model;
      conv.data.vehicleYear = v.year;
      conv.data.vehicle = text.trim();
      conv.step = STEPS.ASK_PROBLEM;
      reply = 'Perfecto. Contame brevemente qué problema tiene el vehículo o qué servicio necesitás.';
      break;
    }

    case STEPS.ASK_PROBLEM: {
      conv.data.problemDescription = text.trim();
      conv.step = STEPS.ASK_CAN_MOVE;
      reply = 'Entiendo. ¿El vehículo se puede mover?';
      break;
    }

    case STEPS.ASK_CAN_MOVE: {
      if (isNegative(text)) conv.data.canMove = false;
      else if (isAffirmative(text)) conv.data.canMove = true;
      else conv.data.canMove = true;

      const dur = calculateAppointmentDuration(conv.data.problemDescription, conv.data.canMove);
      if (dur.hours) {
        conv.data.durationHours = dur.hours;
        conv.data.complexity = dur.complexity;
        conv.step = STEPS.ASK_PREFERRED_DATE;
        reply = `Por el tipo de problema, te voy a reservar un turno ${describeDuration(dur)}. ¿Tenés preferencia de día?`;
      } else {
        conv.step = STEPS.ASK_COMPLEXITY;
        reply = classificationQuestion();
      }
      break;
    }

    case STEPS.ASK_COMPLEXITY: {
      const c = classifyByLevel(text);
      if (!c.hours) {
        reply = 'Disculpá, no entendí. ¿Lo dirías como simple, intermedio o complejo?';
        break;
      }
      conv.data.durationHours = c.hours;
      conv.data.complexity = c.complexity;
      conv.step = STEPS.ASK_PREFERRED_DATE;
      reply = `Anotado. Te reservo un turno ${describeDuration(c)}. ¿Tenés preferencia de día?`;
      break;
    }

    case STEPS.ASK_PREFERRED_DATE: {
      const n = normalize(text);
      const skip = ['no', 'cualquiera', 'cualquier', 'lo antes', 'no tengo', 'me da igual'].some((k) => n.includes(k));
      conv.data.preferredDate = skip ? null : parsePreferredDate(text);

      const slots = await calendarService.findAvailableSlots(
        conv.data.durationHours,
        conv.data.preferredDate,
        3,
      );

      if (!slots.length) {
        reply = 'No encontré horarios disponibles cercanos. ¿Querés probar con otra fecha?';
        break;
      }

      conv.data.offeredSlots = slots.map((s) => ({ startISO: s.start.toISO(), endISO: s.end.toISO() }));
      conv.step = STEPS.CONFIRM_SLOT;

      const lines = slots.map((s, i) => `${i + 1}. ${formatHuman(s.start)}`);
      reply = `Tengo estos horarios disponibles:\n${lines.join('\n')}\n\nRespondé con el número de la opción que preferís.`;
      break;
    }

    case STEPS.CONFIRM_SLOT: {
      const idx = parseInt(text.trim(), 10);
      if (!idx || idx < 1 || idx > conv.data.offeredSlots.length) {
        reply = 'No reconocí la opción. Respondé con el número (1, 2 o 3).';
        break;
      }
      const chosen = conv.data.offeredSlots[idx - 1];
      conv.data.selectedSlot = chosen;

      try {
        const event = await appointmentService.bookAppointment(conv);
        conv.status = 'completed';
        conv.step = STEPS.COMPLETED;

        const start = DateTime.fromISO(chosen.startISO, { zone: TZ });
        reply = `Listo ${conv.data.name}, tu turno quedó confirmado para el ${formatHuman(start)}. Duración estimada: ${conv.data.durationHours} horas. Vehículo: ${conv.data.vehicle}.`;
        if (event?.htmlLink) reply += `\nReferencia: ${event.htmlLink}`;
      } catch (err) {
        if (err.code === 'SLOT_TAKEN') {
          // refrescar slots
          const slots = await calendarService.findAvailableSlots(
            conv.data.durationHours,
            conv.data.preferredDate,
            3,
          );
          conv.data.offeredSlots = slots.map((s) => ({ startISO: s.start.toISO(), endISO: s.end.toISO() }));
          const lines = slots.map((s, i) => `${i + 1}. ${formatHuman(s.start)}`);
          reply = `Ese horario se acaba de ocupar. Probá con otra opción:\n${lines.join('\n')}`;
        } else {
          throw err;
        }
      }
      break;
    }

    default: {
      reply = '¿Querés que te ayude a sacar un turno? Respondé "sí" para comenzar.';
      conv.step = STEPS.START;
    }
  }

  store.addMessage(phone, 'bot', reply);
  store.update(phone, conv);
  return reply;
}

function describeDuration({ hours, complexity }) {
  const label = complexity === 'simple' ? 'corto' : complexity === 'medio' ? 'intermedio' : 'largo';
  return `${label} de ${hours} horas`;
}

module.exports = { processMessage, STEPS };

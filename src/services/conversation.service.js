const store = require('../data/conversation-store');
const { detectHumanHandoffIntent, buildHandoffMessage } = require('./handoff.service');
const {
  calculateAppointmentDuration,
  classificationQuestion,
  classifyByLevel,
} = require('./duration.service');
const calendarService = require('./calendar.service');
const appointmentService = require('./appointment.service');
const aiService = require('./openai.service');
const { parseVehicle, normalize } = require('../utils/text.utils');
const { formatHuman, DateTime, TZ, now } = require('../utils/date.utils');
const env = require('../config/env');

const STEPS = {
  START: 'START',
  ASK_CONSENT: 'ASK_CONSENT',
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

const WELCOME_MESSAGE = 'Hola, soy el asistente del taller. Te voy a ayudar a sacar tu turno. ¿Te parece?';
const DECLINED_MESSAGE = 'Está bien. Si querés sacar un turno más adelante, escribime "sí" o "turno".';
const ASK_DETAILS_MESSAGE = 'Perfecto. Contame tu nombre, qué le pasa al auto y si tenés preferencia de día u horario.';
const ASK_NAME_MESSAGE = 'Perfecto, anotado. ¿Me dirías tu nombre?';

function isAffirmative(text) {
  const n = normalize(text);
  const words = n.split(/\W+/).filter(Boolean);
  return ['si', 'claro', 'dale', 'ok', 'okay', 'va', 'sip', 'obvio'].some((w) => words.includes(w))
    || n.includes('se puede');
}

function isNegative(text) {
  const n = normalize(text);
  const words = n.split(/\W+/).filter(Boolean);
  return ['no', 'nop', 'jamas', 'imposible', 'parado'].some((w) => words.includes(w))
    || ['no anda', 'no arranca', 'no se puede'].some((w) => n.includes(w));
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

function cleanName(text) {
  const normalizedText = text
    .trim()
    .replace(/^(me llamo|mi nombre es|soy|nombre)\s*:?\s+/i, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80);

  return normalizedText
    .replace(/\b(ya te lo dije antes|te lo dije antes|ya te lo dije|es)\b\.?\s*/i, '')
    .replace(/[.,;:]+$/g, '')
    .trim();
}

async function analyzeIncoming(text, conv) {
  return aiService.analyzeMessage({
    text,
    step: conv.step,
    todayISO: now().toISODate(),
    timezone: TZ,
    offeredSlots: (conv.data.offeredSlots || []).map((slot, index) => ({
      number: index + 1,
      startISO: slot.startISO,
      label: formatHuman(DateTime.fromISO(slot.startISO, { zone: TZ })),
    })),
  });
}

function durationFromComplexity(complexity) {
  if (complexity === 'simple') return { hours: 2, complexity: 'simple' };
  if (complexity === 'medio') return { hours: 4, complexity: 'medio' };
  if (complexity === 'complejo') return { hours: 8, complexity: 'complejo' };
  return { hours: null, complexity: null };
}

function detectDurationFromDetails(text, ai) {
  if (ai.complexity) return durationFromComplexity(ai.complexity);

  const problemDescription = ai.problemDescription || text;
  if (!hasMeaningfulProblemDescription(problemDescription)) {
    return { hours: null, complexity: null, reason: 'missing_problem_description' };
  }

  const duration = calculateAppointmentDuration(problemDescription, null);
  if (duration.hours) return duration;

  return { hours: 4, complexity: 'medio', reason: 'default_unknown_problem' };
}

function hasMeaningfulProblemDescription(text = '') {
  const n = normalize(text);
  if (!n || n.length < 8) return false;
  return !['no se', 'nose', 'no sabria', 'no tengo idea'].includes(n);
}

function mergeConversationDetails(conv, text, ai) {
  if (ai.name) conv.data.name = cleanName(ai.name);

  const problemDescription = ai.problemDescription || text.trim();
  if (problemDescription) conv.data.problemDescription = problemDescription.slice(0, 500);

  if (ai.preferredDate) conv.data.preferredDate = ai.preferredDate;
  if (ai.timeOfDay) conv.data.preferredTimeOfDay = ai.timeOfDay;

  const duration = detectDurationFromDetails(problemDescription, ai);
  conv.data.durationHours = duration.hours;
  conv.data.complexity = duration.complexity;
}

async function offerSlots(conv, { preferredDate = null, timeOfDay = null } = {}) {
  conv.data.preferredDate = preferredDate;
  conv.data.preferredTimeOfDay = timeOfDay;

  const slots = await calendarService.findAvailableSlots(
    conv.data.durationHours,
    preferredDate,
    3,
    { timeOfDay },
  );

  if (!slots.length) return null;

  conv.data.offeredSlots = slots.map((s) => ({ startISO: s.start.toISO(), endISO: s.end.toISO() }));
  conv.step = STEPS.CONFIRM_SLOT;

  const lines = slots.map((s, i) => `${i + 1}. ${formatHuman(s.start)}`);
  return `Genial, tengo estos horarios disponibles:\n${lines.join('\n')}\n\nRespondé con el número de la opción que preferís. Si necesitás otro día u horario, decime cuál.`;
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
      fresh.step = STEPS.ASK_CONSENT;
      const reply = WELCOME_MESSAGE;
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
      conv.step = STEPS.ASK_CONSENT;
      reply = WELCOME_MESSAGE;
      break;
    }

    case STEPS.ASK_CONSENT: {
      const ai = await analyzeIncoming(text, conv);
      const denied = ai.consent === false || ai.intent === 'deny' || (isNegative(text) && !isAffirmative(text));
      if (denied) {
        conv.status = 'completed';
        conv.step = STEPS.COMPLETED;
        reply = DECLINED_MESSAGE;
        break;
      }

      conv.step = STEPS.ASK_COMPLEXITY;
      reply = ASK_DETAILS_MESSAGE;
      break;
    }

    case STEPS.ASK_NAME: {
      const ai = await analyzeIncoming(text, conv);
      const name = cleanName(ai.name || text);
      if (!name) {
        reply = 'No llegué a leer tu nombre. ¿Me lo repetís?';
        break;
      }

      conv.data.name = name;

      reply = await offerSlots(conv, {
        preferredDate: ai.preferredDate || conv.data.preferredDate,
        timeOfDay: ai.timeOfDay || conv.data.preferredTimeOfDay,
      });
      if (!reply) {
        reply = 'No encontré horarios disponibles cercanos. ¿Querés probar más tarde?';
      }
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
      const ai = await analyzeIncoming(text, conv);
      mergeConversationDetails(conv, text, ai);

      if (!conv.data.durationHours) {
        reply = 'No hay problema. Contame brevemente qué le pasa al auto o qué servicio necesitás, y yo calculo cuánto tiempo reservar.';
        break;
      }

      if (conv.data.name) {
        reply = await offerSlots(conv, {
          preferredDate: conv.data.preferredDate,
          timeOfDay: conv.data.preferredTimeOfDay,
        });
        if (!reply) {
          reply = 'No encontré horarios disponibles con esa preferencia. ¿Querés probar con otro día u horario?';
        }
      } else {
        conv.step = STEPS.ASK_NAME;
        reply = 'Perfecto, ya tengo el problema. ¿Me dirías tu nombre?';
      }
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
      const ai = await analyzeIncoming(text, conv);
      if (ai.intent === 'request_other_slots') {
        const preferredDate = ai.preferredDate || conv.data.preferredDate;
        const timeOfDay = ai.timeOfDay || conv.data.preferredTimeOfDay;

        if (!preferredDate && !timeOfDay) {
          reply = 'Dale. ¿Qué día u horario te quedaría mejor?';
          break;
        }

        reply = await offerSlots(conv, { preferredDate, timeOfDay });
        if (!reply) {
          reply = 'No encontré horarios libres para esa preferencia. ¿Querés decirme otro día u otra franja horaria?';
        }
        break;
      }

      const idx = ai.selectedSlotNumber || parseInt(text.trim(), 10);
      if (!idx || idx < 1 || idx > conv.data.offeredSlots.length) {
        reply = 'No reconocí la opción. Respondé con el número (1, 2 o 3), o decime otro día u horario que te sirva.';
        break;
      }
      const chosen = conv.data.offeredSlots[idx - 1];
      conv.data.selectedSlot = chosen;

      try {
        const event = await appointmentService.bookAppointment(conv);
        conv.status = 'completed';
        conv.step = STEPS.COMPLETED;

        const start = DateTime.fromISO(chosen.startISO, { zone: TZ });
        const reservationData = [
          `Nombre: ${conv.data.name}`,
          `Turno: ${formatHuman(start)}`,
          `Tipo: ${complexityLabel(conv.data.complexity)}`,
          `Duración estimada: ${conv.data.durationHours} horas`,
        ];

        reply = `Listo! Agendado.\n\nDatos de la reserva:\n${reservationData.join('\n')}\n\nMuchas gracias y lo esperamos!`;
        if (event?.htmlLink) reply += `\nLink: ${event.htmlLink}`;
      } catch (err) {
        if (err.code === 'SLOT_TAKEN') {
          // refrescar slots
          const slots = await calendarService.findAvailableSlots(
            conv.data.durationHours,
            conv.data.preferredDate,
            3,
            { timeOfDay: conv.data.preferredTimeOfDay },
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

function complexityLabel(complexity) {
  if (complexity === 'simple') return 'Revisión simple';
  if (complexity === 'medio') return 'Reparación intermedia';
  if (complexity === 'complejo') return 'Problema complejo';
  return 'No especificado';
}

module.exports = { processMessage, STEPS };

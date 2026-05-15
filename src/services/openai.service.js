const env = require('../config/env');
const { normalize } = require('../utils/text.utils');
const { DateTime, TZ, now } = require('../utils/date.utils');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

const DEFAULT_RESULT = {
  intent: 'unknown',
  consent: null,
  name: null,
  complexity: null,
  selectedSlotNumber: null,
  preferredDate: null,
  timeOfDay: null,
};

async function analyzeMessage({ text, step, todayISO, timezone, offeredSlots = [] }) {
  const fallback = fallbackAnalyze(text);
  if (!env.openai.apiKey) return fallback;

  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.openai.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.openai.model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: [
              'Sos un clasificador para un bot de WhatsApp de un taller mecanico en Argentina.',
              'Devolves solo JSON valido, sin markdown.',
              'Extrae intencion, nombre, complejidad del trabajo, seleccion de turno y preferencia de fecha/franja.',
              'Complejidad valida: simple, medio, complejo.',
              'timeOfDay valido: morning, afternoon, evening.',
              'preferredDate debe ser YYYY-MM-DD o null, usando la fecha actual como referencia.',
              'Si el usuario pide otro dia u horario, intent debe ser request_other_slots.',
              'Si el usuario elige una opcion ofrecida, intent debe ser select_slot y selectedSlotNumber debe ser 1, 2 o 3.',
            ].join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify({
              text,
              step,
              todayISO,
              timezone,
              offeredSlots,
              schema: DEFAULT_RESULT,
            }),
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'workshop_message_intent',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                intent: {
                  type: 'string',
                  enum: [
                    'unknown',
                    'affirm',
                    'deny',
                    'provide_details',
                    'provide_name',
                    'provide_complexity',
                    'select_slot',
                    'request_other_slots',
                    'handoff',
                  ],
                },
                consent: { type: ['boolean', 'null'] },
                name: { type: ['string', 'null'] },
                complexity: { type: ['string', 'null'], enum: ['simple', 'medio', 'complejo', null] },
                selectedSlotNumber: { type: ['number', 'null'], enum: [1, 2, 3, null] },
                preferredDate: {
                  type: ['string', 'null'],
                  description: 'Fecha en formato YYYY-MM-DD, o null si no hay fecha preferida.',
                },
                timeOfDay: { type: ['string', 'null'], enum: ['morning', 'afternoon', 'evening', null] },
              },
              required: [
                'intent',
                'consent',
                'name',
                'complexity',
                'selectedSlotNumber',
                'preferredDate',
                'timeOfDay',
              ],
            },
          },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI ${res.status}: ${body}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    return normalizeResult(JSON.parse(content), fallback);
  } catch (err) {
    console.warn('[openai] No se pudo interpretar mensaje, usando fallback:', err.message);
    return fallback;
  }
}

function normalizeResult(result, fallback = DEFAULT_RESULT) {
  return {
    intent: pick(result.intent, [
      'unknown',
      'affirm',
      'deny',
      'provide_details',
      'provide_name',
      'provide_complexity',
      'select_slot',
      'request_other_slots',
      'handoff',
    ], fallback.intent),
    consent: typeof result.consent === 'boolean' ? result.consent : fallback.consent,
    name: cleanString(result.name) || fallback.name,
    complexity: pick(result.complexity, ['simple', 'medio', 'complejo'], fallback.complexity),
    selectedSlotNumber: normalizeSlotNumber(result.selectedSlotNumber) || fallback.selectedSlotNumber,
    preferredDate: /^\d{4}-\d{2}-\d{2}$/.test(result.preferredDate || '') ? result.preferredDate : fallback.preferredDate,
    timeOfDay: pick(result.timeOfDay, ['morning', 'afternoon', 'evening'], fallback.timeOfDay),
  };
}

function fallbackAnalyze(text = '') {
  const n = normalize(text);
  const words = n.split(/\W+/).filter(Boolean);
  const selectedSlotNumber = normalizeSlotNumber(text.match(/\b[1-3]\b/)?.[0]);
  const preferredDate = parseFallbackDate(text);

  let complexity = null;
  if (n.includes('complejo') || n.includes('grave') || n.includes('grande')) complexity = 'complejo';
  else if (n.includes('intermed') || n.includes('medio') || n.includes('moderad')) complexity = 'medio';
  else if (n.includes('simple') || n.includes('revision') || n.includes('revisión') || n.includes('basic')) complexity = 'simple';

  let timeOfDay = null;
  if (n.includes('tarde')) timeOfDay = 'afternoon';
  else if (n.includes('noche') || n.includes('ultima hora') || n.includes('última hora')) timeOfDay = 'evening';
  else if (n.includes('por la manana') || n.includes('a la manana')) timeOfDay = 'morning';

  const asksOtherSlots = [
    'otro dia',
    'otro día',
    'otra fecha',
    'mas tarde',
    'más tarde',
    'a la tarde',
    'por la tarde',
    'a la manana',
    'a la mañana',
  ].some((p) => n.includes(normalize(p))) || Boolean(preferredDate || timeOfDay);

  const affirms = ['si', 'claro', 'dale', 'ok', 'okay', 'va', 'sip', 'obvio'].some((w) => words.includes(w));
  const denies = ['no', 'nop', 'jamas', 'jamás'].some((w) => words.includes(w));

  return {
    ...DEFAULT_RESULT,
    intent: selectedSlotNumber ? 'select_slot'
      : asksOtherSlots ? 'request_other_slots'
        : complexity ? 'provide_complexity'
          : affirms ? 'affirm'
            : denies ? 'deny'
              : 'unknown',
    consent: affirms ? true : denies ? false : null,
    complexity,
    selectedSlotNumber,
    preferredDate,
    timeOfDay,
  };
}

function parseFallbackDate(text) {
  const n = normalize(text);
  const today = now();
  const dayMap = {
    domingo: 7,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
  };

  for (const [name, weekday] of Object.entries(dayMap)) {
    if (!n.includes(name)) continue;
    let diff = (weekday - today.weekday + 7) % 7;
    if (diff === 0) diff = 7;
    return addDays(today, diff);
  }

  const tomorrow = n.includes('manana') && !n.includes('por la manana') && !n.includes('a la manana');
  if (tomorrow) return addDays(today, 1);

  const dmy = text.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (!dmy) return null;
  const [, d, m, y] = dmy;
  const year = y ? (y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10)) : today.year;
  const parsed = DateTime.fromObject({
    year,
    month: parseInt(m, 10),
    day: parseInt(d, 10),
  }, { zone: TZ });
  return parsed.isValid ? parsed.toISODate() : null;
}

function addDays(date, days) {
  return date.plus({ days }).toISODate();
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function cleanString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed || null;
}

function normalizeSlotNumber(value) {
  const parsed = parseInt(value, 10);
  return parsed >= 1 && parsed <= 3 ? parsed : null;
}

module.exports = { analyzeMessage };

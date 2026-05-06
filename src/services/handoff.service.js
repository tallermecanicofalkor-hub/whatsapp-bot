const { normalize } = require('../utils/text.utils');

const HANDOFF_PATTERNS = [
  'hablar con una persona',
  'hablar con alguien',
  'hablar con un humano',
  'hablar con humano',
  'atienda una persona',
  'me puede atender una persona',
  'quiero llamar',
  'pasame con alguien',
  'pasame con una persona',
  'atencion humana',
  'no quiero hablar con el bot',
  'no quiero bot',
  'persona real',
  'humano por favor',
  'encargado',
];

function detectHumanHandoffIntent(message) {
  if (!message) return false;
  const n = normalize(message);
  return HANDOFF_PATTERNS.some((p) => n.includes(normalize(p)));
}

function buildHandoffMessage(managerPhone) {
  return `Perfecto, te comparto el número del encargado para que puedas hablar directamente con una persona: ${managerPhone}.`;
}

module.exports = { detectHumanHandoffIntent, buildHandoffMessage };

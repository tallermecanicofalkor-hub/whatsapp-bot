const { normalize } = require('../utils/text.utils');

const RULES = {
  simple: {
    hours: 2,
    keywords: [
      'cambio de aceite', 'aceite', 'filtro', 'filtros', 'revision general',
      'revision', 'diagnostico simple', 'diagnostico', 'luces', 'luz',
      'bateria', 'escaneo', 'escanear', 'alineacion', 'balanceo',
    ],
  },
  medio: {
    hours: 4,
    keywords: [
      'frenos', 'freno', 'suspension', 'tren delantero', 'embrague simple',
      'service completo', 'aire acondicionado', 'aire', 'perdida de aceite',
      'problema electrico', 'problemas electricos', 'electrico moderado',
    ],
  },
  complejo: {
    hours: 8,
    keywords: [
      'motor', 'caja', 'embrague complejo', 'no arranca', 'no enciende',
      'problema grave', 'sobrecalentamiento', 'recalienta', 'distribucion',
      'reparacion grande', 'vehiculo parado', 'no se puede mover', 'no anda',
    ],
  },
};

function calculateAppointmentDuration(problemDescription, canMove) {
  const text = normalize(problemDescription || '');

  if (canMove === false) {
    return { hours: 8, complexity: 'complejo', reason: 'vehículo no se puede mover' };
  }

  const order = ['complejo', 'medio', 'simple'];
  for (const level of order) {
    const rule = RULES[level];
    if (rule.keywords.some((k) => text.includes(normalize(k)))) {
      return { hours: rule.hours, complexity: level, reason: 'keywords' };
    }
  }

  return { hours: null, complexity: null, reason: 'unknown' };
}

function classificationQuestion() {
  return 'Para darte un turno correcto, ¿dirías que es una revisión simple, una reparación intermedia o un problema complejo?';
}

function classifyByLevel(text) {
  const n = normalize(text);
  if (n.includes('complejo') || n.includes('grave') || n.includes('grande')) {
    return { hours: 8, complexity: 'complejo' };
  }
  if (n.includes('intermed') || n.includes('medio') || n.includes('moderad')) {
    return { hours: 4, complexity: 'medio' };
  }
  if (n.includes('simple') || n.includes('basic') || n.includes('chico')) {
    return { hours: 2, complexity: 'simple' };
  }
  return { hours: null, complexity: null };
}

module.exports = {
  calculateAppointmentDuration,
  classificationQuestion,
  classifyByLevel,
  RULES,
};

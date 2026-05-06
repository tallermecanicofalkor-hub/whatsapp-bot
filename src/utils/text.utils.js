function normalize(text = '') {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function containsAny(text, keywords) {
  const n = normalize(text);
  return keywords.some((k) => n.includes(normalize(k)));
}

function parseVehicle(text) {
  const tokens = text.trim().split(/\s+/);
  const yearMatch = text.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : null;
  const tokensWithoutYear = tokens.filter((t) => !/^\d+$/.test(t));
  const brand = tokensWithoutYear[0] || null;
  const model = tokensWithoutYear.slice(1).join(' ') || null;
  return { brand, model, year };
}

module.exports = { normalize, containsAny, parseVehicle };

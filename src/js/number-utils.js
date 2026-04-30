export function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function roundKm(value) {
  return Number(value.toFixed(3));
}

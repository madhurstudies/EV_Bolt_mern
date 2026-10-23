// One copy of the rules, imported by the server (models/routes) and by the browser forms.

export const CONNECTORS = {
  TYPE_1: 'Type 1 (J1772)',
  TYPE_2: 'Type 2 (Mennekes)',
  CCS1: 'CCS1',
  CCS2: 'CCS2',
  CHADEMO: 'CHAdeMO',
  GB_T: 'GB/T',
  BHARAT_AC_001: 'Bharat AC-001',
  BHARAT_DC_001: 'Bharat DC-001',
  TESLA: 'Tesla',
};
export const CONNECTOR_KEYS = Object.keys(CONNECTORS);

export const YEAR_MIN = 2010;
export const YEAR_MAX = 2030;

export function validateUsername(u) {
  if (!u) return 'Username is required.';
  if (!/^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(u))
    return 'Username must be 3-20 characters, start with a letter, and use only letters, numbers or underscores.';
  return '';
}

export function validatePassword(p) {
  if (!p || p.length < 8) return 'Password must be at least 8 characters long.';
  if (p.length > 72) return 'Password must be at most 72 characters long.';
  if (!/[0-9]/.test(p)) return 'Password must contain at least one number.';
  if (!/[^A-Za-z0-9]/.test(p)) return 'Password must contain at least one special character.';
  return '';
}

export function validateEmail(e) {
  if (!e) return ''; // optional
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? '' : 'Please enter a valid email address.';
}

export function validateName(n) {
  return n && String(n).trim() ? '' : 'Name is required.';
}

export function validateVehicle(v) {
  const errors = {};
  if (!v.make || !String(v.make).trim()) errors.make = 'Enter the make.';
  if (!v.model || !String(v.model).trim()) errors.model = 'Enter the model.';
  const year = Number(v.year);
  if (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX)
    errors.year = `Enter a year between ${YEAR_MIN} and ${YEAR_MAX}.`;
  if (!(Number(v.batteryCapacityKwh) > 0)) errors.batteryCapacityKwh = 'Enter a battery capacity above 0.';
  const p = v.maxChargingPowerKw;
  if (p !== undefined && p !== null && p !== '' && !(Number(p) > 0))
    errors.maxChargingPowerKw = 'Max charging power must be above 0.';
  const c = v.connectorTypes;
  if (!Array.isArray(c) || c.length === 0 || !c.every((x) => CONNECTOR_KEYS.includes(x)))
    errors.connectorTypes = 'Select at least one valid connector.';
  return errors;
}

// Shared validation for the callback form.
// The browser uses it for instant feedback; the server imports the same file and is the
// real gatekeeper. Never trust the client copy alone.

export const LIMITS = Object.freeze({
  name: { min: 2, max: 80 },
  phone: { min: 10, max: 20 },
  vehicle: { min: 2, max: 80 },
  problem: { min: 10, max: 1000 },
});

// C0/C1 controls (except tab/newline), zero-width and bidi-override characters.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}' .,-]*$/u;
const VEHICLE_RE = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} '.,&/()+-]*$/u;
const PHONE_CHARS_RE = /^\+?[0-9 ().-]+$/;
const LINK_RE = /(https?:\/\/|www\.|\[url|<a\s)/i;

/** Normalize and strip invisible/control characters. Multiline keeps single newlines. */
export function clean(value, { multiline = false } = {}) {
  if (typeof value !== 'string') return '';
  let v = value.normalize('NFKC').replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '');
  if (multiline) {
    v = v.replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  } else {
    v = v.replace(/\s+/g, ' ');
  }
  return v.trim();
}

/** Returns the 10-digit US number, or null if it isn't a valid NANP number. */
export function normalizePhone(value) {
  const raw = clean(value);
  if (!raw || raw.length > LIMITS.phone.max || !PHONE_CHARS_RE.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  // Area code and exchange can't start with 0 or 1.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return digits;
}

export function formatPhone(digits) {
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const MESSAGES = {
  nameMissing: 'Enter your name.',
  nameShort: `Enter at least ${LIMITS.name.min} characters.`,
  nameLong: `Keep your name under ${LIMITS.name.max} characters.`,
  nameChars: 'Use letters, spaces, hyphens or apostrophes only.',
  phoneMissing: 'Enter a phone number so we can call you back.',
  phoneInvalid: 'Enter a 10-digit US phone number, for example (718) 555-0123.',
  vehicleMissing: 'Enter the make and model, for example Toyota Camry.',
  vehicleShort: `Enter at least ${LIMITS.vehicle.min} characters.`,
  vehicleLong: `Keep this under ${LIMITS.vehicle.max} characters.`,
  vehicleChars: 'Use letters, numbers and basic punctuation only.',
  problemMissing: 'Tell us briefly what’s wrong with the car.',
  problemShort: `Add a little more detail (at least ${LIMITS.problem.min} characters).`,
  problemLong: `Keep the description under ${LIMITS.problem.max} characters.`,
  noLinks: 'Please remove links from this field.',
};

/**
 * Validate raw form input.
 * @returns {{ ok: boolean, values: {name:string, phone:string, vehicle:string, problem:string}, errors: Record<string,string> }}
 */
export function validateCallback(input = {}) {
  const errors = {};
  const name = clean(input.name);
  const vehicle = clean(input.vehicle);
  const problem = clean(input.problem, { multiline: true });
  const phoneRaw = clean(input.phone);

  if (!name) errors.name = MESSAGES.nameMissing;
  else if (name.length < LIMITS.name.min) errors.name = MESSAGES.nameShort;
  else if (name.length > LIMITS.name.max) errors.name = MESSAGES.nameLong;
  else if (LINK_RE.test(name)) errors.name = MESSAGES.noLinks;
  else if (!NAME_RE.test(name)) errors.name = MESSAGES.nameChars;

  let phone = '';
  if (!phoneRaw) errors.phone = MESSAGES.phoneMissing;
  else {
    const digits = normalizePhone(phoneRaw);
    if (!digits) errors.phone = MESSAGES.phoneInvalid;
    else phone = digits;
  }

  if (!vehicle) errors.vehicle = MESSAGES.vehicleMissing;
  else if (vehicle.length < LIMITS.vehicle.min) errors.vehicle = MESSAGES.vehicleShort;
  else if (vehicle.length > LIMITS.vehicle.max) errors.vehicle = MESSAGES.vehicleLong;
  else if (LINK_RE.test(vehicle)) errors.vehicle = MESSAGES.noLinks;
  else if (!VEHICLE_RE.test(vehicle)) errors.vehicle = MESSAGES.vehicleChars;

  if (!problem) errors.problem = MESSAGES.problemMissing;
  else if (problem.length < LIMITS.problem.min) errors.problem = MESSAGES.problemShort;
  else if (problem.length > LIMITS.problem.max) errors.problem = MESSAGES.problemLong;
  else if (LINK_RE.test(problem)) errors.problem = MESSAGES.noLinks;

  return {
    ok: Object.keys(errors).length === 0,
    values: { name, phone, vehicle, problem },
    errors,
  };
}

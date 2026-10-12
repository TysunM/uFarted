// Neutral age screen shared by the browser and the server (COPPA: accounts are 13+).
// We only ever ask for birth year (and month when the year alone can't tell) and never store either.
export const MIN_AGE = 13;

/**
 * Returns { ok } when the answer is enough to decide, or { needMonth: true } when someone could be
 * either 12 or 13 depending on their birthday. Birthdays in the current month count as not yet
 * reached, so we never let a 12-year-old through.
 */
export function checkAge(birthYear, birthMonth, now = new Date()) {
  const diff = now.getFullYear() - birthYear;
  if (diff > MIN_AGE) return { ok: true };
  if (diff < MIN_AGE) return { ok: false };
  if (!birthMonth) return { needMonth: true };
  return { ok: birthMonth < now.getMonth() + 1 };
}

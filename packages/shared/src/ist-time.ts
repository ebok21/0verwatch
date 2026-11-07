const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // +05:30 in milliseconds

function parseToDate(input?: Date | string | number | null): Date {
  if (!input) return new Date();
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? new Date() : input;
  }
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function getISTShiftedDate(input?: Date | string | number | null): Date {
  const date = parseToDate(input);
  return new Date(date.getTime() + IST_OFFSET_MS);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

/**
 * Returns an ISO-8601 timestamp string explicitly normalized to IST (+05:30),
 * e.g. "2026-11-07T10:35:12.345+05:30".
 * Never outputs "Z", "UTC", or "GMT".
 */
export function toISTIsoString(input?: Date | string | number | null): string {
  const ist = getISTShiftedDate(input);
  const year = ist.getUTCFullYear();
  const month = pad2(ist.getUTCMonth() + 1);
  const day = pad2(ist.getUTCDate());
  const hours = pad2(ist.getUTCHours());
  const minutes = pad2(ist.getUTCMinutes());
  const seconds = pad2(ist.getUTCSeconds());
  const ms = pad3(ist.getUTCMilliseconds());
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}+05:30`;
}

/**
 * Returns the calendar date in IST ("YYYY-MM-DD").
 */
export function getISTDateString(input?: Date | string | number | null): string {
  const ist = getISTShiftedDate(input);
  const year = ist.getUTCFullYear();
  const month = pad2(ist.getUTCMonth() + 1);
  const day = pad2(ist.getUTCDate());
  return `${year}-${month}-${day}`;
}

/**
 * Returns "YYYY-MM-DDTHH:mm" in IST for HTML <input type="datetime-local" /> controls.
 */
export function toISTDateTimeLocalInput(input?: Date | string | number | null): string {
  const ist = getISTShiftedDate(input);
  const year = ist.getUTCFullYear();
  const month = pad2(ist.getUTCMonth() + 1);
  const day = pad2(ist.getUTCDate());
  const hours = pad2(ist.getUTCHours());
  const minutes = pad2(ist.getUTCMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Formats any timestamp into a human-readable IST string without UTC or GMT,
 * e.g. "Sat, 07 Nov 2026, 07:30 AM IST".
 */
export function formatISTDisplay(input?: Date | string | number | null): string {
  const ist = getISTShiftedDate(input);
  const weekday = WEEKDAYS_SHORT[ist.getUTCDay()] ?? "";
  const day = pad2(ist.getUTCDate());
  const month = MONTHS_SHORT[ist.getUTCMonth()] ?? "";
  const year = ist.getUTCFullYear();
  const rawHours = ist.getUTCHours();
  const minutes = pad2(ist.getUTCMinutes());
  const ampm = rawHours >= 12 ? "PM" : "AM";
  const hours12 = pad2(rawHours % 12 || 12);

  return `${weekday}, ${day} ${month} ${year}, ${hours12}:${minutes} ${ampm} IST`;
}

/**
 * Formats only the clock time in IST, e.g. "10:35 AM IST".
 */
export function formatISTTimeOnly(input?: Date | string | number | null): string {
  const ist = getISTShiftedDate(input);
  const rawHours = ist.getUTCHours();
  const minutes = pad2(ist.getUTCMinutes());
  const ampm = rawHours >= 12 ? "PM" : "AM";
  const hours12 = pad2(rawHours % 12 || 12);
  return `${hours12}:${minutes} ${ampm} IST`;
}


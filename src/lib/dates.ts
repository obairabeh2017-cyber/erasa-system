// التواريخ: تُخزّن بتوقيت UTC، وتُحسب حدود الأيام والأشهر وتُعرض بتوقيت ليبيا.
export const TIME_ZONE = "Africa/Tripoli";

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function localParts(date: Date) {
  const p: Record<string, string> = {};
  for (const part of partsFmt.formatToParts(date)) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** فرق توقيت ليبيا عن UTC بالمللي ثانية في لحظة معيّنة. */
function offsetMs(date: Date): number {
  const p = localParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** لحظة UTC المقابلة لوقت محلي محدد في طرابلس. */
export function fromLocal(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const off = offsetMs(guess);
  return new Date(guess.getTime() - off);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateInput(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** "YYYY-MM-DD" → منتصف نهار ذلك اليوم بتوقيت طرابلس (يبقى ضمن اليوم نفسه دائماً). */
export function parseDateInput(s: string): Date {
  const m = DATE_RE.exec(s);
  if (!m || !isDateInput(s)) throw new Error("invalid date");
  return fromLocal(+m[1], +m[2], +m[3], 12, 0);
}

/** تاريخ اليوم المحلي بصيغة YYYY-MM-DD */
export function toDateInput(date: Date = new Date()): string {
  const p = localParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function todayInput(now: Date = new Date()): string {
  return toDateInput(now);
}

/** بداية اليوم المحلي (UTC) */
export function startOfLocalDay(date: Date = new Date()): Date {
  const p = localParts(date);
  return fromLocal(p.year, p.month, p.day);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

export function periodOf(date: Date = new Date()): string {
  const p = localParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

export function isPeriod(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** حدود شهر محلي: [start, end) */
export function monthRange(period: string): { start: Date; end: Date } {
  const [y, m] = period.split("-").map(Number);
  const start = fromLocal(y, m, 1);
  const end = m === 12 ? fromLocal(y + 1, 1, 1) : fromLocal(y, m + 1, 1);
  return { start, end };
}

/** حدود فترة بتواريخ إدخال شاملة: من بداية from إلى نهاية to */
export function dateRange(from: string, to: string): { start: Date; end: Date } {
  const f = DATE_RE.exec(from)!;
  const t = DATE_RE.exec(to)!;
  const start = fromLocal(+f[1], +f[2], +f[3]);
  // Date.UTC يعالج تجاوز اليوم (32 → أول الشهر التالي)
  const end = fromLocal(+t[1], +t[2], +t[3] + 1);
  return { start, end };
}

function localYMD(d: Date): [number, number, number] {
  const p = localParts(d);
  return [p.year, p.month, p.day];
}

export function previousPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export function daysInMonth(period: string): number {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** يوم محدد من شهر (مع قصّه لآخر يوم إن لزم) عند منتصف النهار المحلي */
export function dayOfPeriod(period: string, day: number): Date {
  const [y, m] = period.split("-").map(Number);
  const d = Math.min(Math.max(1, day), daysInMonth(period));
  return fromLocal(y, m, d, 12, 0);
}

/** عدد الأيام بين يومين محليين (b - a) */
export function diffLocalDays(a: Date, b: Date): number {
  const [ay, am, ad] = localYMD(a);
  const [by, bm, bd] = localYMD(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const AR_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

/** dd/mm/yyyy بتوقيت طرابلس */
export function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return dateFmt.format(date);
}

export function formatDateTime(date: Date | null | undefined): string {
  if (!date) return "—";
  return dateTimeFmt.format(date).replace(",", "");
}

export function formatPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${AR_MONTHS[m - 1]} ${y}`;
}

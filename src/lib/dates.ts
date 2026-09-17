// Utilidades de fecha. Las fechas se guardan como texto local "YYYY-MM-DD"
// y la hora como "HH:mm" para evitar desfases de zona horaria.

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function nowTime(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function toTimestamp(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISODate(s);
  return toISODate(d) === s && d.getFullYear() >= 1990;
}

export function isValidTime(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** 14/09/2026 */
export function fmtDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** 14 sep */
export function fmtDateShort(iso: string): string {
  const d = parseISODate(iso);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/** 14 de septiembre de 2026 */
export function fmtDateLong(iso: string, withYear = true): string {
  const d = parseISODate(iso);
  return `${d.getDate()} de ${MONTHS[d.getMonth()]}${withYear ? ` de ${d.getFullYear()}` : ''}`;
}

export function weekdayName(iso: string): string {
  return WEEKDAYS[parseISODate(iso).getDay()];
}

export function monthName(monthIndex: number): string {
  return MONTHS[monthIndex];
}

export function fmtMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Semana ISO: lunes como primer día. Devuelve "2026-W38". */
export function isoWeekKey(iso: string): string {
  const d = parseISODate(iso);
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return `${target.getFullYear()}-W${pad(week)}`;
}

/** Lunes y domingo de una semana ISO "2026-W38". */
export function weekRange(weekKey: string): { from: string; to: string } {
  const [y, w] = weekKey.split('-W').map(Number);
  const jan4 = new Date(y, 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (w - 1) * 7);
  const from = toISODate(monday);
  return { from, to: addDays(from, 6) };
}

export function monthRange(monthKey: string): { from: string; to: string } {
  const [y, m] = monthKey.split('-').map(Number);
  return { from: `${y}-${pad(m)}-01`, to: toISODate(new Date(y, m, 0)) };
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86400000);
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function hourOf(time: string): number {
  return Number(time.slice(0, 2));
}

export function partOfDay(time: string): 'madrugada' | 'mañana' | 'tarde' | 'noche' {
  const h = hourOf(time);
  if (h < 6) return 'madrugada';
  if (h < 12) return 'mañana';
  if (h < 18) return 'tarde';
  return 'noche';
}

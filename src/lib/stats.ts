import type { ClimateRecord } from '../db/types';
import { hourOf, isoWeekKey } from './dates';
import { isNum, VARIABLES, type NumericKey } from './variables';

export interface Summary {
  n: number;
  mean: number | null;
  sum: number | null;
  min: number | null;
  max: number | null;
  /** Amplitud = máximo − mínimo */
  range: number | null;
  std: number | null;
  minRecord?: ClimateRecord;
  maxRecord?: ClimateRecord;
}

const EMPTY: Summary = { n: 0, mean: null, sum: null, min: null, max: null, range: null, std: null };

export const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Promedio = suma de todos los valores / número de registros */
export function summarize(records: ClimateRecord[], key: NumericKey): Summary {
  let n = 0;
  let sum = 0;
  let sq = 0;
  let minRecord: ClimateRecord | undefined;
  let maxRecord: ClimateRecord | undefined;
  for (const r of records) {
    const v = r[key];
    if (!isNum(v)) continue;
    n++;
    sum += v;
    sq += v * v;
    if (!minRecord || v < (minRecord[key] as number)) minRecord = r;
    if (!maxRecord || v > (maxRecord[key] as number)) maxRecord = r;
  }
  if (n === 0) return EMPTY;
  const mean = sum / n;
  const variance = n > 1 ? (sq - n * mean * mean) / (n - 1) : 0;
  const min = minRecord![key] as number;
  const max = maxRecord![key] as number;
  return { n, mean, sum, min, max, range: max - min, std: Math.sqrt(Math.max(variance, 0)), minRecord, maxRecord };
}

export function sortByTs(records: ClimateRecord[]): ClimateRecord[] {
  return [...records].sort((a, b) => a.ts - b.ts);
}

export function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = keyFn(it);
    const arr = map.get(k);
    if (arr) arr.push(it);
    else map.set(k, [it]);
  }
  return map;
}

export interface Change {
  from: ClimateRecord;
  to: ClimateRecord;
  delta: number;
  hours: number;
  /** cambio por hora */
  rate: number;
}

/** Variación entre registros consecutivos (dentro del mismo día si sameDay). */
export function consecutiveChanges(records: ClimateRecord[], key: NumericKey, sameDay = true): Change[] {
  const sorted = sortByTs(records).filter((r) => isNum(r[key]));
  const out: Change[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (sameDay && a.date !== b.date) continue;
    const hours = (b.ts - a.ts) / 3600000;
    const delta = (b[key] as number) - (a[key] as number);
    out.push({ from: a, to: b, delta, hours, rate: hours > 0 ? delta / hours : delta });
  }
  return out;
}

export interface PeriodSummary {
  key: string; // fecha, semana o mes
  records: ClimateRecord[];
  n: number;
  stats: Record<NumericKey, Summary>;
}

function buildPeriods(records: ClimateRecord[], keyFn: (r: ClimateRecord) => string): PeriodSummary[] {
  const groups = groupBy(sortByTs(records), keyFn);
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, recs]) => ({
      key,
      records: recs,
      n: recs.length,
      stats: Object.fromEntries(
        (Object.keys(VARIABLES) as NumericKey[]).map((k) => [k, summarize(recs, k)]),
      ) as Record<NumericKey, Summary>,
    }));
}

export const dailySummaries = (records: ClimateRecord[]) => buildPeriods(records, (r) => r.date);
export const weeklySummaries = (records: ClimateRecord[]) => buildPeriods(records, (r) => isoWeekKey(r.date));
export const monthlySummaries = (records: ClimateRecord[]) => buildPeriods(records, (r) => r.date.slice(0, 7));

/** Promedio por hora del día (0–23) para una variable. */
export function hourlyMeans(records: ClimateRecord[], key: NumericKey): (number | null)[] {
  const sums = Array(24).fill(0);
  const counts = Array(24).fill(0);
  for (const r of records) {
    const v = r[key];
    if (!isNum(v)) continue;
    const h = hourOf(r.time);
    sums[h] += v;
    counts[h]++;
  }
  return sums.map((s, i) => (counts[i] ? s / counts[i] : null));
}

export function recordsPerHour(records: ClimateRecord[]): number[] {
  const counts = Array(24).fill(0);
  for (const r of records) counts[hourOf(r.time)]++;
  return counts;
}

/** Coeficiente de correlación de Pearson y recta de regresión y = a + b·x */
export function correlation(records: ClimateRecord[], xKey: NumericKey, yKey: NumericKey) {
  const pts = records.filter((r) => isNum(r[xKey]) && isNum(r[yKey])).map((r) => [r[xKey] as number, r[yKey] as number]);
  const n = pts.length;
  if (n < 3) return { n, r: null, slope: null, intercept: null, points: pts };
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pts) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return { n, r: null, slope: null, intercept: null, points: pts };
  const slope = sxy / sxx;
  return { n, r: sxy / Math.sqrt(sxx * syy), slope, intercept: my - slope * mx, points: pts };
}

export function describeCorrelation(r: number): string {
  const a = Math.abs(r);
  const strength = a >= 0.8 ? 'muy fuerte' : a >= 0.6 ? 'fuerte' : a >= 0.4 ? 'moderada' : a >= 0.2 ? 'débil' : 'muy débil o nula';
  const dir = r > 0 ? 'positiva' : 'negativa';
  return a < 0.2 ? 'correlación muy débil o nula' : `correlación ${strength} ${dir}`;
}

/** Histograma simple con ancho de clase fijo. */
export function histogram(values: number[], binWidth: number) {
  if (values.length === 0) return [];
  const min = Math.floor(Math.min(...values) / binWidth) * binWidth;
  const max = Math.max(...values);
  const bins: { from: number; to: number; count: number }[] = [];
  for (let b = min; b <= max; b += binWidth) bins.push({ from: b, to: b + binWidth, count: 0 });
  for (const v of values) {
    const i = Math.min(Math.floor((v - min) / binWidth), bins.length - 1);
    bins[i].count++;
  }
  return bins;
}

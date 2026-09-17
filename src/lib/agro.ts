import type { ClimateRecord, ClimateThreshold, Crop, RecordSource } from '../db/types';
import { thresholdFor } from './alerts';
import { daysBetween, eachDay, fmtDate, hourOf } from './dates';
import { consecutiveChanges, dailySummaries, groupBy, sortByTs, summarize, type Change } from './stats';

// Indicadores de interés agronómico para el tomate bajo invernadero.
// Las "horas" se ESTIMAN: cada lectura representa el intervalo hasta la siguiente,
// con un tope de 1,5 × el intervalo típico, para no extender una lectura sobre vacíos de datos.

export const MIN_RECORDS = 12;

export interface TimedRecord {
  r: ClimateRecord;
  hours: number;
}

export function timeWeights(records: ClimateRecord[]) {
  const sorted = sortByTs(records);
  const diffs: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const d = (sorted[i].ts - sorted[i - 1].ts) / 60000;
    if (d > 0) diffs.push(d);
  }
  diffs.sort((a, b) => a - b);
  const medianMin = diffs.length ? diffs[Math.floor(diffs.length / 2)] : null;
  const capH = medianMin ? Math.max(medianMin * 1.5, 5) / 60 : 0;
  const items: TimedRecord[] = sorted.map((r, i) => {
    if (!medianMin) return { r, hours: 0 };
    const next = sorted[i + 1];
    const gapH = next ? (next.ts - r.ts) / 3600000 : medianMin / 60;
    return { r, hours: Math.min(gapH, capH) };
  });
  return { items, medianMin, capH };
}

export interface Run {
  start: ClimateRecord;
  end: ClimateRecord;
  hours: number;
  peak: number;
  count: number;
}

/** Periodos continuos que cumplen una condición (se cortan ante vacíos de datos). */
export function runs(items: TimedRecord[], capH: number, test: (r: ClimateRecord) => boolean, peakOf: (r: ClimateRecord) => number, pickMax = true): Run[] {
  const out: Run[] = [];
  let cur: Run | null = null;
  let prev: ClimateRecord | null = null;
  for (const { r, hours } of items) {
    const contiguous = prev && (r.ts - prev.ts) / 3600000 <= capH + 1e-9;
    if (test(r)) {
      if (cur && contiguous) {
        cur.end = r;
        cur.hours += hours;
        cur.count++;
        cur.peak = pickMax ? Math.max(cur.peak, peakOf(r)) : Math.min(cur.peak, peakOf(r));
      } else {
        if (cur) out.push(cur);
        cur = { start: r, end: r, hours, peak: peakOf(r), count: 1 };
      }
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
    prev = r;
  }
  if (cur) out.push(cur);
  return out.sort((a, b) => b.hours - a.hours);
}

export interface HourProfile {
  hour: number;
  n: number;
  meanT: number | null;
  meanH: number | null;
  pctHot: number;
  pctCold: number;
  pctHumid: number;
  pctDry: number;
}

export interface AgroIndicators {
  n: number;
  sufficient: boolean;
  reason: string | null;
  medianIntervalMin: number | null;
  coveredHours: number;
  hoursTempHigh: number;
  hoursTempLow: number;
  hoursTempInRange: number;
  hoursHumHigh: number;
  hoursHumLow: number;
  hoursHumInRange: number;
  hoursBothInRange: number;
  countTempHigh: number;
  countTempLow: number;
  countTempInRange: number;
  countHumHigh: number;
  countHumLow: number;
  countHumInRange: number;
  hotRuns: Run[];
  coldRuns: Run[];
  humidRuns: Run[];
  dryRuns: Run[];
  maxAmplitudeDay: { date: string; range: number; max: number; min: number } | null;
  maxChange: Change | null;
  hourProfile: HourProfile[];
  mostHumidHours: HourProfile[];
  hottestHours: HourProfile[];
}

export function agroIndicators(records: ClimateRecord[], thresholds: ClimateThreshold[]): AgroIndicators {
  const { items, medianMin, capH } = timeWeights(records);
  const th = (r: ClimateRecord) => thresholdFor(r, thresholds);
  const hot = (r: ClimateRecord) => { const t = th(r); return !!t && r.airTemp > t.tempMax; };
  const cold = (r: ClimateRecord) => { const t = th(r); return !!t && r.airTemp < t.tempMin; };
  const humid = (r: ClimateRecord) => { const t = th(r); return !!t && r.relHumidity > t.humidityMax; };
  const dry = (r: ClimateRecord) => { const t = th(r); return !!t && r.relHumidity < t.humidityMin; };

  let coveredHours = 0;
  const acc = { th: 0, tl: 0, ti: 0, hh: 0, hl: 0, hi: 0, both: 0, cth: 0, ctl: 0, cti: 0, chh: 0, chl: 0, chi: 0 };
  for (const { r, hours } of items) {
    coveredHours += hours;
    const [isHot, isCold, isHumid, isDry] = [hot(r), cold(r), humid(r), dry(r)];
    if (isHot) { acc.th += hours; acc.cth++; } else if (isCold) { acc.tl += hours; acc.ctl++; } else { acc.ti += hours; acc.cti++; }
    if (isHumid) { acc.hh += hours; acc.chh++; } else if (isDry) { acc.hl += hours; acc.chl++; } else { acc.hi += hours; acc.chi++; }
    if (!isHot && !isCold && !isHumid && !isDry) acc.both += hours;
  }

  const days = dailySummaries(records).filter((d) => d.stats.airTemp.n >= 2);
  const widest = days.length ? days.reduce((a, b) => (b.stats.airTemp.range! > a.stats.airTemp.range! ? b : a)) : null;
  const changes = consecutiveChanges(records, 'airTemp').filter((c) => c.hours <= Math.max(capH, 1));
  const maxChange = changes.length ? changes.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a)) : null;

  const byHour = groupBy(records, (r) => String(hourOf(r.time)));
  const hourProfile: HourProfile[] = Array.from({ length: 24 }, (_, h) => {
    const recs = byHour.get(String(h)) ?? [];
    const n = recs.length;
    const pct = (f: (r: ClimateRecord) => boolean) => (n ? (recs.filter(f).length / n) * 100 : 0);
    return { hour: h, n, meanT: summarize(recs, 'airTemp').mean, meanH: summarize(recs, 'relHumidity').mean, pctHot: pct(hot), pctCold: pct(cold), pctHumid: pct(humid), pctDry: pct(dry) };
  });
  const withData = hourProfile.filter((p) => p.n > 0);

  let reason: string | null = null;
  if (records.length === 0) reason = 'No existen registros en el periodo seleccionado.';
  else if (records.length < MIN_RECORDS) reason = `Solo hay ${records.length} registros; se necesitan al menos ${MIN_RECORDS} para estimar horas y periodos.`;
  else if (medianMin !== null && medianMin > 180) reason = `El intervalo típico entre mediciones es de ${Math.round(medianMin / 60)} h; las horas estimadas son poco precisas.`;

  return {
    n: records.length,
    sufficient: reason === null,
    reason,
    medianIntervalMin: medianMin,
    coveredHours,
    hoursTempHigh: acc.th,
    hoursTempLow: acc.tl,
    hoursTempInRange: acc.ti,
    hoursHumHigh: acc.hh,
    hoursHumLow: acc.hl,
    hoursHumInRange: acc.hi,
    hoursBothInRange: acc.both,
    countTempHigh: acc.cth,
    countTempLow: acc.ctl,
    countTempInRange: acc.cti,
    countHumHigh: acc.chh,
    countHumLow: acc.chl,
    countHumInRange: acc.chi,
    hotRuns: runs(items, capH, hot, (r) => r.airTemp),
    coldRuns: runs(items, capH, cold, (r) => r.airTemp, false),
    humidRuns: runs(items, capH, humid, (r) => r.relHumidity),
    dryRuns: runs(items, capH, dry, (r) => r.relHumidity, false),
    maxAmplitudeDay: widest ? { date: widest.key, range: widest.stats.airTemp.range!, max: widest.stats.airTemp.max!, min: widest.stats.airTemp.min! } : null,
    maxChange,
    hourProfile,
    hottestHours: [...withData].filter((p) => p.pctHot > 0).sort((a, b) => b.pctHot - a.pctHot || (b.meanT ?? 0) - (a.meanT ?? 0)).slice(0, 3),
    mostHumidHours: [...withData].filter((p) => p.pctHumid > 0).sort((a, b) => b.pctHumid - a.pctHumid || (b.meanH ?? 0) - (a.meanH ?? 0)).slice(0, 3),
  };
}

export function runLabel(run: Run): string {
  const sameDay = run.start.date === run.end.date;
  return sameDay
    ? `${fmtDate(run.start.date)} de ${run.start.time} a ${run.end.time}`
    : `del ${fmtDate(run.start.date)} ${run.start.time} al ${fmtDate(run.end.date)} ${run.end.time}`;
}

export const hourRange = (h: number) => `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`;

// ---------- Comparaciones ----------

export type DayPart = 'Madrugada (00–06 h)' | 'Mañana (06–12 h)' | 'Tarde (12–18 h)' | 'Noche (18–24 h)';
export const DAY_PARTS: DayPart[] = ['Madrugada (00–06 h)', 'Mañana (06–12 h)', 'Tarde (12–18 h)', 'Noche (18–24 h)'];

export function dayPartOf(time: string): DayPart {
  const h = hourOf(time);
  return DAY_PARTS[Math.floor(h / 6)];
}

export interface GroupStats {
  key: string;
  n: number;
  days: number;
  meanT: number | null;
  maxT: number | null;
  minT: number | null;
  meanH: number | null;
  maxH: number | null;
  minH: number | null;
  pctTempInRange: number | null;
  pctHumInRange: number | null;
  hoursHot: number;
  hoursHumid: number;
}

function groupStats(key: string, recs: ClimateRecord[], thresholds: ClimateThreshold[]): GroupStats {
  const t = summarize(recs, 'airTemp');
  const h = summarize(recs, 'relHumidity');
  const ind = recs.length ? agroIndicators(recs, thresholds) : null;
  return {
    key,
    n: recs.length,
    days: new Set(recs.map((r) => r.date)).size,
    meanT: t.mean, maxT: t.max, minT: t.min, meanH: h.mean, maxH: h.max, minH: h.min,
    pctTempInRange: ind && recs.length ? (ind.countTempInRange / recs.length) * 100 : null,
    pctHumInRange: ind && recs.length ? (ind.countHumInRange / recs.length) * 100 : null,
    hoursHot: ind?.hoursTempHigh ?? 0,
    hoursHumid: ind?.hoursHumHigh ?? 0,
  };
}

export function compareDayParts(records: ClimateRecord[], thresholds: ClimateThreshold[]): GroupStats[] {
  const g = groupBy(records, (r) => dayPartOf(r.time));
  return DAY_PARTS.map((p) => groupStats(p, g.get(p) ?? [], thresholds));
}

export function compareStages(records: ClimateRecord[], thresholds: ClimateThreshold[], order: readonly string[]): GroupStats[] {
  const g = groupBy(records, (r) => r.phenologicalStage || 'Sin etapa registrada');
  const keys = [...g.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return keys.map((k) => groupStats(k, g.get(k)!, thresholds));
}

export function compareRanges(records: ClimateRecord[], thresholds: ClimateThreshold[], ranges: { label: string; from: string; to: string }[]): GroupStats[] {
  return ranges.map((rg) => groupStats(rg.label, records.filter((r) => r.date >= rg.from && r.date <= rg.to), thresholds));
}

/** Etapa fenológica de un cultivo para una fecha, según su cronología de etapas. */
export function stageForDate(crop: Crop | undefined, date: string): string {
  if (!crop) return '';
  const hist = [...(crop.stageHistory ?? [])].filter((s) => s.from).sort((a, b) => (a.from < b.from ? -1 : 1));
  let stage = '';
  for (const s of hist) if (s.from <= date) stage = s.stage;
  return stage || (hist.length ? '' : crop.stage);
}

// ---------- Calidad de datos ----------

export interface DataQuality {
  total: number;
  bySource: Partial<Record<RecordSource, number>>;
  byValidation: { valido: number; sospechoso: number; descartado: number };
  sensors: string[];
  daysWithData: number;
  totalDays: number;
  coveragePct: number;
  medianIntervalMin: number | null;
  gaps: { from: ClimateRecord; to: ClimateRecord; hours: number }[];
  missingDays: string[];
}

/** Calidad y procedencia de los datos. Recibe TODOS los registros del periodo (incluidos descartados). */
export function dataQuality(all: ClimateRecord[], from: string, to: string, gapHours: number): DataQuality {
  const bySource: Partial<Record<RecordSource, number>> = {};
  const byValidation = { valido: 0, sospechoso: 0, descartado: 0 };
  const sensors = new Set<string>();
  for (const r of all) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    byValidation[r.validation ?? 'valido']++;
    if (r.sensorId) sensors.add(r.sensorId);
  }
  const usable = sortByTs(all.filter((r) => r.validation !== 'descartado'));
  const dates = new Set(usable.map((r) => r.date));
  const lastDay = to;
  const totalDays = Math.max(1, daysBetween(from, lastDay) + 1);
  const gaps: DataQuality['gaps'] = [];
  for (let i = 1; i < usable.length; i++) {
    const h = (usable[i].ts - usable[i - 1].ts) / 3600000;
    if (h > gapHours) gaps.push({ from: usable[i - 1], to: usable[i], hours: h });
  }
  return {
    total: all.length,
    bySource,
    byValidation,
    sensors: [...sensors],
    daysWithData: dates.size,
    totalDays,
    coveragePct: (dates.size / totalDays) * 100,
    medianIntervalMin: timeWeights(usable).medianMin,
    gaps: gaps.sort((a, b) => b.hours - a.hours),
    missingDays: totalDays <= 400 ? eachDay(from, lastDay).filter((d) => !dates.has(d)) : [],
  };
}

import type { AppSettings, ClimateRecord, ClimateThreshold } from '../db/types';
import { fmtDate } from './dates';
import { consecutiveChanges, sortByTs } from './stats';
import { fmt, isNum } from './variables';

export type AlertLevel = 'info' | 'warning' | 'danger';
export type AlertKind = 'temp-high' | 'temp-low' | 'hum-high' | 'hum-low' | 'soil' | 'abrupt' | 'gap';

export interface ClimateAlert {
  id: string;
  level: AlertLevel;
  kind: AlertKind;
  title: string;
  detail: string;
  date: string;
  time?: string;
  ts: number;
  recordId?: number;
}

// Un valor que supera el rango en más de este margen se considera extremo (rojo).
const EXTREME_MARGIN = { temp: 3, hum: 10 };

/**
 * Rango de referencia aplicable a un registro, del más específico al más general:
 * 1) cultivo + etapa · 2) referencia del tomate para la etapa · 3) cultivo · 4) referencia general.
 */
export function thresholdFor(
  record: { cropId?: number | null; phenologicalStage?: string | null },
  thresholds: ClimateThreshold[],
): ClimateThreshold | undefined {
  const stage = record.phenologicalStage || null;
  const crop = record.cropId ?? null;
  return (
    (crop !== null && stage && thresholds.find((t) => t.cropId === crop && t.stage === stage)) ||
    (stage && thresholds.find((t) => t.cropId === null && t.stage === stage)) ||
    (crop !== null && thresholds.find((t) => t.cropId === crop && !t.stage)) ||
    thresholds.find((t) => t.cropId === null && !t.stage)
  );
}

/** Alertas de un registro respecto a los rangos configurados. Solo informativas. */
export function recordAlerts(r: ClimateRecord, t: ClimateThreshold | undefined): ClimateAlert[] {
  if (!t) return [];
  const out: ClimateAlert[] = [];
  const base = { date: r.date, time: r.time, ts: r.ts, recordId: r.id };
  const when = `${fmtDate(r.date)} ${r.time}`;
  const push = (kind: AlertKind, level: AlertLevel, title: string, detail: string) =>
    out.push({ id: `${kind}-${r.id}-${r.ts}`, kind, level, title, detail, ...base });

  if (r.airTemp > t.tempMax)
    push('temp-high', r.airTemp - t.tempMax >= EXTREME_MARGIN.temp ? 'danger' : 'warning', 'Temperatura superior al rango configurado.',
      `${when}: ${fmt(r.airTemp)} °C (máximo permitido ${fmt(t.tempMax)} °C).`);
  if (r.airTemp < t.tempMin)
    push('temp-low', t.tempMin - r.airTemp >= EXTREME_MARGIN.temp ? 'danger' : 'warning', 'Temperatura inferior al rango configurado.',
      `${when}: ${fmt(r.airTemp)} °C (mínimo permitido ${fmt(t.tempMin)} °C).`);
  if (r.relHumidity > t.humidityMax)
    push('hum-high', r.relHumidity - t.humidityMax >= EXTREME_MARGIN.hum ? 'danger' : 'warning', 'Humedad relativa muy elevada.',
      `${when}: ${fmt(r.relHumidity, 0)} % (máximo configurado ${fmt(t.humidityMax, 0)} %).`);
  if (r.relHumidity < t.humidityMin)
    push('hum-low', t.humidityMin - r.relHumidity >= EXTREME_MARGIN.hum ? 'danger' : 'warning', 'Humedad relativa muy baja.',
      `${when}: ${fmt(r.relHumidity, 0)} % (mínimo configurado ${fmt(t.humidityMin, 0)} %).`);
  if (isNum(r.soilTemp) && isNum(t.soilTempMax) && r.soilTemp > t.soilTempMax)
    push('soil', 'warning', 'Temperatura del suelo superior al rango.', `${when}: ${fmt(r.soilTemp)} °C (máx. ${fmt(t.soilTempMax)} °C).`);
  if (isNum(r.soilTemp) && isNum(t.soilTempMin) && r.soilTemp < t.soilTempMin)
    push('soil', 'warning', 'Temperatura del suelo inferior al rango.', `${when}: ${fmt(r.soilTemp)} °C (mín. ${fmt(t.soilTempMin)} °C).`);
  if (isNum(r.soilMoisture) && isNum(t.soilMoistureMax) && r.soilMoisture > t.soilMoistureMax)
    push('soil', 'warning', 'Humedad del suelo superior al rango.', `${when}: ${fmt(r.soilMoisture, 0)} % (máx. ${fmt(t.soilMoistureMax, 0)} %).`);
  if (isNum(r.soilMoisture) && isNum(t.soilMoistureMin) && r.soilMoisture < t.soilMoistureMin)
    push('soil', 'warning', 'Humedad del suelo inferior al rango.', `${when}: ${fmt(r.soilMoisture, 0)} % (mín. ${fmt(t.soilMoistureMin, 0)} %).`);
  return out;
}

export function abruptChangeAlerts(records: ClimateRecord[], settings: AppSettings): ClimateAlert[] {
  const out: ClimateAlert[] = [];
  for (const c of consecutiveChanges(records, 'airTemp')) {
    if (Math.abs(c.delta) >= settings.abruptTempChange)
      out.push({
        id: `abrupt-t-${c.to.id}`, kind: 'abrupt', level: 'warning', date: c.to.date, time: c.to.time, ts: c.to.ts, recordId: c.to.id,
        title: `Cambio brusco de temperatura (${c.delta > 0 ? '+' : ''}${fmt(c.delta)} °C).`,
        detail: `${fmtDate(c.to.date)}: de ${fmt(c.from.airTemp)} °C a las ${c.from.time} a ${fmt(c.to.airTemp)} °C a las ${c.to.time}.`,
      });
  }
  for (const c of consecutiveChanges(records, 'relHumidity')) {
    if (Math.abs(c.delta) >= settings.abruptHumidityChange)
      out.push({
        id: `abrupt-h-${c.to.id}`, kind: 'abrupt', level: 'warning', date: c.to.date, time: c.to.time, ts: c.to.ts, recordId: c.to.id,
        title: `Cambio brusco de humedad relativa (${c.delta > 0 ? '+' : ''}${fmt(c.delta, 0)} %).`,
        detail: `${fmtDate(c.to.date)}: de ${fmt(c.from.relHumidity, 0)} % a las ${c.from.time} a ${fmt(c.to.relHumidity, 0)} % a las ${c.to.time}.`,
      });
  }
  return out;
}

/** Periodos sin registros mayores al límite configurado. */
export function gapAlerts(records: ClimateRecord[], settings: AppSettings, checkUntilNow = true): ClimateAlert[] {
  const sorted = sortByTs(records);
  const limit = settings.gapHours * 3600000;
  const out: ClimateAlert[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].ts - sorted[i - 1].ts;
    if (gap > limit)
      out.push({
        id: `gap-${sorted[i].id}`, kind: 'gap', level: 'info', date: sorted[i].date, ts: sorted[i].ts,
        title: `Falta de registros durante ${Math.round(gap / 3600000)} horas.`,
        detail: `Sin datos entre ${fmtDate(sorted[i - 1].date)} ${sorted[i - 1].time} y ${fmtDate(sorted[i].date)} ${sorted[i].time}.`,
      });
  }
  const last = sorted[sorted.length - 1];
  if (checkUntilNow && last && Date.now() - last.ts > limit)
    out.push({
      id: 'gap-now', kind: 'gap', level: 'warning', date: last.date, ts: Date.now(),
      title: `No hay registros desde hace ${Math.round((Date.now() - last.ts) / 3600000)} horas.`,
      detail: `Último registro: ${fmtDate(last.date)} ${last.time}. Límite configurado: ${settings.gapHours} h.`,
    });
  return out;
}

export function allAlerts(records: ClimateRecord[], thresholds: ClimateThreshold[], settings: AppSettings, checkUntilNow = true) {
  const byRecord = records.flatMap((r) => recordAlerts(r, thresholdFor(r, thresholds)));
  return [...byRecord, ...abruptChangeAlerts(records, settings), ...gapAlerts(records, settings, checkUntilNow)].sort((a, b) => b.ts - a.ts);
}

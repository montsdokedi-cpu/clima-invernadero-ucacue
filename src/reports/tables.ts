import { SOURCE_LABELS, VALIDATION_LABELS, type ClimateRecord, type Crop, type Greenhouse } from '../db/types';
import { fmtDate } from '../lib/dates';
import { dailySummaries, round, summarize } from '../lib/stats';
import { isNum, VARIABLES, variablesWithData, type NumericKey } from '../lib/variables';

type Cell = string | number | null;

export interface Lookup {
  greenhouseById: Map<number, Greenhouse>;
  cropById: Map<number, Crop>;
}

const NUM_KEYS: NumericKey[] = [
  'airTemp', 'relHumidity', 'soilTemp', 'soilMoisture', 'luminosity', 'solarRadiation', 'windSpeed', 'precipitation', 'outsideTemp', 'outsideHumidity',
  'airTemp1', 'relHumidity1', 'airTemp2', 'relHumidity2', 'soilMoisture1', 'soilMoisture2', 'soilMoisture3', 'soilMoisture4',
];
const valveText = (v: boolean | null | undefined) => (v === true ? 'ABIERTA' : v === false ? 'CERRADA' : '');

export const RECORD_HEADERS = [
  'Fecha', 'Hora', 'Invernadero', 'Cultivo', 'Etapa fenológica',
  ...NUM_KEYS.map((k) => `${VARIABLES[k].label} (${VARIABLES[k].unit})`),
  'Electroválvula 1', 'Electroválvula 2', 'Electroválvula 3', 'Electroválvula 4',
  'Origen', 'Sensor', 'Validación', 'Nota de validación',
  'Responsable', 'Método de medición', 'Clima exterior', 'Observaciones', 'Observaciones del cultivo', 'Tipo de dato',
];

export function recordRows(records: ClimateRecord[], lk: Lookup): Cell[][] {
  return records.map((r) => {
    const crop = r.cropId ? lk.cropById.get(r.cropId) : undefined;
    return [
      fmtDate(r.date), r.time, lk.greenhouseById.get(r.greenhouseId)?.code ?? '', crop ? `${crop.name}${crop.variety ? ` (${crop.variety})` : ''}` : '', r.phenologicalStage ?? '',
      ...NUM_KEYS.map((k) => (isNum(r[k]) ? (r[k] as number) : null)),
      valveText(r.valve1), valveText(r.valve2), valveText(r.valve3), valveText(r.valve4),
      SOURCE_LABELS[r.source], r.sensorId ?? '', VALIDATION_LABELS[r.validation ?? 'valido'], r.validationNote ?? '',
      r.recordedBy ?? '', r.method ?? '', r.outsideWeather ?? '', r.observations ?? '', r.cropObservations ?? '', r.isDemo ? 'DEMOSTRACIÓN' : 'Real',
    ];
  });
}

export const STATS_HEADERS = ['Variable', 'Unidad', 'N.º registros', 'Promedio', 'Máximo', 'Mínimo', 'Amplitud (máx − mín)', 'Desviación estándar'];

export function statsRows(records: ClimateRecord[]): Cell[][] {
  return variablesWithData(records).map((v) => {
    const s = summarize(records, v.key);
    const d = Math.max(v.decimals, 1);
    const r = (x: number | null) => (x === null ? null : round(x, d));
    return [v.label, v.unit, s.n, v.aggregate === 'sum' ? `${r(s.sum)} (acum.)` : r(s.mean), r(s.max), r(s.min), r(s.range), r(s.std)];
  });
}

/** Máximos y mínimos con fecha y hora de ocurrencia. */
export const EXTREMES_HEADERS = ['Variable', 'Máximo', 'Fecha y hora del máximo', 'Mínimo', 'Fecha y hora del mínimo'];
export function extremesRows(records: ClimateRecord[]): Cell[][] {
  return variablesWithData(records).map((v) => {
    const s = summarize(records, v.key);
    const d = v.decimals;
    return [
      v.label,
      s.max === null ? null : `${round(s.max, d)} ${v.unit}`,
      s.maxRecord ? `${fmtDate(s.maxRecord.date)} ${s.maxRecord.time}` : '',
      s.min === null ? null : `${round(s.min, d)} ${v.unit}`,
      s.minRecord ? `${fmtDate(s.minRecord.date)} ${s.minRecord.time}` : '',
    ];
  });
}

export const DAILY_HEADERS = ['Fecha', 'Registros', 'T. prom (°C)', 'T. máx (°C)', 'T. mín (°C)', 'Amplitud (°C)', 'HR prom (%)', 'HR máx (%)', 'HR mín (%)', 'Variación HR (%)', 'T. suelo prom (°C)', 'H. suelo prom (%)'];

export function dailyRows(records: ClimateRecord[]): Cell[][] {
  return dailySummaries(records).map((d) => {
    const t = d.stats.airTemp;
    const h = d.stats.relHumidity;
    const r = (x: number | null, dec = 1) => (x === null ? null : round(x, dec));
    return [fmtDate(d.key), d.n, r(t.mean), r(t.max), r(t.min), r(t.range), r(h.mean, 0), r(h.max, 0), r(h.min, 0), r(h.range, 0), r(d.stats.soilTemp.mean), r(d.stats.soilMoisture.mean, 0)];
  });
}

export function variableLabel(k: NumericKey) {
  return `${VARIABLES[k].label} (${VARIABLES[k].unit})`;
}

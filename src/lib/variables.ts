import type { ClimateRecord, OptionalField } from '../db/types';

export type NumericKey =
  | 'airTemp'
  | 'relHumidity'
  | 'soilTemp'
  | 'soilMoisture'
  | 'luminosity'
  | 'solarRadiation'
  | 'windSpeed'
  | 'precipitation'
  | 'outsideTemp'
  | 'outsideHumidity';

export interface VariableDef {
  key: NumericKey;
  label: string;
  short: string;
  unit: string;
  min: number;
  max: number;
  decimals: number;
  color: string;
  optional: boolean;
  /** Para precipitación el acumulado es más útil que el promedio. */
  aggregate: 'mean' | 'sum';
}

// Rangos físicamente posibles para validar entradas (no son rangos de referencia).
export const VARIABLES: Record<NumericKey, VariableDef> = {
  airTemp: { key: 'airTemp', label: 'Temperatura del aire', short: 'T. aire', unit: '°C', min: -10, max: 60, decimals: 1, color: '#e0663b', optional: false, aggregate: 'mean' },
  relHumidity: { key: 'relHumidity', label: 'Humedad relativa', short: 'HR', unit: '%', min: 0, max: 100, decimals: 0, color: '#2b7bd6', optional: false, aggregate: 'mean' },
  soilTemp: { key: 'soilTemp', label: 'Temperatura del suelo', short: 'T. suelo', unit: '°C', min: -5, max: 50, decimals: 1, color: '#9c6b3f', optional: true, aggregate: 'mean' },
  soilMoisture: { key: 'soilMoisture', label: 'Humedad del suelo', short: 'H. suelo', unit: '%', min: 0, max: 100, decimals: 0, color: '#1f9e8f', optional: true, aggregate: 'mean' },
  luminosity: { key: 'luminosity', label: 'Luminosidad', short: 'Luz', unit: 'lux', min: 0, max: 200000, decimals: 0, color: '#d9a21b', optional: true, aggregate: 'mean' },
  solarRadiation: { key: 'solarRadiation', label: 'Radiación solar', short: 'Radiación', unit: 'W/m²', min: 0, max: 1500, decimals: 0, color: '#e8862a', optional: true, aggregate: 'mean' },
  windSpeed: { key: 'windSpeed', label: 'Velocidad del viento', short: 'Viento', unit: 'm/s', min: 0, max: 60, decimals: 1, color: '#6b7fa8', optional: true, aggregate: 'mean' },
  precipitation: { key: 'precipitation', label: 'Precipitación', short: 'Lluvia', unit: 'mm', min: 0, max: 500, decimals: 1, color: '#4a90c2', optional: true, aggregate: 'sum' },
  outsideTemp: { key: 'outsideTemp', label: 'Temperatura exterior', short: 'T. exterior', unit: '°C', min: -10, max: 60, decimals: 1, color: '#8e5bb5', optional: true, aggregate: 'mean' },
  outsideHumidity: { key: 'outsideHumidity', label: 'Humedad relativa exterior', short: 'HR exterior', unit: '%', min: 0, max: 100, decimals: 0, color: '#5d8fb0', optional: true, aggregate: 'mean' },
};

export const ALL_KEYS = Object.keys(VARIABLES) as NumericKey[];

/** Variables visibles según la configuración de campos opcionales. */
export function enabledVariables(optional: Record<OptionalField, boolean>): VariableDef[] {
  return ALL_KEYS.map((k) => VARIABLES[k]).filter((v) => !v.optional || optional[v.key as OptionalField]);
}

/** Variables que tienen al menos un dato en los registros dados. */
export function variablesWithData(records: ClimateRecord[]): VariableDef[] {
  return ALL_KEYS.map((k) => VARIABLES[k]).filter((v) => records.some((r) => isNum(r[v.key])));
}

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function fmt(v: number | null | undefined, decimals = 1): string {
  if (!isNum(v)) return '—';
  return v.toLocaleString('es-EC', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtVar(key: NumericKey, v: number | null | undefined, withUnit = true): string {
  const def = VARIABLES[key];
  if (!isNum(v)) return '—';
  const s = fmt(v, def.decimals);
  return withUnit ? `${s} ${def.unit}` : s;
}

/** Horas con un decimal: "3,5 h" */
export function fmtHours(h: number | null | undefined): string {
  if (!isNum(h)) return '—';
  return `${fmt(h, h < 10 ? 1 : 0)} h`;
}

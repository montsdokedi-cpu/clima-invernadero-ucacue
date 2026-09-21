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
  | 'outsideHumidity'
  | 'airTemp1'
  | 'relHumidity1'
  | 'airTemp2'
  | 'relHumidity2'
  | 'soilMoisture1'
  | 'soilMoisture2'
  | 'soilMoisture3'
  | 'soilMoisture4';

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
  // Sistema de 4 parcelas (ESP32)
  airTemp1: { key: 'airTemp1', label: 'Temperatura ambiental 1', short: 'T. amb. 1', unit: '°C', min: -10, max: 60, decimals: 1, color: '#e0663b', optional: true, aggregate: 'mean' },
  relHumidity1: { key: 'relHumidity1', label: 'Humedad ambiental 1', short: 'HR amb. 1', unit: '%', min: 0, max: 100, decimals: 0, color: '#2b7bd6', optional: true, aggregate: 'mean' },
  airTemp2: { key: 'airTemp2', label: 'Temperatura ambiental 2', short: 'T. amb. 2', unit: '°C', min: -10, max: 60, decimals: 1, color: '#c2407a', optional: true, aggregate: 'mean' },
  relHumidity2: { key: 'relHumidity2', label: 'Humedad ambiental 2', short: 'HR amb. 2', unit: '%', min: 0, max: 100, decimals: 0, color: '#1f9e8f', optional: true, aggregate: 'mean' },
  soilMoisture1: { key: 'soilMoisture1', label: 'Humedad del suelo · Parcela 1', short: 'Suelo P1', unit: '%', min: 0, max: 100, decimals: 0, color: '#2f7d4a', optional: true, aggregate: 'mean' },
  soilMoisture2: { key: 'soilMoisture2', label: 'Humedad del suelo · Parcela 2', short: 'Suelo P2', unit: '%', min: 0, max: 100, decimals: 0, color: '#9c6b3f', optional: true, aggregate: 'mean' },
  soilMoisture3: { key: 'soilMoisture3', label: 'Humedad del suelo · Parcela 3', short: 'Suelo P3', unit: '%', min: 0, max: 100, decimals: 0, color: '#6b7fa8', optional: true, aggregate: 'mean' },
  soilMoisture4: { key: 'soilMoisture4', label: 'Humedad del suelo · Parcela 4', short: 'Suelo P4', unit: '%', min: 0, max: 100, decimals: 0, color: '#d9a21b', optional: true, aggregate: 'mean' },
};

export const SOIL_KEYS = ['soilMoisture1', 'soilMoisture2', 'soilMoisture3', 'soilMoisture4'] as const;
export const AMBIENT_TEMP_KEYS = ['airTemp1', 'airTemp2'] as const;
export const AMBIENT_HUM_KEYS = ['relHumidity1', 'relHumidity2'] as const;
export const VALVE_KEYS = ['valve1', 'valve2', 'valve3', 'valve4'] as const;

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

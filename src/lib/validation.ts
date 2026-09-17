import type { ClimateRecord } from '../db/types';
import { isValidISODate, isValidTime, todayISO, toTimestamp } from './dates';
import { VARIABLES, type NumericKey } from './variables';

/** Acepta "22.5" y "22,5". Devuelve undefined si está vacío y NaN si no es número. */
export function parseNumber(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'number') return raw;
  const s = String(raw).trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return undefined;
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return NaN;
  return Number(s);
}

export type RecordInput = {
  date: string;
  time: string;
} & Partial<Record<NumericKey, string | number | null | undefined>>;

export interface ValidationResult {
  errors: Record<string, string>;
  values: Partial<Record<NumericKey, number | null>>;
}

/**
 * Valida un registro climático.
 * - Campos obligatorios: fecha, hora, temperatura del aire y humedad relativa.
 * - Formato numérico y rangos físicamente posibles.
 * - Fecha válida y no futura.
 */
export function validateRecord(input: RecordInput, requiredOptional: NumericKey[] = []): ValidationResult {
  const errors: Record<string, string> = {};
  const values: Partial<Record<NumericKey, number | null>> = {};

  if (!input.date) errors.date = 'La fecha es obligatoria.';
  else if (!isValidISODate(input.date)) errors.date = 'La fecha no es válida.';
  else if (input.date > todayISO()) errors.date = 'La fecha no puede ser posterior a hoy.';

  if (!input.time) errors.time = 'La hora es obligatoria.';
  else if (!isValidTime(input.time)) errors.time = 'La hora debe tener el formato HH:mm (00:00 a 23:59).';
  else if (!errors.date && toTimestamp(input.date, input.time) > Date.now() + 5 * 60000)
    errors.time = 'La hora no puede ser posterior al momento actual.';

  const required: NumericKey[] = ['airTemp', 'relHumidity', ...requiredOptional];

  for (const key of Object.keys(VARIABLES) as NumericKey[]) {
    const def = VARIABLES[key];
    const raw = input[key];
    const n = parseNumber(raw);
    if (n === undefined) {
      if (required.includes(key)) errors[key] = `${def.label} es obligatoria.`;
      else values[key] = null;
      continue;
    }
    if (Number.isNaN(n)) {
      errors[key] = `${def.label} debe ser un número (ej. ${key === 'airTemp' ? '22.5' : '78'}).`;
      continue;
    }
    if (n < def.min || n > def.max) {
      errors[key] =
        key === 'relHumidity' || key === 'soilMoisture'
          ? `${def.label} debe estar entre 0 y 100 %.`
          : `${def.label} fuera de un rango posible (${def.min} a ${def.max} ${def.unit}).`;
      continue;
    }
    values[key] = Number(n.toFixed(def.decimals === 0 ? 1 : 2));
  }
  return { errors, values };
}

/**
 * Control de calidad automático: valores físicamente posibles pero atípicos para un
 * invernadero se marcan como «sospechoso» (no se eliminan ni se corrigen).
 */
export function assessRecord(r: Pick<ClimateRecord, 'airTemp' | 'relHumidity' | 'soilMoisture'>): { validation: 'valido' | 'sospechoso'; note: string } {
  const notes: string[] = [];
  if (r.relHumidity >= 100) notes.push('HR de 100 %: posible saturación o condensación sobre el sensor');
  if (r.relHumidity <= 5) notes.push('HR menor o igual a 5 %: atípica en invernadero');
  if (r.airTemp >= 50) notes.push('temperatura del aire ≥ 50 °C: revisar exposición directa al sol del sensor');
  if (r.airTemp <= -2) notes.push('temperatura bajo −2 °C: atípica para el invernadero');
  if (r.soilMoisture === 0) notes.push('humedad del suelo 0 %: posible sonda desconectada');
  return notes.length ? { validation: 'sospechoso', note: notes.join('; ') } : { validation: 'valido', note: '' };
}

/** Saltos bruscos entre lecturas muy cercanas (≤ 30 min) suelen indicar error de lectura. */
export function flagSensorJumps<T extends Pick<ClimateRecord, 'ts' | 'airTemp' | 'validation' | 'validationNote'>>(sorted: T[], maxJump = 8) {
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const minutes = (b.ts - a.ts) / 60000;
    if (minutes > 0 && minutes <= 30 && Math.abs(b.airTemp - a.airTemp) >= maxJump) {
      b.validation = 'sospechoso';
      const note = `salto de ${(b.airTemp - a.airTemp).toFixed(1)} °C en ${Math.round(minutes)} min respecto a la lectura anterior`;
      b.validationNote = b.validationNote ? `${b.validationNote}; ${note}` : note;
    }
  }
  return sorted;
}

export function isDuplicate(existing: ClimateRecord[], greenhouseId: number, date: string, time: string, ignoreId?: number) {
  return existing.some((r) => r.greenhouseId === greenhouseId && r.date === date && r.time === time && r.id !== ignoreId);
}

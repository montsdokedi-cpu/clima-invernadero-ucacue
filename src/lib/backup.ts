import { DEFAULT_SETTINGS } from '../db/db';
import type { AppSettings } from '../db/types';
import { VARIABLES } from './variables';

/** Nombres con los que la app marca sus respaldos (el antiguo se acepta para migrar datos). */
export const BACKUP_APP_NAME = 'InverClima';
const ACCEPTED_NAMES = [BACKUP_APP_NAME, 'Clima Invernadero UCC'];

/** Tamaño máximo de un respaldo (evita que un archivo enorme congele el celular). */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

const TABLES = ['users', 'greenhouses', 'crops', 'climateRecords', 'climateThresholds', 'reports', 'parcels', 'valveEvents'] as const;
const MAX_ROWS = 500_000;

type Row = Record<string, unknown>;
export interface CheckedBackup {
  settings: Partial<AppSettings> | null;
  tables: Partial<Record<(typeof TABLES)[number], Row[]>>;
}

const isPlainObject = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Copia solo datos simples (texto, números finitos, booleanos, null, listas y objetos), sin claves peligrosas. */
function clean(v: unknown, depth = 0): unknown {
  if (depth > 8) throw new Error('El archivo tiene una estructura demasiado anidada.');
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > 20_000 ? v.slice(0, 20_000) : v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('El archivo contiene números no válidos.');
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1));
  if (isPlainObject(v)) {
    const out: Row = {};
    for (const [k, x] of Object.entries(v)) if (!DANGEROUS_KEYS.has(k)) out[k] = clean(x, depth + 1);
    return out;
  }
  throw new Error('El archivo contiene datos de un tipo no permitido.');
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function checkRecord(r: Row, i: number) {
  const where = `registro ${i + 1}`;
  if (typeof r.date !== 'string' || !DATE_RE.test(r.date)) throw new Error(`Fecha no válida en el ${where}.`);
  if (typeof r.time !== 'string' || !TIME_RE.test(r.time)) throw new Error(`Hora no válida en el ${where}.`);
  if (typeof r.ts !== 'number') throw new Error(`Marca de tiempo no válida en el ${where}.`);
  for (const key of Object.keys(VARIABLES)) {
    const v = r[key];
    if (v !== undefined && v !== null && typeof v !== 'number') throw new Error(`Valor no numérico en «${VARIABLES[key as keyof typeof VARIABLES].label}» (${where}).`);
  }
}

/**
 * Revisa un respaldo antes de reemplazar los datos del dispositivo.
 * Lanza un error con un mensaje claro si el archivo no es válido; no modifica la base de datos.
 */
export function checkBackup(raw: unknown): CheckedBackup {
  if (!isPlainObject(raw)) throw new Error('El archivo no es un respaldo de esta aplicación.');
  if (typeof raw.app !== 'string' || !ACCEPTED_NAMES.includes(raw.app)) throw new Error('El archivo no es un respaldo de esta aplicación.');
  if (!Array.isArray(raw.climateRecords)) throw new Error('El respaldo no tiene registros climáticos.');

  const tables: CheckedBackup['tables'] = {};
  for (const t of TABLES) {
    const v = raw[t];
    if (v === undefined) continue;
    if (!Array.isArray(v)) throw new Error(`La sección «${t}» del respaldo está dañada.`);
    if (v.length > MAX_ROWS) throw new Error(`La sección «${t}» tiene demasiadas filas.`);
    const rows = clean(v) as unknown[];
    if (!rows.every(isPlainObject)) throw new Error(`La sección «${t}» del respaldo está dañada.`);
    tables[t] = rows as Row[];
  }
  tables.climateRecords!.forEach(checkRecord);

  // Configuración: solo se copian las claves que la app conoce
  let settings: Partial<AppSettings> | null = null;
  if (isPlainObject(raw.settings)) {
    const s = clean(raw.settings) as Row;
    settings = {};
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
      if (k in s && k !== 'id') (settings as Row)[k] = s[k];
    }
  }
  return { settings, tables };
}

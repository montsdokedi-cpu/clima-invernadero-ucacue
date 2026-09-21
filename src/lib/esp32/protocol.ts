import type { IrrigationMode, Parcel, ParcelId } from '../../db/types';
import type { AmbientReading } from '../irrigation';
import { parseNumber } from '../validation';

// Contrato de datos con el ESP32. Los nombres de campo siguen la especificación:
// temperatura_ambiente_1, humedad_ambiente_1, temperatura_ambiente_2, humedad_ambiente_2,
// humedad_suelo_1..4, valvula_1..4. Se aceptan variantes (mayúsculas, sin guion bajo, alias cortos)
// para no depender todavía del firmware definitivo.

export interface Esp32Reading extends AmbientReading {
  ts: number;
  /** Motivo de apertura informado por el ESP32 (opcional) */
  reasons: (string | null)[];
  /** Modo que el ESP32 tiene activo en cada parcela (opcional) */
  modes: (IrrigationMode | null)[];
  ip?: string;
  firmware?: string;
  raw: unknown;
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const ALIASES: Record<string, string[]> = {
  airTemp1: ['temperaturaambiente1', 'tempambiente1', 'temperatura1', 'tamb1', 'temp1', 't1'],
  relHumidity1: ['humedadambiente1', 'humambiente1', 'humedadaire1', 'hamb1', 'hr1', 'hum1', 'h1'],
  airTemp2: ['temperaturaambiente2', 'tempambiente2', 'temperatura2', 'tamb2', 'temp2', 't2'],
  relHumidity2: ['humedadambiente2', 'humambiente2', 'humedadaire2', 'hamb2', 'hr2', 'hum2', 'h2'],
  soil1: ['humedadsuelo1', 'suelo1', 'hs1', 's1', 'soil1'],
  soil2: ['humedadsuelo2', 'suelo2', 'hs2', 's2', 'soil2'],
  soil3: ['humedadsuelo3', 'suelo3', 'hs3', 's3', 'soil3'],
  soil4: ['humedadsuelo4', 'suelo4', 'hs4', 's4', 'soil4'],
  valve1: ['valvula1', 'electrovalvula1', 'v1', 'valve1', 'rele1'],
  valve2: ['valvula2', 'electrovalvula2', 'v2', 'valve2', 'rele2'],
  valve3: ['valvula3', 'electrovalvula3', 'v3', 'valve3', 'rele3'],
  valve4: ['valvula4', 'electrovalvula4', 'v4', 'valve4', 'rele4'],
  reason1: ['motivo1', 'razon1'], reason2: ['motivo2', 'razon2'], reason3: ['motivo3', 'razon3'], reason4: ['motivo4', 'razon4'],
  mode1: ['modo1'], mode2: ['modo2'], mode3: ['modo3'], mode4: ['modo4'],
  ip: ['ip', 'direccionip', 'localip'],
  firmware: ['firmware', 'version', 'fw'],
  timestamp: ['timestamp', 'marcatiempo', 'epoch', 'time'],
};

function flatten(obj: unknown, out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, out);
      else out[norm(k)] = v;
    }
  }
  return out;
}

export function parseValve(v: unknown): boolean | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = norm(String(v));
  if (['1', 'true', 'on', 'abierta', 'abierto', 'open', 'abrir', 'encendida', 'activa'].includes(s)) return true;
  if (['0', 'false', 'off', 'cerrada', 'cerrado', 'closed', 'cerrar', 'apagada', 'inactiva'].includes(s)) return false;
  return null;
}

function num(v: unknown, min: number, max: number): number | null {
  const n = parseNumber(v as string | number);
  if (n === undefined || Number.isNaN(n)) return null;
  // Valores fuera de rango físico se descartan (p. ej. -127 °C de un sensor desconectado)
  return n < min || n > max ? null : n;
}

const MODE_WORDS: Record<string, IrrigationMode> = {
  automatico: 'automatico', auto: 'automatico', '1': 'automatico',
  humedad: 'humedad', solohumedad: 'humedad', '2': 'humedad',
  temperatura: 'temperatura', solotemperatura: 'temperatura', '3': 'temperatura',
  manual: 'manual', '4': 'manual',
};

/** Convierte la respuesta del ESP32 (JSON) en una lectura normalizada. */
export function parseEsp32Payload(raw: unknown, now = Date.now()): Esp32Reading {
  const data = typeof raw === 'string' ? safeJson(raw) : raw;
  const f = flatten(data);
  const get = (field: string) => {
    for (const a of ALIASES[field]) if (a in f) return f[a];
    return undefined;
  };
  const tsRaw = get('timestamp');
  let ts = now;
  if (typeof tsRaw === 'number') {
    const ms = tsRaw < 1e11 ? tsRaw * 1000 : tsRaw;
    // Se usa la hora del ESP32 solo si está sincronizada (±1 día); si no, la del teléfono
    if (Math.abs(ms - now) < 86400000) ts = ms;
  }
  const modeOf = (i: number) => {
    const v = get(`mode${i}`);
    return v === undefined ? null : MODE_WORDS[norm(String(v))] ?? null;
  };
  return {
    ts,
    airTemp1: num(get('airTemp1'), -10, 60),
    relHumidity1: num(get('relHumidity1'), 0, 100),
    airTemp2: num(get('airTemp2'), -10, 60),
    relHumidity2: num(get('relHumidity2'), 0, 100),
    soil: [1, 2, 3, 4].map((i) => num(get(`soil${i}`), 0, 100)),
    valves: [1, 2, 3, 4].map((i) => parseValve(get(`valve${i}`))),
    reasons: [1, 2, 3, 4].map((i) => {
      const v = get(`reason${i}`);
      return v ? String(v) : null;
    }),
    modes: [1, 2, 3, 4].map(modeOf),
    ip: get('ip') ? String(get('ip')) : undefined,
    firmware: get('firmware') ? String(get('firmware')) : undefined,
    raw: data,
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    // Formato alternativo "clave=valor;clave=valor"
    const out: Record<string, string> = {};
    for (const part of s.split(/[;&\n]/)) {
      const [k, v] = part.split(/[=:]/);
      if (k && v !== undefined) out[k.trim()] = v.trim();
    }
    return out;
  }
}

/** Orden de apertura/cierre enviada al ESP32 */
export function valveCommand(n: ParcelId, open: boolean) {
  return { valvula: n, estado: open ? 'abrir' : 'cerrar', abierta: open };
}

/** Configuración de las 4 parcelas enviada al ESP32 (para que ejecute los modos automáticos). */
export function configPayload(parcels: Parcel[]) {
  return {
    parcelas: [...parcels]
      .sort((a, b) => a.n - b.n)
      .map((p) => ({
        parcela: p.n,
        modo: p.mode,
        humedad_minima: p.humidityMin,
        humedad_objetivo: p.humidityTarget,
        temperatura_minima: p.tempMin,
        temperatura_maxima: p.tempMax,
        duracion_maxima_min: p.maxDurationMin,
        fuente_temperatura: p.tempSource,
      })),
  };
}

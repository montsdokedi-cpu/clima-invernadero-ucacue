import * as XLSX from 'xlsx';
import type { ClimateRecord, Crop, DataValidation } from '../db/types';
import { stageForDate } from './agro';
import { parseValve } from './esp32/protocol';
import { isValidISODate, toTimestamp } from './dates';
import { assessRecord, flagSensorJumps, validateRecord } from './validation';
import { ALL_KEYS, VARIABLES, type NumericKey } from './variables';

// Importación de datos de sensores / dataloggers y hojas de cálculo.
// Formatos: Excel (.xlsx/.xls), CSV/TXT y JSON (arreglo de lecturas, formato de API futura).

export type TextField = 'observations' | 'recordedBy' | 'outsideWeather' | 'cropObservations' | 'phenologicalStage' | 'sensorId' | 'crop';
export type ValveField = 'valve1' | 'valve2' | 'valve3' | 'valve4';
export type ImportField = NumericKey | 'date' | 'time' | TextField | ValveField;

// Columnas del ESP32 (temperatura_ambiente_1, humedad_suelo_3, valvula_2…)
const ESP32_COLUMNS: Record<string, ImportField> = {
  temperaturaambiente1: 'airTemp1', humedadambiente1: 'relHumidity1', temperaturaambiente2: 'airTemp2', humedadambiente2: 'relHumidity2',
  humedadsuelo1: 'soilMoisture1', humedadsuelo2: 'soilMoisture2', humedadsuelo3: 'soilMoisture3', humedadsuelo4: 'soilMoisture4',
  humedadsueloparcela1: 'soilMoisture1', humedadsueloparcela2: 'soilMoisture2', humedadsueloparcela3: 'soilMoisture3', humedadsueloparcela4: 'soilMoisture4',
  valvula1: 'valve1', valvula2: 'valve2', valvula3: 'valve3', valvula4: 'valve4',
  electrovalvula1: 'valve1', electrovalvula2: 'valve2', electrovalvula3: 'valve3', electrovalvula4: 'valve4',
  estadoelectrovalvula1: 'valve1', estadoelectrovalvula2: 'valve2', estadoelectrovalvula3: 'valve3', estadoelectrovalvula4: 'valve4',
};

export const IMPORT_FIELDS: { key: ImportField; label: string; required?: boolean }[] = [
  { key: 'date', label: 'Fecha', required: true },
  { key: 'time', label: 'Hora', required: true },
  ...ALL_KEYS.map((k) => ({ key: k as ImportField, label: `${VARIABLES[k].label} (${VARIABLES[k].unit})`, required: k === 'airTemp' || k === 'relHumidity' })),
  ...([1, 2, 3, 4] as const).map((n) => ({ key: `valve${n}` as ImportField, label: `Estado electroválvula ${n}` })),
  { key: 'sensorId', label: 'Sensor (identificador)' },
  { key: 'crop', label: 'Cultivo' },
  { key: 'phenologicalStage', label: 'Etapa fenológica' },
  { key: 'observations', label: 'Observaciones' },
  { key: 'cropObservations', label: 'Observaciones del cultivo' },
  { key: 'recordedBy', label: 'Responsable' },
  { key: 'outsideWeather', label: 'Clima exterior' },
];

export interface ParsedSheet {
  fileName: string;
  sheetNames: string[];
  sheetName: string;
  headers: string[];
  rows: unknown[][];
  headerRowIndex: number;
}

const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export function guessField(header: string): ImportField | '' {
  const h = norm(header);
  if (!h) return '';
  const esp = ESP32_COLUMNS[h.replace(/(c|porcentaje)$/, '')] ?? ESP32_COLUMNS[h];
  if (esp) return esp;
  if (h.includes('fecha') || h === 'date' || h === 'dia' || h === 'timestamp' || h === 'datetime') return 'date';
  if (h.startsWith('hora') || h === 'time') return 'time';
  if (h.includes('sensor') || h.includes('datalogger') || h === 'equipo' || h === 'deviceid' || h === 'device') return 'sensorId';
  if (h.includes('exterior') || h.includes('externa') || h.includes('outside') || h.endsWith('ext')) {
    if (h.includes('temp') || h.startsWith('t')) return 'outsideTemp';
    if (h.includes('hum') || h.startsWith('hr') || h.startsWith('h')) return 'outsideHumidity';
    if (h.includes('clima')) return 'outsideWeather';
  }
  if (h.includes('suelo') || h.includes('soil')) {
    if (h.includes('temp') || h.startsWith('t')) return 'soilTemp';
    if (h.includes('hum') || h.startsWith('h') || h.includes('moist')) return 'soilMoisture';
  }
  if (h.includes('etapa') || h.includes('fenolog')) return 'phenologicalStage';
  if (h.includes('cultivo') && h.includes('obs')) return 'cropObservations';
  if (h === 'cultivo' || h === 'crop') return 'crop';
  if (h.startsWith('obs') || h.startsWith('nota') || h.includes('comentario')) return 'observations';
  if (h.startsWith('temp') || h === 't' || h === 'tc' || h === 'taire' || h === 'tempaire' || h === 'temperature') return 'airTemp';
  if (h.startsWith('hum') || h === 'hr' || h === 'rh' || h.startsWith('hr')) return 'relHumidity';
  if (h.includes('lux') || h.includes('lumin') || h === 'luz') return 'luminosity';
  if (h.includes('radiac') || h.includes('radiation')) return 'solarRadiation';
  if (h.includes('viento') || h.includes('wind')) return 'windSpeed';
  if (h.includes('precip') || h.includes('lluvia') || h === 'pp') return 'precipitation';
  if (h.includes('respons') || h.includes('registrad') || h.includes('tecnico')) return 'recordedBy';
  if (h.includes('clima') || h.includes('tiempo')) return 'outsideWeather';
  return '';
}

export function autoMap(headers: string[]): (ImportField | '')[] {
  const used = new Set<ImportField>();
  return headers.map((h) => {
    const f = guessField(h);
    if (!f || used.has(f)) return '';
    used.add(f);
    return f;
  });
}

function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const count = (d: string) => {
    let n = 0;
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === d && !q) n++;
    }
    return n;
  };
  return [';', ',', '\t'].reduce((best, d) => (count(d) > count(best) ? d : best), ',');
}

export function parseCSV(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const d = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const isEmptyRow = (r: unknown[]) => r.every((c) => String(c ?? '').trim() === '');

function buildSheet(fileName: string, sheetNames: string[], sheetName: string, aoa: unknown[][]): ParsedSheet {
  const rows = aoa.filter((r) => !isEmptyRow(r));
  let headerRowIndex = rows.slice(0, 10).findIndex((r) => {
    const m = autoMap(r.map(String));
    return m.includes('date') || m.includes('airTemp');
  });
  if (headerRowIndex < 0) headerRowIndex = 0;
  const width = Math.max(0, ...rows.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => String(rows[headerRowIndex]?.[i] ?? '').trim() || `Columna ${i + 1}`);
  return { fileName, sheetNames, sheetName, headers, rows: rows.slice(headerRowIndex + 1), headerRowIndex };
}

/** JSON: arreglo de objetos o { readings: [...] } — cada clave se convierte en columna. */
function jsonToAoa(text: string): unknown[][] {
  const data = JSON.parse(text);
  const list: Record<string, unknown>[] = Array.isArray(data) ? data : Array.isArray(data?.readings) ? data.readings : Array.isArray(data?.data) ? data.data : [];
  if (!list.length) throw new Error('El JSON no contiene un arreglo de lecturas.');
  const keys = [...new Set(list.flatMap((o) => Object.keys(o)))];
  return [keys, ...list.map((o) => keys.map((k) => o[k] ?? ''))];
}

export async function readImportFile(file: File, sheet?: string): Promise<ParsedSheet> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return buildSheet(file.name, [], '', parseCSV(await file.text()));
  if (lower.endsWith('.json')) return buildSheet(file.name, [], '', jsonToAoa(await file.text()));
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheetName = sheet && wb.SheetNames.includes(sheet) ? sheet : wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: true, defval: '' });
  return buildSheet(file.name, wb.SheetNames, sheetName, aoa);
}

const pad = (n: number) => String(n).padStart(2, '0');

function fromSerial(v: number): { date?: string; time?: string } {
  const p = XLSX.SSF.parse_date_code(v);
  if (!p) return {};
  const out: { date?: string; time?: string } = {};
  if (v >= 1) out.date = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  const frac = v - Math.floor(v);
  if (frac > 0) {
    const mins = Math.round(frac * 1440) % 1440;
    out.time = `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
  }
  return out;
}

export function parseTimeCell(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') {
    if (v >= 0 && v < 1) return fromSerial(v).time ?? '00:00';
    if (Number.isInteger(v) && v >= 0 && v <= 23) return `${pad(v)}:00`;
    if (v >= 1) return fromSerial(v).time;
    return undefined;
  }
  const s = String(v).trim().toLowerCase();
  const m = s.match(/(\d{1,2})\s*[:hH.]\s*(\d{2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2]);
    const ap = m[4]?.replace(/[\s.]/g, '');
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || min > 59) return undefined;
    return `${pad(h)}:${pad(min)}`;
  }
  if (/^\d{1,2}$/.test(s) && Number(s) <= 23) return `${pad(Number(s))}:00`;
  return undefined;
}

export function parseDateCell(v: unknown): { date?: string; time?: string } {
  if (v === null || v === undefined || v === '') return {};
  if (typeof v === 'number') {
    if (v > 1e11) {
      // marca de tiempo Unix en milisegundos (sensores / API)
      const d = new Date(v);
      return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
    }
    return v > 59 && v < 100000 ? fromSerial(v) : {};
  }
  if (v instanceof Date) return { date: `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` };
  const s = String(v).trim();
  let y: number, mo: number, d: number;
  let m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
    if (!m) return {};
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    if (y < 100) y += 2000;
  }
  const date = `${y}-${pad(mo)}-${pad(d)}`;
  const rest = s.slice(m[0].length).replace(/^[T\s]+/, '');
  return { date: isValidISODate(date) ? date : undefined, time: rest ? parseTimeCell(rest) : undefined };
}

export interface ImportDefaults {
  greenhouseId: number;
  cropId: number | null;
  crops: Crop[];
  recordedBy: string;
  method: string;
  source: 'sensor' | 'importado' | 'demo';
  sensorId: string;
  isDemo: boolean;
}

export interface ImportRow {
  line: number;
  status: 'ok' | 'error' | 'duplicate';
  errors: string[];
  /** Advertencias que no impiden importar: datos faltantes, valores sospechosos */
  warnings: string[];
  missing: string[];
  validation?: DataValidation;
  record?: ClimateRecord;
  preview: { date?: string; time?: string; airTemp?: unknown; relHumidity?: unknown; sensor?: string };
}

export function buildImportRows(sheet: ParsedSheet, mapping: (ImportField | '')[], defaults: ImportDefaults, existingKeys: Set<string>): ImportRow[] {
  const col = (f: ImportField) => mapping.indexOf(f);
  const mappedOptional = ALL_KEYS.filter((k) => k !== 'airTemp' && k !== 'relHumidity' && col(k) >= 0);
  const seen = new Set<string>();
  const now = Date.now();
  const cropByName = new Map(defaults.crops.map((c) => [norm(c.name), c]));
  const rows: ImportRow[] = sheet.rows.map((row, i) => {
    const line = sheet.headerRowIndex + i + 2;
    const get = (f: ImportField) => (col(f) >= 0 ? row[col(f)] : undefined);
    const fromDate = parseDateCell(get('date'));
    const time = parseTimeCell(get('time')) ?? fromDate.time;
    const date = fromDate.date;
    const errors: string[] = [];
    if (col('date') >= 0 && get('date') !== '' && !date) errors.push(`Fecha no reconocida: "${String(get('date'))}"`);
    if (col('time') >= 0 && get('time') !== '' && get('time') !== undefined && !time) errors.push(`Hora no reconocida: "${String(get('time'))}"`);

    const input: Record<string, unknown> = { date: date ?? '', time: time ?? '' };
    for (const k of ALL_KEYS) input[k] = get(k);
    const { errors: vErr, values } = validateRecord(input as never);
    for (const [k, msg] of Object.entries(vErr)) {
      if ((k === 'date' && errors.some((e) => e.startsWith('Fecha'))) || (k === 'time' && errors.some((e) => e.startsWith('Hora')))) continue;
      errors.push(msg);
    }
    const missing = mappedOptional.filter((k) => String(get(k) ?? '').trim() === '').map((k) => VARIABLES[k].short);
    const sensor = String(get('sensorId') ?? '').trim() || defaults.sensorId.trim();
    const preview = { date, time, airTemp: get('airTemp'), relHumidity: get('relHumidity'), sensor };
    const warnings: string[] = [];
    if (missing.length) warnings.push(`Datos faltantes: ${missing.join(', ')}`);
    if (errors.length) return { line, status: 'error', errors, warnings, missing, preview };

    const key = `${defaults.greenhouseId}|${date}|${time}`;
    if (existingKeys.has(key) || seen.has(key)) {
      return { line, status: 'duplicate', errors: [existingKeys.has(key) ? 'Ya existe un registro con la misma fecha y hora.' : 'Fecha y hora repetidas dentro del archivo.'], warnings, missing, preview };
    }
    seen.add(key);
    const text = (f: TextField) => String(get(f) ?? '').trim();
    const cropName = text('crop');
    const crop = (cropName && cropByName.get(norm(cropName))) || defaults.crops.find((c) => c.id === defaults.cropId);
    if (cropName && !cropByName.get(norm(cropName))) warnings.push(`Cultivo «${cropName}» no registrado; se usó ${crop ? crop.name : 'sin cultivo'}`);
    const assess = assessRecord({ airTemp: values.airTemp!, relHumidity: values.relHumidity!, soilMoisture: values.soilMoisture ?? null });
    const record: ClimateRecord = {
      date: date!, time: time!, ts: toTimestamp(date!, time!), greenhouseId: defaults.greenhouseId, cropId: crop?.id ?? null,
      airTemp: values.airTemp!, relHumidity: values.relHumidity!,
      soilTemp: values.soilTemp ?? null, soilMoisture: values.soilMoisture ?? null, luminosity: values.luminosity ?? null,
      solarRadiation: values.solarRadiation ?? null, windSpeed: values.windSpeed ?? null, precipitation: values.precipitation ?? null,
      outsideTemp: values.outsideTemp ?? null, outsideHumidity: values.outsideHumidity ?? null,
      airTemp1: values.airTemp1 ?? null, relHumidity1: values.relHumidity1 ?? null, airTemp2: values.airTemp2 ?? null, relHumidity2: values.relHumidity2 ?? null,
      soilMoisture1: values.soilMoisture1 ?? null, soilMoisture2: values.soilMoisture2 ?? null, soilMoisture3: values.soilMoisture3 ?? null, soilMoisture4: values.soilMoisture4 ?? null,
      valve1: parseValve(get('valve1')), valve2: parseValve(get('valve2')), valve3: parseValve(get('valve3')), valve4: parseValve(get('valve4')),
      phenologicalStage: text('phenologicalStage') || stageForDate(crop, date!),
      recordedBy: text('recordedBy') || defaults.recordedBy,
      method: defaults.method,
      outsideWeather: text('outsideWeather'),
      observations: text('observations'),
      cropObservations: text('cropObservations'),
      source: defaults.isDemo ? 'demo' : defaults.source,
      sensorId: sensor || null,
      validation: assess.validation,
      validationNote: assess.note,
      isDemo: defaults.isDemo,
      createdAt: now,
      updatedAt: now,
    };
    return { line, status: 'ok', errors: [], warnings, missing, record, preview };
  });

  // Control de saltos bruscos entre lecturas consecutivas del archivo
  const ok = rows.filter((r) => r.record).sort((a, b) => a.record!.ts - b.record!.ts);
  flagSensorJumps(ok.map((r) => r.record!));
  for (const r of ok) {
    r.validation = r.record!.validation;
    if (r.validation === 'sospechoso') r.warnings.push(`Marcado sospechoso: ${r.record!.validationNote}`);
  }
  return rows;
}

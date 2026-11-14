import { MODE_LABELS, type ClimateRecord, type ParcelId, type ValveEvent } from '../db/types';
import { fmtDate, fmtDateTime, todayISO } from '../lib/dates';
import { safeFileName } from '../lib/download';
import { isNum, VARIABLES, type NumericKey } from '../lib/variables';
import { downloadXLSX } from './spreadsheet';

// Exportación del histórico del sistema de 4 parcelas (ESP32) a Excel (.xlsx).

type Cell = string | number | null;

export type ExportColumn =
  | 'airTemp1' | 'relHumidity1' | 'airTemp2' | 'relHumidity2'
  | 'soilMoisture1' | 'soilMoisture2' | 'soilMoisture3' | 'soilMoisture4'
  | 'valve1' | 'valve2' | 'valve3' | 'valve4'
  | 'airTemp' | 'relHumidity' | 'soilTemp' | 'solarRadiation';

export const EXPORT_COLUMNS: { key: ExportColumn; label: string; parcel?: ParcelId; group: 'ambiente' | 'suelo' | 'valvula' | 'general' }[] = [
  { key: 'airTemp1', label: 'Temperatura ambiental 1 (°C)', group: 'ambiente' },
  { key: 'relHumidity1', label: 'Humedad ambiental 1 (%)', group: 'ambiente' },
  { key: 'airTemp2', label: 'Temperatura ambiental 2 (°C)', group: 'ambiente' },
  { key: 'relHumidity2', label: 'Humedad ambiental 2 (%)', group: 'ambiente' },
  { key: 'soilMoisture1', label: 'Humedad suelo parcela 1 (%)', parcel: 1, group: 'suelo' },
  { key: 'soilMoisture2', label: 'Humedad suelo parcela 2 (%)', parcel: 2, group: 'suelo' },
  { key: 'soilMoisture3', label: 'Humedad suelo parcela 3 (%)', parcel: 3, group: 'suelo' },
  { key: 'soilMoisture4', label: 'Humedad suelo parcela 4 (%)', parcel: 4, group: 'suelo' },
  { key: 'valve1', label: 'Electroválvula 1', parcel: 1, group: 'valvula' },
  { key: 'valve2', label: 'Electroválvula 2', parcel: 2, group: 'valvula' },
  { key: 'valve3', label: 'Electroválvula 3', parcel: 3, group: 'valvula' },
  { key: 'valve4', label: 'Electroválvula 4', parcel: 4, group: 'valvula' },
  { key: 'airTemp', label: 'Temperatura del aire promedio (°C)', group: 'general' },
  { key: 'relHumidity', label: 'Humedad relativa promedio (%)', group: 'general' },
  { key: 'soilTemp', label: 'Temperatura del suelo (°C)', group: 'general' },
  { key: 'solarRadiation', label: 'Radiación solar (W/m²)', group: 'general' },
];

export const DEFAULT_EXPORT: ExportColumn[] = EXPORT_COLUMNS.filter((c) => c.group !== 'general').map((c) => c.key);

const valveText = (v: boolean | null | undefined) => (v === true ? 'ABIERTA' : v === false ? 'CERRADA' : '');

function cellOf(r: ClimateRecord, key: ExportColumn): Cell {
  if (key.startsWith('valve')) return valveText(r[key as 'valve1']);
  const v = r[key as NumericKey];
  return isNum(v) ? +v.toFixed(Math.max(VARIABLES[key as NumericKey].decimals, 1)) : null;
}

export function historyRows(records: ClimateRecord[], columns: ExportColumn[]): Cell[][] {
  const cols = EXPORT_COLUMNS.filter((c) => columns.includes(c.key));
  return [
    ['Fecha', 'Hora', ...cols.map((c) => c.label), 'Origen', 'Validación'],
    ...records.map((r) => [fmtDate(r.date), r.time, ...cols.map((c) => cellOf(r, c.key)), r.source, r.validation ?? 'valido']),
  ];
}

export function valveEventRows(events: ValveEvent[]): Cell[][] {
  return [
    ['Parcela', 'Electroválvula', 'Fecha', 'Hora de inicio', 'Hora de finalización', 'Duración (min)', 'Modo', 'Motivo de activación', 'Motivo de cierre', 'Origen'],
    ...[...events]
      .sort((a, b) => a.start - b.start)
      .map((e) => {
        const s = fmtDateTime(e.start);
        return [
          `Parcela ${e.parcel}`, `EV-${e.parcel}`, s.slice(0, 10), s.slice(11), e.end ? fmtDateTime(e.end).slice(11) : 'En curso',
          e.end ? Math.round((e.end - e.start) / 60000) : null, MODE_LABELS[e.mode], e.reason, e.closeReason ?? '', e.origin,
        ];
      }),
  ];
}

export function exportSystemHistory(opts: { records: ClimateRecord[]; events: ValveEvent[]; columns: ExportColumn[]; from?: string; to?: string; parcel?: ParcelId | null; isDemo: boolean; all?: boolean }) {
  const records = [...opts.records].sort((a, b) => a.ts - b.ts);
  const info: Cell[][] = [
    ['Histórico del sistema de riego – InverClima'],
    [opts.isDemo ? 'DATOS DE DEMOSTRACIÓN — valores simulados' : 'Datos reales'],
    [],
    ['Periodo', opts.all ? 'Todo el histórico' : `${opts.from ? fmtDate(opts.from) : 'inicio'} al ${opts.to ? fmtDate(opts.to) : 'hoy'}`],
    ['Parcela', opts.parcel ? `Parcela ${opts.parcel}` : 'Todas'],
    ['Registros', records.length],
    ['Activaciones de electroválvulas', opts.events.length],
    ['Generado', fmtDateTime(Date.now())],
  ];
  const name = safeFileName(`historico_riego_${opts.isDemo ? 'DEMO_' : ''}${opts.all ? 'completo' : `${opts.from ?? ''}_${opts.to ?? todayISO()}`}${opts.parcel ? `_parcela${opts.parcel}` : ''}`);
  downloadXLSX(
    [
      { name: 'Histórico', rows: historyRows(records, opts.columns) },
      { name: 'Activaciones', rows: valveEventRows(opts.events) },
      { name: 'Información', rows: info, widths: [32, 60] },
    ],
    `${name}.xlsx`,
  );
}

export function exportValveEvents(events: ValveEvent[], isDemo: boolean) {
  downloadXLSX([{ name: 'Activaciones', rows: valveEventRows(events) }], `${safeFileName(`activaciones_valvulas_${isDemo ? 'DEMO_' : ''}${todayISO()}`)}.xlsx`);
}

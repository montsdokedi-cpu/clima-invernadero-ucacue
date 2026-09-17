import * as XLSX from 'xlsx';
import type { ClimateRecord } from '../db/types';
import { downloadBlob } from '../lib/download';
import { RECORD_HEADERS, recordRows, type Lookup } from './tables';

type Cell = string | number | null;
export interface SheetSpec {
  name: string;
  rows: Cell[][];
  widths?: number[];
}

function csvEscape(v: Cell): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV estándar (coma como separador, punto decimal, UTF-8 con BOM). */
export function toCSV(rows: Cell[][]): string {
  return '﻿' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

export function downloadCSV(rows: Cell[][], filename: string) {
  downloadBlob(new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' }), filename);
}

export function downloadXLSX(sheets: SheetSpec[], filename: string) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    const widths = s.widths ?? (s.rows[0] ?? []).map((_, i) => Math.min(48, Math.max(10, ...s.rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))));
    ws['!cols'] = widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

export function exportRecords(records: ClimateRecord[], lk: Lookup, format: 'csv' | 'xlsx', baseName: string) {
  const rows = [RECORD_HEADERS, ...recordRows(records, lk)];
  if (format === 'csv') downloadCSV(rows, `${baseName}.csv`);
  else downloadXLSX([{ name: 'Registros', rows }], `${baseName}.xlsx`);
}

export function downloadTemplate(format: 'csv' | 'xlsx') {
  const rows: Cell[][] = [
    ['Fecha', 'Hora', 'Temperatura', 'Humedad relativa', 'Sensor', 'Cultivo', 'Temperatura suelo', 'Humedad suelo', 'Observaciones'],
    ['14/09/2026', '08:00', 22.5, 78, 'SHT31-01', 'Tomate', 21, 65, 'Cielo parcialmente nublado'],
    ['14/09/2026', '08:30', 23.4, 75, 'SHT31-01', 'Tomate', 21.2, 64, ''],
    ['14/09/2026', '09:00', 24.6, 71, 'SHT31-01', 'Tomate', 21.5, 64, 'Cortinas laterales abiertas'],
  ];
  if (format === 'csv') downloadCSV(rows, 'plantilla_sensores_invernadero_ucacue.csv');
  else downloadXLSX([{ name: 'Registros', rows }], 'plantilla_sensores_invernadero_ucacue.xlsx');
}

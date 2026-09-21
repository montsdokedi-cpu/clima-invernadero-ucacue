import { Download, FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import { db } from '../db/db';
import { PARCEL_IDS, type ParcelId } from '../db/types';
import { todayISO, toTimestamp } from '../lib/dates';
import { DEFAULT_EXPORT, EXPORT_COLUMNS, exportSystemHistory, type ExportColumn } from '../reports/sensorExport';
import { useData } from '../state/DataContext';
import { useToast } from '../state/Toast';
import { Field, Modal } from './ui';

const GROUPS = { ambiente: 'Puntos ambientales', suelo: 'Humedad del suelo', valvula: 'Electroválvulas', general: 'Variables generales' } as const;

/** Exportación del histórico del sistema de 4 parcelas a Excel (.xlsx) */
export function SystemExportModal({ onClose }: { onClose: () => void }) {
  const { historyRecords, isDemo } = useData();
  const toast = useToast();
  const first = historyRecords[0]?.date ?? todayISO();
  const [from, setFrom] = useState(first);
  const [to, setTo] = useState(todayISO());
  const [parcel, setParcel] = useState<'todas' | `${ParcelId}`>('todas');
  const [cols, setCols] = useState<ExportColumn[]>(DEFAULT_EXPORT);

  const visible = EXPORT_COLUMNS.filter((c) => parcel === 'todas' || !c.parcel || String(c.parcel) === parcel);
  const chosen = cols.filter((c) => visible.some((v) => v.key === c));

  const run = async (all: boolean) => {
    const [a, b] = from <= to ? [from, to] : [to, from];
    const p = parcel === 'todas' ? null : (Number(parcel) as ParcelId);
    const records = all ? historyRecords : historyRecords.filter((r) => r.date >= a && r.date <= b);
    const events = (await db.valveEvents.filter((e) => e.isDemo === isDemo).toArray()).filter(
      (e) => (all || (e.start >= toTimestamp(a, '00:00') && e.start <= toTimestamp(b, '23:59') + 59999)) && (!p || e.parcel === p),
    );
    const columns = all ? EXPORT_COLUMNS.map((c) => c.key) : chosen;
    if (!columns.length) return toast('Selecciona al menos una variable.', 'error');
    exportSystemHistory({ records, events, columns, from: a, to: b, parcel: all ? null : p, isDemo, all });
    toast(`Excel generado: ${records.length} registros y ${events.length} activaciones.`);
    onClose();
  };

  return (
    <Modal
      title="Descargar histórico en Excel (.xlsx)"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-secondary" onClick={() => run(true)}><Download size={16} /> Descargar todo el histórico</button>
          <button className="btn btn-primary" onClick={() => run(false)}><FileSpreadsheet size={16} /> Descargar selección</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Fecha inicial" htmlFor="ex-from"><input id="ex-from" type="date" max={todayISO()} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
        <Field label="Fecha final" htmlFor="ex-to"><input id="ex-to" type="date" max={todayISO()} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
        <Field label="Parcela" htmlFor="ex-parcel">
          <select id="ex-parcel" value={parcel} onChange={(e) => setParcel(e.target.value as typeof parcel)}>
            <option value="todas">Todas</option>
            {PARCEL_IDS.map((n) => <option key={n} value={n}>Parcela {n}</option>)}
          </select>
        </Field>
      </div>
      <h3 style={{ fontSize: 14, margin: '16px 0 6px' }}>Variables</h3>
      {(Object.keys(GROUPS) as (keyof typeof GROUPS)[]).map((g) => {
        const items = visible.filter((c) => c.group === g);
        if (!items.length) return null;
        return (
          <div key={g} style={{ marginBottom: 8 }}>
            <strong className="small muted">{GROUPS[g]}</strong>
            <div className="export-vars">
              {items.map((c) => (
                <label key={c.key} className="check" style={{ padding: '4px 0' }}>
                  <input id={`ex-${c.key}`} type="checkbox" checked={cols.includes(c.key)} onChange={(e) => setCols((cs) => (e.target.checked ? [...cs, c.key] : cs.filter((x) => x !== c.key)))} />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
        );
      })}
      <p className="small muted" style={{ marginTop: 8 }}>El archivo incluye siempre Fecha y Hora, la hoja «Activaciones» con el historial de electroválvulas y una hoja de información. «Descargar todo el histórico» exporta todas las variables y todas las fechas.</p>
    </Modal>
  );
}

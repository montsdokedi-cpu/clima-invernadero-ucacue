import { useLiveQuery } from 'dexie-react-hooks';
import { FileSpreadsheet, History as HistoryIcon, ShowerHead, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AmbientCards, Esp32StatusCard, ParcelCard, ParcelConfigForm } from '../components/irrigation';
import { AlertItem, Field, PageHeader } from '../components/ui';
import { db } from '../db/db';
import { MODE_HELP, MODE_LABELS, PARCEL_IDS, type IrrigationMode } from '../db/types';
import { fmtDateTime, todayISO, toTimestamp } from '../lib/dates';
import { fmtDuration } from '../lib/irrigation';
import { exportValveEvents } from '../reports/sensorExport';
import { useData } from '../state/DataContext';
import { useEsp32 } from '../state/Esp32Context';
import { useToast } from '../state/Toast';

const ORIGIN_LABELS = { esp32: 'ESP32', app: 'Aplicación (reglas)', manual: 'Manual', demo: 'Demostración' } as const;

/** Último registro guardado que contiene datos del sistema de parcelas */
export function useLastSystemRecord() {
  const { historyRecords } = useData();
  return useMemo(() => {
    for (let i = historyRecords.length - 1; i >= 0; i--) {
      const r = historyRecords[i];
      if (r.airTemp1 != null || r.airTemp2 != null || r.soilMoisture1 != null || r.soilMoisture2 != null || r.soilMoisture3 != null || r.soilMoisture4 != null) return r;
    }
    return null;
  }, [historyRecords]);
}

export default function Irrigation() {
  const { ready, isDemo } = useData();
  const esp = useEsp32();
  const toast = useToast();
  const last = useLastSystemRecord();
  const [parcelFilter, setParcelFilter] = useState<'all' | '1' | '2' | '3' | '4'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const events = useLiveQuery(() => db.valveEvents.orderBy('start').reverse().filter((e) => e.isDemo === isDemo).toArray(), [isDemo]) ?? [];

  const filtered = events.filter(
    (e) =>
      (parcelFilter === 'all' || String(e.parcel) === parcelFilter) &&
      (!from || e.start >= toTimestamp(from, '00:00')) &&
      (!to || e.start <= toTimestamp(to, '23:59') + 59999),
  );

  if (!ready) return <div className="loading">Cargando…</div>;

  const r = esp.connected ? esp.reading : null;
  const soil = (n: number) => (r ? r.soil[n - 1] : last ? (last[`soilMoisture${n}` as 'soilMoisture1'] ?? null) : null);
  const valve = (n: number) => (r ? r.valves[n - 1] : last ? (last[`valve${n}` as 'valve1'] ?? null) : null);

  return (
    <>
      <PageHeader
        title="Riego y parcelas"
        description="4 parcelas (sensor de humedad del suelo + electroválvula), 2 puntos ambientales y el ESP32 por Wi-Fi."
        icon={<ShowerHead size={22} />}
      />

      <div className="grid-main-side">
        <Esp32StatusCard />
        <section className="card card-pad">
          <h3 className="card-title">Alertas del sistema <span className="count">{esp.alerts.length || ''}</span></h3>
          {esp.alerts.length === 0 ? (
            <div className="notice ok">{esp.transportKind ? 'Sin alertas: sensores, electroválvulas y conexión funcionan.' : 'Las alertas se activan cuando se configura la conexión con el ESP32.'}</div>
          ) : (
            <div className="alert-list" style={{ maxHeight: 300, overflowY: 'auto' }}>{esp.alerts.map((a) => <AlertItem key={a.id} alert={a} compact />)}</div>
          )}
        </section>
      </div>

      <div className="section-head"><h2>Condiciones ambientales</h2></div>
      <AmbientCards
        t1={r ? r.airTemp1 : last?.airTemp1} h1={r ? r.relHumidity1 : last?.relHumidity1}
        t2={r ? r.airTemp2 : last?.airTemp2} h2={r ? r.relHumidity2 : last?.relHumidity2}
        ts={last?.ts}
      />

      <div className="section-head">
        <h2>Parcelas</h2>
        <p>Cada electroválvula funciona de forma independiente</p>
      </div>
      <div className="parcel-grid">
        {esp.parcels.map((p) => <ParcelCard key={p.key} parcel={p} soil={soil(p.n)} valve={valve(p.n)} lastTs={last?.ts} />)}
      </div>

      <details className="card card-pad" style={{ marginTop: 16 }}>
        <summary className="card-title" style={{ cursor: 'pointer', marginBottom: 0 }}><SlidersHorizontal size={17} className="text-green" /> Configuración de umbrales y modos por parcela</summary>
        <div className="notice warn" style={{ margin: '12px 0' }}>
          <span>Los umbrales son <strong>configurables</strong> y no tienen valores agronómicos predefinidos: defínelos según el cultivo, el sustrato, la calibración de los sensores y la bibliografía. Una parcela con umbrales vacíos no se activa sola.</span>
        </div>
        <div className="parcel-forms">
          {esp.parcels.map((p) => (
            <div key={p.key} className="card card-pad">
              <h3>{p.name}</h3>
              <ParcelConfigForm key={p.updatedAt} parcel={p} />
            </div>
          ))}
        </div>
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="data-table">
            <thead><tr><th>Modo</th><th>Funcionamiento</th></tr></thead>
            <tbody>{(Object.keys(MODE_LABELS) as IrrigationMode[]).map((m) => <tr key={m}><td><strong>{MODE_LABELS[m]}</strong></td><td className="small">{MODE_HELP[m]}</td></tr>)}</tbody>
          </table>
        </div>
      </details>

      <div className="section-head">
        <h2><HistoryIcon size={18} className="text-green" /> Historial de activaciones</h2>
        <p>{events.length} activaciones registradas</p>
      </div>
      <section className="card">
        <div className="table-toolbar">
          <Field label="Parcela" htmlFor="ev-parcel">
            <select id="ev-parcel" value={parcelFilter} onChange={(e) => setParcelFilter(e.target.value as typeof parcelFilter)}>
              <option value="all">Todas</option>
              {PARCEL_IDS.map((n) => <option key={n} value={n}>Parcela {n}</option>)}
            </select>
          </Field>
          <Field label="Desde" htmlFor="ev-from"><input id="ev-from" type="date" max={todayISO()} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Hasta" htmlFor="ev-to"><input id="ev-to" type="date" max={todayISO()} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <button className="btn btn-secondary btn-sm" disabled={!filtered.length} onClick={() => { exportValveEvents(filtered, isDemo); toast(`Se exportaron ${filtered.length} activaciones.`); }}>
            <FileSpreadsheet size={15} /> Excel
          </button>
        </div>
        <div className="table-wrap">
          <table className="data-table responsive">
            <thead><tr><th>Parcela</th><th>Electroválvula</th><th>Fecha</th><th>Inicio</th><th>Fin</th><th>Duración</th><th>Modo</th><th>Motivo</th><th>Origen</th></tr></thead>
            <tbody>
              {filtered.slice(0, 200).map((e) => {
                const s = fmtDateTime(e.start);
                return (
                  <tr key={e.id}>
                    <td data-label="Parcela"><strong>Parcela {e.parcel}</strong></td>
                    <td data-label="Electroválvula">EV-{e.parcel}</td>
                    <td data-label="Fecha">{s.slice(0, 10)}</td>
                    <td data-label="Inicio">{s.slice(11)}</td>
                    <td data-label="Fin">{e.end ? fmtDateTime(e.end).slice(11) : <span className="valve-state open">EN CURSO</span>}</td>
                    <td data-label="Duración" className="num">{fmtDuration((e.end ?? Date.now()) - e.start)}</td>
                    <td data-label="Modo">{MODE_LABELS[e.mode]}</td>
                    <td data-label="Motivo" className="small" style={{ maxWidth: 320 }}>{e.reason}{e.closeReason ? <><br /><span className="muted">Cierre: {e.closeReason}</span></> : null}</td>
                    <td data-label="Origen" className="small">{ORIGIN_LABELS[e.origin]}</td>
                  </tr>
                );
              })}
              {!filtered.length && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 24 }}>Aún no hay activaciones registradas.</td></tr>}
            </tbody>
          </table>
        </div>
        {filtered.length > 200 && <p className="small muted" style={{ padding: '8px 16px' }}>Se muestran 200 de {filtered.length}. Exporta a Excel para ver todas.</p>}
      </section>
    </>
  );
}

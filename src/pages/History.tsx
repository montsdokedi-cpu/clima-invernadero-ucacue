import { ArrowUpDown, ChevronLeft, ChevronRight, ClipboardPen, Eye, FileSpreadsheet, FileDown, History as HistoryIcon, Pencil, Search, Trash2, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SourceBadge, ValidationBadge } from '../components/agro';
import { ConfirmModal, EmptyState, Modal, PageHeader } from '../components/ui';
import { db } from '../db/db';
import { SOURCE_LABELS, VALIDATION_LABELS, type ClimateRecord, type ClimateThreshold, type DataValidation, type RecordSource } from '../db/types';
import { thresholdFor } from '../lib/alerts';
import { fmtDate, fmtDateTime, todayISO } from '../lib/dates';
import { safeFileName } from '../lib/download';
import { fmt, fmtVar, isNum, VARIABLES, type NumericKey } from '../lib/variables';
import { exportRecords } from '../reports/spreadsheet';
import { useData } from '../state/DataContext';
import { useToast } from '../state/Toast';

function cellClass(r: ClimateRecord, key: 'airTemp' | 'relHumidity', th?: ClimateThreshold) {
  if (!th) return '';
  const v = r[key];
  const [lo, hi, margin] = key === 'airTemp' ? [th.tempMin, th.tempMax, 3] : [th.humidityMin, th.humidityMax, 10];
  if (v > hi) return v - hi >= margin ? 'cell-danger' : 'cell-warning';
  if (v < lo) return lo - v >= margin ? 'cell-danger' : 'cell-warning';
  return '';
}

export default function History() {
  const { ready, historyRecords, crops, cropById, greenhouseById, thresholds, isDemo } = useData();
  const navigate = useNavigate();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [cropFilter, setCropFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | RecordSource>('all');
  const [validationFilter, setValidationFilter] = useState<'all' | DataValidation>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [desc, setDesc] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<ClimateRecord | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = historyRecords.filter((r) => {
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      if (sourceFilter !== 'all' && r.source !== sourceFilter) return false;
      if (validationFilter !== 'all' && (r.validation ?? 'valido') !== validationFilter) return false;
      if (cropFilter === 'none' && r.cropId) return false;
      if (cropFilter !== 'all' && cropFilter !== 'none' && String(r.cropId) !== cropFilter) return false;
      if (!q) return true;
      const crop = r.cropId ? cropById.get(r.cropId)?.name ?? '' : '';
      return [fmtDate(r.date), r.time, r.observations, r.cropObservations, r.recordedBy, r.outsideWeather, crop, r.phenologicalStage, r.sensorId, r.validationNote, String(r.airTemp), String(r.relHumidity)]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
    return desc ? out.reverse() : out;
  }, [historyRecords, search, cropFilter, sourceFilter, validationFilter, from, to, desc, cropById]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * pageSize, current * pageSize);
  const detail = detailId !== null ? historyRecords.find((r) => r.id === detailId) ?? null : null;

  if (!ready) return <div className="loading">Cargando…</div>;

  const lookup = { greenhouseById, cropById };
  const exportAs = (format: 'csv' | 'xlsx') => {
    const sorted = [...filtered].sort((a, b) => a.ts - b.ts);
    exportRecords(sorted, lookup, format, safeFileName(`registros_clima_${isDemo ? 'DEMO_' : ''}${todayISO()}`));
    toast(`Se exportaron ${sorted.length} registros.`);
  };
  const reset = (fn: () => void) => { fn(); setPage(1); };
  const setValidation = async (r: ClimateRecord, v: DataValidation) => {
    await db.climateRecords.update(r.id!, { validation: v, validationNote: v === 'valido' ? '' : r.validationNote || (v === 'descartado' ? 'Descartado tras revisión' : ''), updatedAt: Date.now() });
    toast(`Registro marcado como «${VALIDATION_LABELS[v]}».`);
  };
  const hasFilters = search || from || to || cropFilter !== 'all' || sourceFilter !== 'all' || validationFilter !== 'all';

  return (
    <>
      <PageHeader
        title="Historial de registros"
        description={`${historyRecords.length.toLocaleString('es-EC')} registros almacenados · origen y estado de validación de cada dato`}
        icon={<HistoryIcon size={22} />}
        actions={
          <>
            <Link to="/importar" className="btn btn-secondary"><Upload size={17} /> Importar</Link>
            <button className="btn btn-secondary" onClick={() => exportAs('csv')} disabled={!filtered.length}><FileDown size={17} /> CSV</button>
            <button className="btn btn-secondary" onClick={() => exportAs('xlsx')} disabled={!filtered.length}><FileSpreadsheet size={17} /> Excel</button>
          </>
        }
      />

      {historyRecords.length === 0 ? (
        <EmptyState icon={<HistoryIcon size={30} />} title="No hay registros todavía" action={<span className="empty-actions"><Link to="/importar" className="btn btn-primary"><Upload size={17} /> Importar datos de sensores</Link><Link to="/registrar" className="btn btn-secondary"><ClipboardPen size={17} /> Registro manual</Link></span>}>
          Los registros aparecerán aquí ordenados por fecha y hora.
        </EmptyState>
      ) : (
        <section className="card">
          <div className="table-toolbar">
            <div className="field search">
              <label htmlFor="q">Buscar</label>
              <div style={{ position: 'relative' }}>
                <Search size={16} style={{ position: 'absolute', left: 10, top: 12, color: 'var(--muted)' }} />
                <input id="q" type="search" placeholder="Observaciones, sensor, etapa, valor…" style={{ paddingLeft: 32 }} value={search} onChange={(e) => reset(() => setSearch(e.target.value))} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="src">Origen</label>
              <select id="src" value={sourceFilter} onChange={(e) => reset(() => setSourceFilter(e.target.value as 'all' | RecordSource))}>
                <option value="all">Todos</option>
                {(isDemo ? ['demo'] : ['sensor', 'manual', 'importado']).map((s) => <option key={s} value={s}>{SOURCE_LABELS[s as RecordSource]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="val">Validación</label>
              <select id="val" value={validationFilter} onChange={(e) => reset(() => setValidationFilter(e.target.value as 'all' | DataValidation))}>
                <option value="all">Todos</option>
                {(Object.keys(VALIDATION_LABELS) as DataValidation[]).map((v) => <option key={v} value={v}>{VALIDATION_LABELS[v]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="crop">Cultivo</label>
              <select id="crop" value={cropFilter} onChange={(e) => reset(() => setCropFilter(e.target.value))}>
                <option value="all">Todos</option>
                <option value="none">Sin cultivo</option>
                {crops.map((c) => <option key={c.id} value={c.id}>{c.name}{c.variety ? ` (${c.variety})` : ''}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="from">Desde</label>
              <input id="from" type="date" value={from} onChange={(e) => reset(() => setFrom(e.target.value))} />
            </div>
            <div className="field">
              <label htmlFor="to">Hasta</label>
              <input id="to" type="date" value={to} onChange={(e) => reset(() => setTo(e.target.value))} />
            </div>
            {hasFilters && (
              <button className="btn btn-ghost btn-sm" onClick={() => reset(() => { setSearch(''); setFrom(''); setTo(''); setCropFilter('all'); setSourceFilter('all'); setValidationFilter('all'); })}>Limpiar filtros</button>
            )}
          </div>

          <div className="table-wrap">
            <table className="data-table responsive">
              <thead>
                <tr>
                  <th><button className="th-sort" onClick={() => setDesc((d) => !d)} title="Ordenar por fecha">Fecha <ArrowUpDown size={13} /></button></th>
                  <th>Hora</th>
                  <th className="num">Temp. (°C)</th>
                  <th className="num">HR (%)</th>
                  <th className="num">T. suelo</th>
                  <th>Etapa</th>
                  <th>Origen</th>
                  <th>Validación</th>
                  <th>Observaciones</th>
                  <th className="num">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const th = thresholdFor(r, thresholds);
                  return (
                    <tr key={r.id} style={r.validation === 'descartado' ? { opacity: 0.55 } : undefined}>
                      <td data-label="Fecha" className="nowrap"><strong>{fmtDate(r.date)}</strong></td>
                      <td data-label="Hora">{r.time}</td>
                      <td data-label="Temperatura" className="num"><span className={cellClass(r, 'airTemp', th)}>{fmt(r.airTemp)}</span></td>
                      <td data-label="Humedad relativa" className="num"><span className={cellClass(r, 'relHumidity', th)}>{fmt(r.relHumidity, 0)}</span></td>
                      <td data-label="Temp. suelo" className="num">{fmt(r.soilTemp)}</td>
                      <td data-label="Etapa" className="small">{r.phenologicalStage || '—'}</td>
                      <td data-label="Origen"><SourceBadge source={r.source} />{r.sensorId && <span className="small muted"> {r.sensorId}</span>}</td>
                      <td data-label="Validación"><ValidationBadge value={r.validation ?? 'valido'} note={r.validationNote} /></td>
                      <td data-label="Observaciones" className="obs" title={r.observations}>{r.observations || r.cropObservations || '—'}</td>
                      <td className="actions-cell">
                        <div className="row-actions">
                          <button className="icon-btn" title="Ver detalles y validar" aria-label="Ver detalles" onClick={() => setDetailId(r.id!)}><Eye size={17} /></button>
                          <button className="icon-btn" title="Editar" aria-label="Editar" onClick={() => navigate(`/registrar/${r.id}`)}><Pencil size={17} /></button>
                          <button className="icon-btn danger" title="Eliminar" aria-label="Eliminar" onClick={() => setToDelete(r)}><Trash2 size={17} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={10} style={{ textAlign: 'center', padding: 30 }} className="muted">Ningún registro coincide con los filtros.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <span className="muted">
              {filtered.length ? `${(current - 1) * pageSize + 1}–${Math.min(current * pageSize, filtered.length)} de ${filtered.length}` : '0 registros'}
            </span>
            <div className="pager">
              <select id="page-size" value={pageSize} onChange={(e) => reset(() => setPageSize(Number(e.target.value)))} aria-label="Registros por página">
                {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} / página</option>)}
              </select>
              <button className="btn btn-secondary btn-sm" disabled={current <= 1} onClick={() => setPage(current - 1)} aria-label="Anterior"><ChevronLeft size={16} /></button>
              <span className="num">{current} / {pages}</span>
              <button className="btn btn-secondary btn-sm" disabled={current >= pages} onClick={() => setPage(current + 1)} aria-label="Siguiente"><ChevronRight size={16} /></button>
            </div>
          </div>
        </section>
      )}

      {detail && (
        <Modal
          title={`Registro del ${fmtDate(detail.date)} · ${detail.time}`}
          onClose={() => setDetailId(null)}
          wide
          footer={<><button className="btn btn-ghost" onClick={() => setDetailId(null)}>Cerrar</button><button className="btn btn-primary" onClick={() => navigate(`/registrar/${detail.id}`)}><Pencil size={16} /> Editar</button></>}
        >
          <div className="notice info" style={{ marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ flex: 1, minWidth: 180 }}>
              Estado: <ValidationBadge value={detail.validation ?? 'valido'} />{detail.validationNote && <> · {detail.validationNote}</>}
            </span>
            <span className="quick-actions">
              {(Object.keys(VALIDATION_LABELS) as DataValidation[]).filter((v) => v !== (detail.validation ?? 'valido')).map((v) => (
                <button key={v} className={`btn btn-sm ${v === 'descartado' ? 'btn-danger-outline' : 'btn-secondary'}`} onClick={() => setValidation(detail, v)}>Marcar {VALIDATION_LABELS[v].toLowerCase()}</button>
              ))}
            </span>
          </div>
          <dl className="detail-list">
            <div><dt>Origen</dt><dd><SourceBadge source={detail.source} /></dd></div>
            <div><dt>Sensor</dt><dd>{detail.sensorId || '—'}</dd></div>
            <div><dt>Invernadero</dt><dd>{greenhouseById.get(detail.greenhouseId)?.name ?? '—'}</dd></div>
            <div><dt>Cultivo</dt><dd>{detail.cropId ? cropById.get(detail.cropId)?.name ?? '—' : '—'}</dd></div>
            {(Object.keys(VARIABLES) as NumericKey[]).filter((k) => isNum(detail[k])).map((k) => (
              <div key={k}><dt>{VARIABLES[k].label}</dt><dd>{fmtVar(k, detail[k])}</dd></div>
            ))}
            <div><dt>Etapa fenológica</dt><dd>{detail.phenologicalStage || '—'}</dd></div>
            <div><dt>Responsable</dt><dd>{detail.recordedBy || '—'}</dd></div>
            <div><dt>Método de medición</dt><dd>{detail.method || '—'}</dd></div>
            <div><dt>Clima exterior</dt><dd>{detail.outsideWeather || '—'}</dd></div>
            <div className="full"><dt>Observaciones de manejo</dt><dd>{detail.observations || '—'}</dd></div>
            <div className="full"><dt>Observaciones del cultivo</dt><dd>{detail.cropObservations || '—'}</dd></div>
            <div><dt>Última modificación</dt><dd>{fmtDateTime(detail.updatedAt)}</dd></div>
          </dl>
        </Modal>
      )}

      {toDelete && (
        <ConfirmModal
          title="Eliminar registro"
          message={<>¿Eliminar el registro del <strong>{fmtDate(toDelete.date)} a las {toDelete.time}</strong> ({fmt(toDelete.airTemp)} °C, {fmt(toDelete.relHumidity, 0)} %)? Esta acción no se puede deshacer. Si el dato es erróneo, puedes marcarlo como «Descartado» para conservarlo fuera del análisis.</>}
          onClose={() => setToDelete(null)}
          onConfirm={async () => {
            await db.climateRecords.delete(toDelete.id!);
            toast('Registro eliminado.');
          }}
        />
      )}
    </>
  );
}

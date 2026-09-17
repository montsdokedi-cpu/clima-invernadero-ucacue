import { CircleCheck, Cpu, FileSpreadsheet, FileUp, Info, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Field, PageHeader, Segmented } from '../components/ui';
import { db } from '../db/db';
import { MEASUREMENT_METHODS } from '../db/types';
import { fmtDate } from '../lib/dates';
import { autoMap, buildImportRows, IMPORT_FIELDS, readImportFile, type ImportField, type ParsedSheet } from '../lib/importer';
import { downloadTemplate } from '../reports/spreadsheet';
import { useData } from '../state/DataContext';
import { useToast } from '../state/Toast';

type RowFilter = 'all' | 'ok' | 'error' | 'duplicate' | 'warn';

export default function ImportData() {
  const { ready, greenhouses, crops, allRecords, isDemo, settings } = useData();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<(ImportField | '')[]>([]);
  const [drag, setDrag] = useState(false);
  const [greenhouseId, setGreenhouseId] = useState('');
  const [cropId, setCropId] = useState('');
  const [recordedBy, setRecordedBy] = useState('');
  const [origin, setOrigin] = useState<'sensor' | 'importado'>('sensor');
  const [sensorId, setSensorId] = useState('');
  const [method, setMethod] = useState('Sensor / datalogger');
  const [filter, setFilter] = useState<RowFilter>('all');
  const [result, setResult] = useState<{ imported: number; skipped: number; suspicious: number; missing: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const ghId = Number(greenhouseId || settings.defaultGreenhouseId || greenhouses[0]?.id || 0);
  const ghValid = greenhouses.some((g) => g.id === ghId) ? ghId : greenhouses[0]?.id ?? 0;
  const ghCrops = crops.filter((c) => c.greenhouseId === ghValid);
  const defaultCropId = cropId === '' ? ghCrops.find((c) => c.active)?.id ?? null : cropId === 'none' ? null : Number(cropId);

  async function load(f: File, sheetName?: string) {
    try {
      const parsed = await readImportFile(f, sheetName);
      setFile(f);
      setSheet(parsed);
      setMapping(autoMap(parsed.headers));
      setResult(null);
      if (parsed.rows.length === 0) toast('El archivo no contiene filas de datos.', 'error');
    } catch (e) {
      toast(`No se pudo leer el archivo: ${(e as Error).message}`, 'error');
    }
  }

  const existingKeys = useMemo(() => new Set(allRecords.map((r) => `${r.greenhouseId}|${r.date}|${r.time}`)), [allRecords]);
  const rows = useMemo(
    () =>
      sheet
        ? buildImportRows(sheet, mapping, { greenhouseId: ghValid, cropId: defaultCropId, crops, recordedBy: recordedBy.trim(), method, source: origin, sensorId, isDemo }, existingKeys)
        : [],
    [sheet, mapping, ghValid, defaultCropId, crops, recordedBy, method, origin, sensorId, isDemo, existingKeys],
  );
  const ok = rows.filter((r) => r.status === 'ok');
  const errors = rows.filter((r) => r.status === 'error');
  const dups = rows.filter((r) => r.status === 'duplicate');
  const withMissing = rows.filter((r) => r.missing.length > 0);
  const suspicious = ok.filter((r) => r.validation === 'sospechoso');
  const warned = rows.filter((r) => r.warnings.length > 0);
  const missingRequired = IMPORT_FIELDS.filter((f) => ['date', 'airTemp', 'relHumidity'].includes(f.key) && !mapping.includes(f.key));
  const timeMissing = !mapping.includes('time');
  const shown = rows.filter((r) => filter === 'all' || (filter === 'warn' ? r.warnings.length > 0 : r.status === filter)).slice(0, 300);
  const step = result ? 3 : sheet ? 2 : 1;
  const range = ok.length ? [ok.reduce((a, b) => (b.record!.ts < a.record!.ts ? b : a)).record!, ok.reduce((a, b) => (b.record!.ts > a.record!.ts ? b : a)).record!] : null;

  async function doImport() {
    setBusy(true);
    try {
      await db.climateRecords.bulkAdd(ok.map((r) => r.record!));
      setResult({ imported: ok.length, skipped: errors.length + dups.length, suspicious: suspicious.length, missing: withMissing.filter((r) => r.status === 'ok').length });
      toast(`Se importaron ${ok.length} registros.`);
    } catch (e) {
      toast(`Error al importar: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <div className="loading">Cargando…</div>;

  return (
    <>
      <PageHeader
        title="Importar datos de sensores"
        description="Carga los archivos del sensor o datalogger del invernadero (Excel, CSV o JSON) con vista previa y validación."
        icon={<Upload size={22} />}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => downloadTemplate('xlsx')}><FileSpreadsheet size={17} /> Plantilla Excel</button>
            <button className="btn btn-secondary" onClick={() => downloadTemplate('csv')}>Plantilla CSV</button>
          </>
        }
      />

      <div className="steps">
        {['Seleccionar archivo', 'Revisar columnas y validar', 'Resultado'].map((s, i) => (
          <span key={s} className={`step ${step === i + 1 ? 'active' : step > i + 1 ? 'done' : ''}`}>
            <b>{i + 1}</b>{s}{i < 2 && <span className="step-sep"> —</span>}
          </span>
        ))}
      </div>

      {isDemo && (
        <div className="notice warn" style={{ marginBottom: 16 }}>
          <Info size={18} /><span>Estás en <strong>modo demostración</strong>: lo que importes se guardará como datos de demostración. Para importar datos reales del invernadero, cambia a «Datos reales» en Configuración.</span>
        </div>
      )}

      {result ? (
        <section className="card card-pad" style={{ textAlign: 'center' }}>
          <CircleCheck size={48} className="text-green" />
          <h2 style={{ margin: '10px 0 6px' }}>Importación completada</h2>
          <p className="muted">
            Se importaron <strong>{result.imported}</strong> registros con origen «{isDemo ? 'Demostración' : origin === 'sensor' ? 'Sensor' : 'Importado'}» desde «{file?.name}».
            {result.skipped ? ` Se omitieron ${result.skipped} filas con errores o duplicadas.` : ''}
            {result.suspicious ? ` ${result.suspicious} quedaron marcadas como sospechosas para revisión.` : ''}
            {result.missing ? ` ${result.missing} tienen datos faltantes en variables opcionales.` : ''}
          </p>
          <div className="empty-actions">
            <Link to="/problemas" className="btn btn-primary">Analizar problemas climáticos</Link>
            <Link to="/historial" className="btn btn-secondary">Ver historial</Link>
            <button className="btn btn-ghost" onClick={() => { setSheet(null); setFile(null); setResult(null); }}>Importar otro archivo</button>
          </div>
        </section>
      ) : (
        <div className="stack">
          <section className="card card-pad">
            <input ref={inputRef} id="import-file" type="file" accept=".xlsx,.xls,.csv,.txt,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ''; }} />
            <div
              className={`dropzone ${drag ? 'drag' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) load(f); }}
            >
              <FileUp size={36} className="text-green" />
              <strong>{file ? file.name : 'Toca para elegir el archivo del sensor o arrástralo aquí'}</strong>
              <span className="muted small">Excel (.xlsx, .xls), CSV y JSON. Estructura sugerida: Fecha | Hora | Temperatura | Humedad relativa | Sensor | Cultivo</span>
            </div>
            {sheet && sheet.sheetNames.length > 1 && (
              <div style={{ marginTop: 12, maxWidth: 320 }}>
                <Field label="Hoja del libro" htmlFor="sheet-name">
                  <select id="sheet-name" value={sheet.sheetName} onChange={(e) => file && load(file, e.target.value)}>
                    {sheet.sheetNames.map((n) => <option key={n}>{n}</option>)}
                  </select>
                </Field>
              </div>
            )}
          </section>

          {sheet && (
            <>
              <section className="card card-pad">
                <h3 className="card-title"><Cpu size={17} className="text-green" /> Origen de los datos</h3>
                {!isDemo && (
                  <Segmented
                    value={origin}
                    onChange={(v) => { setOrigin(v); setMethod(v === 'sensor' ? 'Sensor / datalogger' : 'Termohigrómetro digital'); }}
                    options={[{ value: 'sensor', label: 'Sensor / datalogger' }, { value: 'importado', label: 'Hoja de cálculo (registro manual previo)' }]}
                  />
                )}
                <p className="small muted" style={{ margin: '8px 0 12px' }}>
                  {origin === 'sensor' ? 'Los registros se guardarán con origen «Sensor».' : 'Los registros se guardarán con origen «Importado».'} El origen se conserva para diferenciar los datos en el análisis y los reportes.
                </p>
                <div className="form-grid">
                  <Field label="Invernadero" htmlFor="imp-gh" required>
                    <select id="imp-gh" value={ghValid} onChange={(e) => setGreenhouseId(e.target.value)}>
                      {greenhouses.map((g) => <option key={g.id} value={g.id}>{g.code} · {g.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Cultivo (si el archivo no lo indica)" htmlFor="imp-crop" hint="La etapa se asigna según la cronología del cultivo">
                    <select id="imp-crop" value={cropId === '' ? String(defaultCropId ?? 'none') : cropId} onChange={(e) => setCropId(e.target.value)}>
                      <option value="none">Sin cultivo asociado</option>
                      {ghCrops.map((c) => <option key={c.id} value={c.id}>{c.name}{c.variety ? ` (${c.variety})` : ''}</option>)}
                    </select>
                  </Field>
                  <Field label="Identificador del sensor (si el archivo no lo indica)" htmlFor="imp-sensor">
                    <input id="imp-sensor" type="text" value={sensorId} onChange={(e) => setSensorId(e.target.value)} placeholder="SHT31-01" />
                  </Field>
                  <Field label="Método de medición" htmlFor="imp-method">
                    <select id="imp-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                      {MEASUREMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </Field>
                  <Field label="Responsable de la descarga" htmlFor="imp-resp">
                    <input id="imp-resp" type="text" value={recordedBy} onChange={(e) => setRecordedBy(e.target.value)} placeholder={settings.defaultResponsible || 'Nombre'} />
                  </Field>
                </div>
              </section>

              <section className="card card-pad">
                <h3 className="card-title">Correspondencia de columnas</h3>
                <p className="muted small" style={{ marginBottom: 12 }}>Las columnas se reconocieron por su nombre. Corrige cualquier asignación si es necesario.</p>
                <div className="form-grid">
                  {sheet.headers.map((h, i) => (
                    <Field key={i} label={`«${h}»`} htmlFor={`map-${i}`} hint={`Ej.: ${String(sheet.rows[0]?.[i] ?? '—')}`}>
                      <select id={`map-${i}`} value={mapping[i] ?? ''} onChange={(e) => { const v = e.target.value as ImportField | ''; setMapping((m) => m.map((x, j) => (j === i ? v : x === v && v ? '' : x))); }}>
                        <option value="">No importar</option>
                        {IMPORT_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>
                    </Field>
                  ))}
                </div>
                {missingRequired.length > 0 && (
                  <div className="notice danger" style={{ marginTop: 12 }}><Info size={18} /><span>Falta asignar: {missingRequired.map((f) => f.label).join(', ')}.</span></div>
                )}
                {timeMissing && !missingRequired.length && (
                  <div className="notice info" style={{ marginTop: 12 }}><Info size={18} /><span>No hay columna de hora: se tomará la hora incluida en la fecha (si existe).</span></div>
                )}
              </section>

              <section className="card card-pad">
                <h3 className="card-title">Resumen de validación</h3>
                <dl className="quality-grid">
                  <div><dt>Filas leídas</dt><dd>{rows.length}</dd></div>
                  <div><dt>Válidas para importar</dt><dd style={{ color: 'var(--green)' }}>{ok.length}</dd></div>
                  <div><dt>Con errores</dt><dd style={{ color: errors.length ? 'var(--red)' : undefined }}>{errors.length}</dd></div>
                  <div><dt>Duplicadas</dt><dd>{dups.length}</dd></div>
                  <div><dt>Con datos faltantes</dt><dd>{withMissing.length}</dd></div>
                  <div><dt>Sospechosas</dt><dd>{suspicious.length}</dd></div>
                </dl>
                {range && <p className="small muted" style={{ marginTop: 10 }}>Periodo del archivo: {fmtDate(range[0].date)} {range[0].time} — {fmtDate(range[1].date)} {range[1].time}.</p>}
              </section>

              <section className="card">
                <div className="table-toolbar" style={{ alignItems: 'center' }}>
                  <strong style={{ marginRight: 'auto' }}>Vista previa</strong>
                  <div className="chips">
                    {([['all', `Todas (${rows.length})`], ['ok', `Válidas (${ok.length})`], ['error', `Errores (${errors.length})`], ['duplicate', `Duplicadas (${dups.length})`], ['warn', `Advertencias (${warned.length})`]] as [RowFilter, string][]).map(([f, l]) => (
                      <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{l}</button>
                    ))}
                  </div>
                </div>
                <div className="table-wrap" style={{ maxHeight: 420 }}>
                  <table className="data-table">
                    <thead><tr><th>Fila</th><th>Estado</th><th>Fecha</th><th>Hora</th><th className="num">Temp.</th><th className="num">HR</th><th>Sensor</th><th>Detalle</th></tr></thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr key={r.line}>
                          <td className="num">{r.line}</td>
                          <td>{r.status === 'ok' ? (r.validation === 'sospechoso' ? <span className="tag amber">Sospechosa</span> : <span className="tag green">Válida</span>) : r.status === 'error' ? <span className="tag red">Error</span> : <span className="tag amber">Duplicada</span>}</td>
                          <td className="nowrap">{r.preview.date ? fmtDate(r.preview.date) : '—'}</td>
                          <td>{r.preview.time ?? '—'}</td>
                          <td className="num">{String(r.preview.airTemp ?? '')}</td>
                          <td className="num">{String(r.preview.relHumidity ?? '')}</td>
                          <td className="small">{r.preview.sensor || '—'}</td>
                          <td className={`small ${r.status === 'error' ? 'row-err' : r.status === 'duplicate' || r.warnings.length ? 'row-dup' : 'row-ok'}`}>{[...r.errors, ...r.warnings].join(' · ') || 'Lista para importar'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="form-actions">
                  <span className="muted small" style={{ marginRight: 'auto', alignSelf: 'center' }}>Las filas con errores o duplicadas no se importan. Las sospechosas se importan marcadas para revisión.</span>
                  <button className="btn btn-ghost" onClick={() => { setSheet(null); setFile(null); }}>Cancelar</button>
                  <button className="btn btn-primary" disabled={busy || ok.length === 0 || missingRequired.length > 0} onClick={doImport}>
                    <Upload size={17} /> Importar {ok.length} registros
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </>
  );
}

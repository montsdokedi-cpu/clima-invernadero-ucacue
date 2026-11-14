import { FileDown, FileSpreadsheet, FileText, GraduationCap, Loader } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { EmptyState, Field, PageHeader } from '../components/ui';
import { db } from '../db/db';
import { REAL_SOURCES, SOURCE_LABELS, type RecordSource, type Report } from '../db/types';
import { analyzePeriod } from '../lib/analysis';
import { dataConclusions, practicalQuestions } from '../lib/applied';
import { addDays, fmtDate, fmtDateTime, todayISO } from '../lib/dates';
import { downloadBlob, safeFileName } from '../lib/download';
import { detectProblems, SEVERITY_LABELS } from '../lib/problems';
import { summarize } from '../lib/stats';
import { fmt, fmtHours } from '../lib/variables';
import { generatePDF } from '../reports/pdf';
import { downloadCSV, downloadXLSX } from '../reports/spreadsheet';
import { DAILY_HEADERS, dailyRows, EXTREMES_HEADERS, extremesRows, RECORD_HEADERS, recordRows, STATS_HEADERS, statsRows } from '../reports/tables';
import { useData } from '../state/DataContext';
import { useToast } from '../state/Toast';

const SECTION_LABELS = {
  charts: 'Gráficos (temperatura, humedad, evolución diaria, distribución, horas críticas, correlación)',
  questions: 'Respuestas a las preguntas prácticas',
  daily: 'Resumen diario',
  records: 'Anexo: tabla completa de registros',
};

export default function Reports() {
  const { ready, allRecords, greenhouses, crops, thresholds, settings, isDemo, greenhouseById, cropById, resolved } = useData();
  const toast = useToast();
  const [from, setFrom] = useState(resolved.from);
  const [to, setTo] = useState(resolved.to);
  const [greenhouseId, setGreenhouseId] = useState('');
  const [cropId, setCropId] = useState('');
  const [responsible, setResponsible] = useState(settings.defaultResponsible);
  const [title, setTitle] = useState(settings.studyTitle);
  const [fieldObs, setFieldObs] = useState('');
  const [sources, setSources] = useState<RecordSource[]>(settings.sourceFilter);
  const [sections, setSections] = useState({ charts: true, questions: true, daily: true, records: false });
  const [busy, setBusy] = useState<string | null>(null);
  const history = useLiveQuery(() => db.reports.orderBy('generatedAt').reverse().filter((r) => r.isDemo === isDemo).limit(15).toArray(), [isDemo]);

  const [a, b] = from <= to ? [from, to] : [to, from];
  const inScope = useMemo(
    () => allRecords.filter((r) => r.date >= a && r.date <= b && (!greenhouseId || String(r.greenhouseId) === greenhouseId) && (!cropId || String(r.cropId) === cropId) && (isDemo || sources.includes(r.source))),
    [allRecords, a, b, greenhouseId, cropId, sources, isDemo],
  );
  const records = useMemo(() => inScope.filter((r) => r.validation !== 'descartado'), [inScope]);
  const pa = useMemo(() => detectProblems(records, inScope, thresholds, settings, a, b), [records, inScope, thresholds, settings, a, b]);
  const greenhouse = greenhouseId ? greenhouseById.get(Number(greenhouseId)) ?? null : greenhouses.length === 1 ? greenhouses[0] : null;
  const reportCrops = cropId ? crops.filter((c) => String(c.id) === cropId) : [...new Set(records.map((r) => r.cropId).filter(Boolean))].map((id) => cropById.get(id!)!).filter(Boolean);

  if (!ready) return <div className="loading">Cargando…</div>;

  const usedSources: RecordSource[] = isDemo ? ['demo'] : sources;
  const baseName = safeFileName(`reporte_climatologia_tomate_${isDemo ? 'DEMO_' : ''}${a}_${b}`);
  const t = summarize(records, 'airTemp');
  const h = summarize(records, 'relHumidity');

  async function run(format: Report['format']) {
    setBusy(format);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const lookup = { greenhouseById, cropById };
      if (format === 'pdf') {
        const blob = generatePDF({ title, from: a, to: b, responsible, greenhouse, crops: reportCrops, records, allInPeriod: inScope, sources: usedSources, thresholds, settings, lookup, isDemo, fieldObservations: fieldObs, sections });
        downloadBlob(blob, `${baseName}.pdf`);
      } else if (format === 'xlsx') {
        const info = [
          ['Resolución de problemas prácticos – Climatología Aplicada'],
          [isDemo ? 'DATOS DE DEMOSTRACIÓN — valores simulados, no corresponden a mediciones reales' : 'Datos reales del invernadero'],
          [],
          ['Título del estudio', title],
          ['Institución', settings.institution],
          ['Sede', settings.campus],
          ['Cultivo', reportCrops.map((c) => `${c.name}${c.variety ? ` (${c.variety})` : ''}`).join('; ') || 'Tomate'],
          ['Invernadero evaluado', greenhouse ? `${greenhouse.code} – ${greenhouse.name}` : 'Todos'],
          ['Periodo de análisis', `${fmtDate(a)} al ${fmtDate(b)}`],
          ['Fuente de datos', usedSources.map((s) => SOURCE_LABELS[s]).join(', ')],
          ['Sensores', pa.quality.sensors.join(', ') || '—'],
          ['Responsable', responsible],
          ['Fecha de generación', fmtDateTime(Date.now())],
          ['Registros analizados', records.length],
          ['Problema práctico', settings.studyProblem],
          ['Rangos de referencia', settings.referenceSource],
          [],
          ['Observaciones de campo', fieldObs],
        ];
        const problems = [['Categoría', 'Prioridad', 'Problema', 'Hechos observados', 'Interpretación', 'Recomendaciones'], ...pa.problems.map((p) => [p.category, SEVERITY_LABELS[p.severity], p.title, p.facts.join('\n'), p.interpretation, p.recommendations.join('\n')])];
        const questions = [['Pregunta', 'Respuesta', 'Base', 'Datos limitados'], ...practicalQuestions(records, thresholds, settings, pa).map((q) => [q.question, q.answer.join('\n'), q.basis, q.insufficient ? 'Sí' : 'No'])];
        const interpretation = [['Respuesta al problema práctico'], ...pa.verdict.map((v) => [v]), [], ['Conclusiones basadas en datos'], ...dataConclusions(records, thresholds, pa, a, b).map((c) => [c]), [], ...analyzePeriod(records, a, b, thresholds, settings).flatMap((s) => [[s.title], ...s.paragraphs.map((p) => [p]), []])];
        const ind = pa.ind;
        const agro = [['Indicador', 'Valor'], ['Horas registradas (estimadas)', fmtHours(ind.coveredHours)], ['Horas con temperatura sobre la referencia', fmtHours(ind.hoursTempHigh)], ['Horas con temperatura bajo la referencia', fmtHours(ind.hoursTempLow)], ['Horas con HR sobre la referencia', fmtHours(ind.hoursHumHigh)], ['Horas con HR bajo la referencia', fmtHours(ind.hoursHumLow)], ['Horas con T y HR dentro de la referencia', fmtHours(ind.hoursBothInRange)]];
        downloadXLSX(
          [
            { name: 'Información', rows: info, widths: [26, 100] },
            { name: 'Resultados', rows: [STATS_HEADERS, ...statsRows(records), [], EXTREMES_HEADERS, ...extremesRows(records), [], ...agro] },
            { name: 'Problemas climáticos', rows: problems, widths: [24, 16, 50, 80, 70, 70] },
            { name: 'Preguntas prácticas', rows: questions, widths: [60, 100, 30, 14] },
            { name: 'Interpretación', rows: interpretation, widths: [140] },
            { name: 'Resumen diario', rows: [DAILY_HEADERS, ...dailyRows(records)] },
            { name: 'Registros', rows: [RECORD_HEADERS, ...recordRows(inScope, lookup)] },
          ],
          `${baseName}.xlsx`,
        );
      } else {
        downloadCSV([RECORD_HEADERS, ...recordRows(inScope, lookup)], `${baseName}.csv`);
      }
      await db.reports.add({ title, from: a, to: b, greenhouseId: greenhouse?.id ?? null, cropId: cropId ? Number(cropId) : null, responsible, format, recordCount: records.length, sources: usedSources, generatedAt: Date.now(), isDemo });
      toast('Reporte generado.');
    } catch (e) {
      toast(`No se pudo generar el reporte: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  }

  const quick = (days: number) => { setFrom(addDays(todayISO(), -(days - 1))); setTo(todayISO()); };
  const toggleSource = (s: RecordSource) => setSources((cur) => (cur.includes(s) ? (cur.length > 1 ? cur.filter((x) => x !== s) : cur) : [...cur, s]));

  return (
    <>
      <PageHeader title="Reportes académicos" description="Resolución de problemas prácticos – Climatología Aplicada. Reporte con datos reales, problemas identificados, interpretación y conclusiones." icon={<GraduationCap size={22} />} />

      <div className="grid-main-side">
        <section className="card">
          <div className="form-section">
            <h3>Datos del estudio</h3>
            <div className="form-grid">
              <div className="field span-all">
                <label htmlFor="rep-title">1. Título del estudio</label>
                <textarea id="rep-title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ minHeight: 56 }} />
              </div>
              <Field label="6. Periodo: desde" htmlFor="rep-from" required><input id="rep-from" type="date" value={from} max={todayISO()} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
              <Field label="Hasta" htmlFor="rep-to" required><input id="rep-to" type="date" value={to} max={todayISO()} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
              <Field label="5. Invernadero evaluado" htmlFor="rep-gh">
                <select id="rep-gh" value={greenhouseId} onChange={(e) => setGreenhouseId(e.target.value)}>
                  <option value="">Todos</option>
                  {greenhouses.map((g) => <option key={g.id} value={g.id}>{g.code} · {g.name}</option>)}
                </select>
              </Field>
              <Field label="4. Cultivo" htmlFor="rep-crop">
                <select id="rep-crop" value={cropId} onChange={(e) => setCropId(e.target.value)}>
                  <option value="">Todos</option>
                  {crops.map((c) => <option key={c.id} value={c.id}>{c.name}{c.variety ? ` (${c.variety})` : ''}</option>)}
                </select>
              </Field>
              <Field label="Responsable" htmlFor="rep-resp"><input id="rep-resp" type="text" value={responsible} onChange={(e) => setResponsible(e.target.value)} placeholder="Estudiante(s) / docente" /></Field>
            </div>
            <div className="chips" style={{ marginTop: 12 }}>
              {[7, 15, 30].map((n) => <button key={n} className="chip" onClick={() => quick(n)}>Últimos {n} días</button>)}
              {allRecords.length > 0 && <button className="chip" onClick={() => { setFrom(allRecords[0].date); setTo(todayISO()); }}>Todo el historial</button>}
            </div>
          </div>
          <div className="form-section">
            <h3>7. Fuente de datos</h3>
            {isDemo ? (
              <p className="small" style={{ color: 'var(--amber-text)' }}>Modo demostración: el reporte usará datos simulados y llevará la marca «DATOS DE DEMOSTRACIÓN».</p>
            ) : (
              <div className="chips">
                {REAL_SOURCES.map((s) => <button key={s} className={`chip src-toggle ${sources.includes(s) ? 'active' : ''}`} onClick={() => toggleSource(s)} aria-pressed={sources.includes(s)}>{SOURCE_LABELS[s]}</button>)}
              </div>
            )}
            <p className="small muted" style={{ marginTop: 8 }}>Los registros descartados se excluyen; los sospechosos se incluyen y se informan en la calidad de datos.</p>
          </div>
          <div className="form-section">
            <h3>16. Observaciones de campo</h3>
            <textarea id="rep-field" value={fieldObs} onChange={(e) => setFieldObs(e.target.value)} placeholder="Estado sanitario verificado, labores de manejo, ventilación, riego, síntomas observados…" />
            <p className="small muted" style={{ marginTop: 6 }}>Se añaden a las observaciones registradas en los datos. Estas observaciones permiten contrastar las condiciones climáticas con lo verificado en el cultivo.</p>
          </div>
          <div className="form-section">
            <h3>Contenido del PDF</h3>
            <p className="small muted" style={{ marginBottom: 6 }}>Siempre incluye: datos generales (1–7), planteamiento del problema, variables (8), promedios (10), máximos y mínimos (11), problemas climáticos (13), interpretación (14), conclusiones (15) y observaciones de campo (16).</p>
            {(Object.keys(SECTION_LABELS) as (keyof typeof SECTION_LABELS)[]).map((k) => (
              <label key={k} className="check"><input id={`sec-${k}`} type="checkbox" checked={sections[k]} onChange={(e) => setSections({ ...sections, [k]: e.target.checked })} /> {SECTION_LABELS[k]}{k === 'records' && records.length > 500 ? ` (${records.length} filas: el PDF será extenso)` : ''}</label>
            ))}
          </div>
          <div className="form-actions">
            <button className="btn btn-secondary" disabled={!!busy || !inScope.length} onClick={() => run('csv')}>{busy === 'csv' ? <Loader size={17} /> : <FileDown size={17} />} CSV</button>
            <button className="btn btn-secondary" disabled={!!busy || !inScope.length} onClick={() => run('xlsx')}>{busy === 'xlsx' ? <Loader size={17} /> : <FileSpreadsheet size={17} />} Excel</button>
            <button className="btn btn-primary" disabled={!!busy || !inScope.length} onClick={() => run('pdf')}>{busy === 'pdf' ? <Loader size={17} /> : <FileText size={17} />} {busy === 'pdf' ? 'Generando…' : 'Generar PDF'}</button>
          </div>
        </section>

        <div className="stack">
          <section className="card card-pad">
            <h3 className="card-title">Vista previa</h3>
            {records.length === 0 ? (
              <p className="muted">No hay registros válidos con estos filtros. Ajusta el periodo o las fuentes.</p>
            ) : (
              <>
                <p style={{ marginBottom: 10 }}><strong>{records.length}</strong> registros · {pa.quality.daysWithData} días · {fmtDate(a)} al {fmtDate(b)}</p>
                <div className="kpi-row">
                  <span className="kpi green">T. prom <b>{fmt(t.mean)} °C</b></span>
                  <span className="kpi red">T. máx <b>{fmt(t.max)} °C</b></span>
                  <span className="kpi blue">T. mín <b>{fmt(t.min)} °C</b></span>
                  <span className="kpi blue">HR prom <b>{fmt(h.mean, 0)} %</b></span>
                  <span className="kpi">Horas en rango <b>{fmtHours(pa.ind.hoursBothInRange)}</b></span>
                </div>
                <h4 className="small" style={{ margin: '14px 0 6px' }}>Problemas que se incluirán</h4>
                {pa.problems.length ? (
                  <ul className="conclusions" style={{ gap: 4 }}>{pa.problems.map((p) => <li key={p.id}><span className={`sev-chip sev-${p.severity}`}>{SEVERITY_LABELS[p.severity]}</span> {p.category}</li>)}</ul>
                ) : <p className="small muted">Ninguno detectado.</p>}
              </>
            )}
          </section>

          <section className="card card-pad">
            <h3 className="card-title">Reportes generados</h3>
            {!history?.length ? (
              <EmptyState icon={<FileText size={26} />} title="Aún no has generado reportes" />
            ) : (
              <table className="data-table">
                <tbody>
                  {history.map((r) => (
                    <tr key={r.id} style={{ cursor: 'pointer' }} title="Cargar estos parámetros" onClick={() => { setFrom(r.from); setTo(r.to); setTitle(r.title); setResponsible(r.responsible); setGreenhouseId(r.greenhouseId ? String(r.greenhouseId) : ''); setCropId(r.cropId ? String(r.cropId) : ''); if (r.sources?.length && !isDemo) setSources(r.sources); }}>
                      <td><span className="tag blue">{r.format.toUpperCase()}</span></td>
                      <td className="small">{fmtDate(r.from)} – {fmtDate(r.to)}<br /><span className="muted">{r.recordCount} registros</span></td>
                      <td className="small muted num">{fmtDateTime(r.generatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

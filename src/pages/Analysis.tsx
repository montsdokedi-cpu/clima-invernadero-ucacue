import { CalendarDays, HelpCircle, ListChecks, Microscope, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AnswerCard, FactBlock, RecoBlock } from '../components/agro';
import { PeriodFilter } from '../components/PeriodFilter';
import { AlertItem, EmptyState, PageHeader, Segmented } from '../components/ui';
import { TOMATO_STAGES } from '../db/types';
import { compareDayParts, compareStages, type GroupStats } from '../lib/agro';
import { allAlerts, recordAlerts, thresholdFor, type AlertKind } from '../lib/alerts';
import { analyzeDay, analyzePeriod } from '../lib/analysis';
import { dataConclusions, practicalQuestions } from '../lib/applied';
import { fmtDate, fmtMonthKey, weekRange } from '../lib/dates';
import { detectProblems } from '../lib/problems';
import { consecutiveChanges, dailySummaries, monthlySummaries, summarize, weeklySummaries, type PeriodSummary } from '../lib/stats';
import { fmt, fmtHours, variablesWithData } from '../lib/variables';
import { useData } from '../state/DataContext';

type AlertFilter = 'all' | 'temp' | 'hum' | 'soil' | 'abrupt' | 'gap';
const KIND_GROUP: Record<AlertKind, AlertFilter> = { 'temp-high': 'temp', 'temp-low': 'temp', 'hum-high': 'hum', 'hum-low': 'hum', soil: 'soil', abrupt: 'abrupt', gap: 'gap' };

function PeriodTable({ periods, label }: { periods: PeriodSummary[]; label: (k: string) => string }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Periodo</th><th className="num">Registros</th><th className="num">T. prom</th><th className="num">T. máx</th><th className="num">T. mín</th>
            <th className="num">Amplitud</th><th className="num">HR prom</th><th className="num">HR máx</th><th className="num">HR mín</th><th className="num">Var. HR</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.key}>
              <td className="nowrap"><strong>{label(p.key)}</strong></td>
              <td className="num">{p.n}</td>
              <td className="num">{fmt(p.stats.airTemp.mean)} °C</td>
              <td className="num">{fmt(p.stats.airTemp.max)} °C</td>
              <td className="num">{fmt(p.stats.airTemp.min)} °C</td>
              <td className="num">{fmt(p.stats.airTemp.range)} °C</td>
              <td className="num">{fmt(p.stats.relHumidity.mean, 0)} %</td>
              <td className="num">{fmt(p.stats.relHumidity.max, 0)} %</td>
              <td className="num">{fmt(p.stats.relHumidity.min, 0)} %</td>
              <td className="num">{fmt(p.stats.relHumidity.range, 0)} %</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupTable({ groups, first }: { groups: GroupStats[]; first: string }) {
  const rows = groups.filter((g) => g.n > 0);
  if (!rows.length) return <p className="muted small">Sin datos para comparar.</p>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>{first}</th><th className="num">n</th><th className="num">Días</th><th className="num">T. prom</th><th className="num">T. máx</th><th className="num">T. mín</th><th className="num">HR prom</th><th className="num">T. en ref.</th><th className="num">HR en ref.</th><th className="num">Horas calor</th><th className="num">Horas HR alta</th></tr></thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.key}>
              <td><strong>{g.key}</strong></td><td className="num">{g.n}</td><td className="num">{g.days}</td>
              <td className="num">{fmt(g.meanT)} °C</td><td className="num">{fmt(g.maxT)} °C</td><td className="num">{fmt(g.minT)} °C</td><td className="num">{fmt(g.meanH, 0)} %</td>
              <td className="num">{fmt(g.pctTempInRange, 0)} %</td><td className="num">{fmt(g.pctHumInRange, 0)} %</td><td className="num">{fmtHours(g.hoursHot)}</td><td className="num">{fmtHours(g.hoursHumid)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Analysis() {
  const { ready, periodRecords, historyRecords, resolved, thresholds, settings } = useData();
  const [day, setDay] = useState('');
  const [alertFilter, setAlertFilter] = useState<AlertFilter>('all');
  const [grouping, setGrouping] = useState<'day' | 'week' | 'month'>('day');

  const pa = useMemo(() => {
    const all = historyRecords.filter((r) => r.date >= resolved.from && r.date <= resolved.to);
    return detectProblems(periodRecords, all, thresholds, settings, resolved.from, resolved.to);
  }, [historyRecords, periodRecords, resolved, thresholds, settings]);
  const answers = useMemo(() => practicalQuestions(periodRecords, thresholds, settings, pa), [periodRecords, thresholds, settings, pa]);
  const conclusions = useMemo(() => dataConclusions(periodRecords, thresholds, pa, resolved.from, resolved.to), [periodRecords, thresholds, pa, resolved]);
  const sections = useMemo(() => analyzePeriod(periodRecords, resolved.from, resolved.to, thresholds, settings), [periodRecords, resolved, thresholds, settings]);
  const parts = useMemo(() => compareDayParts(periodRecords, thresholds), [periodRecords, thresholds]);
  const stages = useMemo(() => compareStages(periodRecords, thresholds, TOMATO_STAGES), [periodRecords, thresholds]);
  const days = useMemo(() => dailySummaries(periodRecords), [periodRecords]);
  const dates = useMemo(() => days.map((d) => d.key).reverse(), [days]);
  const selectedDay = dates.includes(day) ? day : dates[0];
  const dayText = useMemo(() => (selectedDay ? analyzeDay(periodRecords, selectedDay) : []), [periodRecords, selectedDay]);
  const alerts = useMemo(() => allAlerts(periodRecords, thresholds, settings, false), [periodRecords, thresholds, settings]);
  const shownAlerts = alerts.filter((a) => alertFilter === 'all' || KIND_GROUP[a.kind] === alertFilter);
  const changes = useMemo(() => consecutiveChanges(periodRecords, 'airTemp').sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 8), [periodRecords]);
  const grouped = useMemo(() => (grouping === 'day' ? days : grouping === 'week' ? weeklySummaries(periodRecords) : monthlySummaries(periodRecords)), [grouping, days, periodRecords]);
  const recommendations = useMemo(() => [...new Set(pa.problems.flatMap((p) => p.recommendations))], [pa]);
  const extremeDays = useMemo(
    () =>
      days
        .map((d) => {
          const out = d.records.flatMap((r) => recordAlerts(r, thresholdFor(r, thresholds)));
          return { d, count: out.length, danger: out.filter((a) => a.level === 'danger').length, kinds: [...new Set(out.map((a) => a.title))] };
        })
        .filter((x) => x.count > 0),
    [days, thresholds],
  );

  if (!ready) return <div className="loading">Cargando…</div>;

  const vars = variablesWithData(periodRecords);
  const counts = (f: AlertFilter) => alerts.filter((a) => f === 'all' || KIND_GROUP[a.kind] === f).length;

  return (
    <>
      <PageHeader title="Análisis climático aplicado" description="Interpretaciones generadas únicamente a partir de los registros del periodo. Los hechos se presentan separados de las recomendaciones." icon={<Microscope size={22} />} />
      <PeriodFilter />

      {periodRecords.length === 0 ? (
        <EmptyState icon={<Microscope size={30} />} title="Sin registros en este periodo">Selecciona otro periodo para generar el análisis. No se generan conclusiones sin datos.</EmptyState>
      ) : (
        <div className="stack">
          <section className="card card-pad">
            <h3 className="card-title"><HelpCircle size={17} className="text-green" /> Preguntas prácticas del estudio</h3>
            <div className="answers">{answers.map((a, i) => <AnswerCard key={i} answer={a} index={i} />)}</div>
          </section>

          <section className="card card-pad">
            <h3 className="card-title"><ListChecks size={17} className="text-green" /> Conclusiones basadas en datos</h3>
            <ol className="conclusions">{conclusions.map((c, i) => <li key={i}>{c}</li>)}</ol>
          </section>

          <section className="card card-pad">
            <h3 className="card-title">Indicadores del periodo</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Variable</th><th className="num">n</th><th className="num">Promedio</th><th className="num">Máximo</th><th className="num">Mínimo</th><th className="num">Amplitud</th><th className="num">Desv. est.</th></tr></thead>
                <tbody>
                  {vars.map((v) => {
                    const s = summarize(periodRecords, v.key);
                    const d = v.decimals;
                    return (
                      <tr key={v.key}>
                        <td><strong>{v.label}</strong> <span className="muted">({v.unit})</span></td>
                        <td className="num">{s.n}</td>
                        <td className="num">{v.aggregate === 'sum' ? `${fmt(s.sum, d)} acum.` : fmt(s.mean, d)}</td>
                        <td className="num">{fmt(s.max, d)}</td>
                        <td className="num">{fmt(s.min, d)}</td>
                        <td className="num">{fmt(s.range, d)}</td>
                        <td className="num">{fmt(s.std, Math.max(d, 1))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>Promedio = suma de valores / número de registros · Amplitud = máximo − mínimo · Horas estimadas: cada lectura representa el intervalo hasta la siguiente (máx. 1,5 × el intervalo típico).</p>
          </section>

          <div className="grid-main-side">
            <section className="card card-pad">
              <h3 className="card-title">Interpretación del periodo</h3>
              {sections.map((s) => (
                <div key={s.title} className="analysis-section">
                  <h3>{s.title}</h3>
                  <FactBlock items={s.paragraphs} title={s.title === 'Nota metodológica' ? 'Nota' : 'Hechos observados en los datos'} />
                </div>
              ))}
              {recommendations.length > 0 && (
                <div className="analysis-section">
                  <h3>Recomendaciones</h3>
                  <RecoBlock items={recommendations} />
                </div>
              )}
            </section>

            <div className="stack">
              <section className="card card-pad">
                <h3 className="card-title"><CalendarDays size={17} className="text-green" /> Análisis por día</h3>
                <select id="analysis-day" value={selectedDay} onChange={(e) => setDay(e.target.value)} aria-label="Día" style={{ marginBottom: 12 }}>
                  {dates.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}
                </select>
                <div className="quote">{dayText.map((p, i) => <p key={i}>{p}</p>)}</div>
              </section>

              <section className="card card-pad">
                <h3 className="card-title">Mayores variaciones entre registros</h3>
                {changes.length === 0 ? <p className="muted">Se necesitan al menos dos registros en un mismo día.</p> : (
                  <table className="data-table">
                    <thead><tr><th>Fecha</th><th>Horas</th><th className="num">Cambio T.</th></tr></thead>
                    <tbody>
                      {changes.map((c) => (
                        <tr key={`${c.from.id}-${c.to.id}`}>
                          <td>{fmtDate(c.to.date)}</td>
                          <td className="nowrap">{c.from.time} → {c.to.time}</td>
                          <td className="num"><span className={Math.abs(c.delta) >= settings.abruptTempChange ? 'cell-warning' : ''}>{c.delta > 0 ? '+' : ''}{fmt(c.delta)} °C</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
          </div>

          <section className="card card-pad">
            <h3 className="card-title">Mañana vs tarde</h3>
            <GroupTable groups={parts} first="Franja horaria" />
          </section>

          <section className="card card-pad">
            <h3 className="card-title">Condiciones por etapa fenológica</h3>
            <GroupTable groups={stages} first="Etapa" />
            <p className="small muted" style={{ marginTop: 8 }}>La etapa se toma de cada registro o de la cronología de etapas del cultivo. Cada etapa se evalúa con su propio rango de referencia cuando existe.</p>
          </section>

          <section className="card card-pad">
            <h3 className="card-title"><TriangleAlert size={17} style={{ color: 'var(--amber)' }} /> Alertas del periodo <span className="count">{alerts.length}</span></h3>
            <div className="chips" style={{ marginBottom: 12 }}>
              {([['all', 'Todas'], ['temp', 'Temperatura'], ['hum', 'Humedad relativa'], ['soil', 'Suelo'], ['abrupt', 'Cambios bruscos'], ['gap', 'Falta de registros']] as [AlertFilter, string][]).map(([f, l]) => (
                <button key={f} className={`chip ${alertFilter === f ? 'active' : ''}`} onClick={() => setAlertFilter(f)}>{l} ({counts(f)})</button>
              ))}
            </div>
            {shownAlerts.length === 0 ? (
              <div className="notice ok">No hay alertas de este tipo en el periodo.</div>
            ) : (
              <div className="alert-list" style={{ maxHeight: 420, overflowY: 'auto' }}>
                {shownAlerts.slice(0, 200).map((a) => <AlertItem key={a.id} alert={a} compact />)}
                {shownAlerts.length > 200 && <p className="small muted">Se muestran 200 de {shownAlerts.length} alertas.</p>}
              </div>
            )}
          </section>

          {extremeDays.length > 0 && (
            <section className="card card-pad">
              <h3 className="card-title">Días con valores fuera de referencia <span className="count">{extremeDays.length} de {days.length} días</span></h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Fecha</th><th className="num">T. máx</th><th className="num">T. mín</th><th className="num">HR máx</th><th className="num">HR mín</th><th className="num">Lecturas fuera</th><th>Tipo</th></tr></thead>
                  <tbody>
                    {extremeDays.map(({ d, count, danger, kinds }) => (
                      <tr key={d.key}>
                        <td className="nowrap"><strong>{fmtDate(d.key)}</strong></td>
                        <td className="num">{fmt(d.stats.airTemp.max)} °C</td>
                        <td className="num">{fmt(d.stats.airTemp.min)} °C</td>
                        <td className="num">{fmt(d.stats.relHumidity.max, 0)} %</td>
                        <td className="num">{fmt(d.stats.relHumidity.min, 0)} %</td>
                        <td className="num"><span className={danger ? 'cell-danger' : 'cell-warning'}>{count}</span></td>
                        <td className="small">{kinds.join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="card card-pad">
            <h3 className="card-title" style={{ flexWrap: 'wrap' }}>
              Resumen por periodo
              <span style={{ marginLeft: 'auto' }}>
                <Segmented size="sm" value={grouping} onChange={setGrouping} options={[{ value: 'day', label: 'Diario' }, { value: 'week', label: 'Semanal' }, { value: 'month', label: 'Mensual' }]} />
              </span>
            </h3>
            <PeriodTable
              periods={[...grouped].reverse()}
              label={(k) => (grouping === 'day' ? fmtDate(k) : grouping === 'week' ? `Sem. ${k.split('-W')[1]} (${fmtDate(weekRange(k).from)})` : fmtMonthKey(k))}
            />
          </section>
        </div>
      )}
    </>
  );
}

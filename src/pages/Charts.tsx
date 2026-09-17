import { CalendarRange, ChartColumn, ChartLine, ChartScatter, Droplets, GitCompare, Thermometer, Waves } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  compareDaysOption,
  compareWeeksOption,
  correlationOption,
  dualAxisOption,
  histogramOption,
  hourlyProfileOption,
  maxMinOption,
  periodBarsOption,
  recordsDistributionOption,
  timeSeriesOption,
} from '../charts/options';
import { dailyEvolutionOption, groupCompareOption, hourRiskOption, rangeDistributionOption } from '../charts/tomato';
import { periodReference, ReferenceNote } from '../components/agro';
import { ChartCard } from '../components/ChartCard';
import { PeriodFilter } from '../components/PeriodFilter';
import { PageHeader, Segmented } from '../components/ui';
import { TOMATO_STAGES, type ClimateRecord } from '../db/types';
import { agroIndicators, compareDayParts, compareStages, runLabel } from '../lib/agro';
import { fmtDate, isoWeekKey, weekRange } from '../lib/dates';
import { consecutiveChanges, dailySummaries, describeCorrelation, monthlySummaries, summarize, weeklySummaries } from '../lib/stats';
import { fmt, fmtHours, variablesWithData, VARIABLES, type NumericKey } from '../lib/variables';
import { useData } from '../state/DataContext';

type Tab = 'temp' | 'hum' | 'tvh' | 'daily' | 'compare' | 'dist' | 'corr';
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'temp', label: '1 · Temperatura', icon: <Thermometer size={16} /> },
  { id: 'hum', label: '2 · Humedad relativa', icon: <Droplets size={16} /> },
  { id: 'tvh', label: '3 · Temperatura y humedad', icon: <ChartLine size={16} /> },
  { id: 'daily', label: '4 · Evolución diaria', icon: <ChartColumn size={16} /> },
  { id: 'compare', label: '5 · Comparaciones', icon: <GitCompare size={16} /> },
  { id: 'dist', label: '6 · Distribución', icon: <Waves size={16} /> },
  { id: 'corr', label: '7 · Correlación', icon: <ChartScatter size={16} /> },
];

type CompareMode = 'days' | 'weeks' | 'parts' | 'stages' | 'inout' | 'vars';
const MIN_CORR = 10;

function VarSelect({ id, value, onChange, records, label = 'Variable' }: { id: string; value: NumericKey; onChange: (k: NumericKey) => void; records: ClimateRecord[]; label?: string }) {
  const vars = variablesWithData(records);
  const opts = vars.some((v) => v.key === value) ? vars : [VARIABLES[value], ...vars];
  return (
    <label htmlFor={id}>
      {label}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as NumericKey)}>
        {opts.map((v) => <option key={v.key} value={v.key}>{v.label} ({v.unit})</option>)}
      </select>
    </label>
  );
}

function VariableTab({ k, records }: { k: 'airTemp' | 'relHumidity'; records: ClimateRecord[] }) {
  const { thresholds, settings } = useData();
  const def = VARIABLES[k];
  const th = useMemo(() => periodReference(records, thresholds), [records, thresholds]);
  const s = summarize(records, k);
  const ind = useMemo(() => agroIndicators(records, thresholds), [records, thresholds]);
  const days = useMemo(() => dailySummaries(records), [records]);
  const series = useMemo(() => timeSeriesOption(records, k, { threshold: th }), [records, k, th]);
  const profile = useMemo(() => hourlyProfileOption(records, [k]), [records, k]);
  const maxmin = useMemo(() => maxMinOption(days, k), [days, k]);
  const changes = consecutiveChanges(records, k);
  const meanAbsChange = changes.length ? changes.reduce((a, c) => a + Math.abs(c.delta), 0) / changes.length : null;
  const d = def.decimals;
  const isT = k === 'airTemp';
  const runsHigh = isT ? ind.hotRuns : ind.humidRuns;
  const runsLow = isT ? ind.coldRuns : ind.dryRuns;

  return (
    <div className="stack">
      <ChartCard
        title={isT ? 'Gráfico 1 · Temperatura durante el día' : 'Gráfico 2 · Humedad relativa durante el día'}
        subtitle="Eje X: fecha y hora · líneas discontinuas: referencia mínima y máxima · rojo: sobre la referencia · azul: bajo la referencia"
        option={series}
        height={380}
        empty={s.n === 0}
        footer={
          s.n > 0 && (
            <>
              <div className="kpi-row" style={{ marginTop: 0 }}>
                <span className="kpi green">Promedio <b>{fmt(s.mean, d)} {def.unit}</b></span>
                <span className="kpi red">Máxima <b>{fmt(s.max, d)} {def.unit}</b> <span className="muted">{fmtDate(s.maxRecord!.date)} {s.maxRecord!.time}</span></span>
                <span className="kpi blue">Mínima <b>{fmt(s.min, d)} {def.unit}</b> <span className="muted">{fmtDate(s.minRecord!.date)} {s.minRecord!.time}</span></span>
                <span className="kpi">Horas sobre referencia <b>{fmtHours(isT ? ind.hoursTempHigh : ind.hoursHumHigh)}</b></span>
                <span className="kpi">Horas bajo referencia <b>{fmtHours(isT ? ind.hoursTempLow : ind.hoursHumLow)}</b></span>
                {meanAbsChange !== null && <span className="kpi">Variación media entre registros <b>±{fmt(meanAbsChange, d)} {def.unit}</b></span>}
                <span className="kpi">n <b>{s.n}</b></span>
              </div>
              <ReferenceNote threshold={th} text={settings.referenceSource} />
            </>
          )
        }
      />
      {(runsHigh.length > 0 || runsLow.length > 0) && (
        <section className="card card-pad">
          <h3 className="card-title">Periodos {isT ? 'de temperatura' : 'de humedad relativa'} fuera de la referencia</h3>
          <div className="grid-2">
            <div>
              <h4 className="small" style={{ margin: '0 0 6px', color: 'var(--red)' }}>Por encima (más largos)</h4>
              {runsHigh.length ? <ul className="conclusions">{runsHigh.slice(0, 5).map((r, i) => <li key={i}>{fmtHours(r.hours)} · {runLabel(r)} · pico {fmt(r.peak, d)} {def.unit}</li>)}</ul> : <p className="muted small">Ninguno.</p>}
            </div>
            <div>
              <h4 className="small" style={{ margin: '0 0 6px', color: 'var(--blue)' }}>Por debajo (más largos)</h4>
              {runsLow.length ? <ul className="conclusions">{runsLow.slice(0, 5).map((r, i) => <li key={i}>{fmtHours(r.hours)} · {runLabel(r)} · mín. {fmt(r.peak, d)} {def.unit}</li>)}</ul> : <p className="muted small">Ninguno.</p>}
            </div>
          </div>
        </section>
      )}
      <div className="grid-2">
        <ChartCard title="Promedio por hora del día" subtitle="Ciclo diario típico del periodo" option={profile} height={290} empty={s.n === 0} />
        <ChartCard title="Máxima, mínima y promedio diario" subtitle="Banda sombreada: amplitud del día" option={maxmin} height={290} empty={days.length < 2} emptyText="Selecciona un periodo con al menos 2 días de datos." />
      </div>
    </div>
  );
}

export default function Charts() {
  const { ready, periodRecords, records, thresholds } = useData();
  const [tab, setTab] = useState<Tab>('temp');

  const [compareMode, setCompareMode] = useState<CompareMode>('days');
  const [pair, setPair] = useState<[NumericKey, NumericKey]>(['airTemp', 'soilTemp']);
  const [compareVar, setCompareVar] = useState<NumericKey>('airTemp');
  const allDates = useMemo(() => [...new Set(records.map((r) => r.date))].reverse(), [records]);
  const allWeeks = useMemo(() => [...new Set(records.map((r) => isoWeekKey(r.date)))].reverse(), [records]);
  const [selDates, setSelDates] = useState<string[] | null>(null);
  const [selWeeks, setSelWeeks] = useState<string[] | null>(null);
  const dates = selDates ?? allDates.slice(0, 2);
  const weeks = selWeeks ?? allWeeks.slice(0, 2);

  const [avgKind, setAvgKind] = useState<'day' | 'week' | 'month'>('week');
  const [avgVar, setAvgVar] = useState<NumericKey>('airTemp');
  const [distVar, setDistVar] = useState<NumericKey>('airTemp');
  const [cx, setCx] = useState<NumericKey>('airTemp');
  const [cy, setCy] = useState<NumericKey>('relHumidity');

  const days = useMemo(() => dailySummaries(periodRecords), [periodRecords]);
  const ind = useMemo(() => agroIndicators(periodRecords, thresholds), [periodRecords, thresholds]);
  const hasOutside = periodRecords.some((r) => r.outsideTemp != null);

  const options = useMemo(() => {
    switch (tab) {
      case 'tvh':
        return { a: dualAxisOption(periodRecords, 'airTemp', 'relHumidity'), b: hourlyProfileOption(periodRecords, ['airTemp', 'relHumidity']) };
      case 'daily': {
        const periods = avgKind === 'day' ? days : avgKind === 'week' ? weeklySummaries(periodRecords) : monthlySummaries(periodRecords);
        return { a: dailyEvolutionOption(days), b: periodBarsOption(periods, avgVar, avgKind, true, avgKind === 'week' ? 'line' : 'bar'), n: periods.length };
      }
      case 'compare':
        switch (compareMode) {
          case 'days': return { a: compareDaysOption(records, [...dates].sort(), compareVar) };
          case 'weeks': return { a: compareWeeksOption(records, [...weeks].sort(), compareVar) };
          case 'parts': return { a: groupCompareOption(compareDayParts(periodRecords, thresholds)), groups: compareDayParts(periodRecords, thresholds) };
          case 'stages': return { a: groupCompareOption(compareStages(periodRecords, thresholds, TOMATO_STAGES)), groups: compareStages(periodRecords, thresholds, TOMATO_STAGES) };
          case 'inout': return { a: dualAxisOption(periodRecords, 'airTemp', 'outsideTemp') };
          default: return { a: dualAxisOption(periodRecords, pair[0], pair[1]) };
        }
      case 'dist': {
        const d = recordsDistributionOption(periodRecords, days);
        return { a: rangeDistributionOption(ind), b: histogramOption(periodRecords, distVar), c: hourRiskOption(ind), d: d.byHour, e: d.byDay };
      }
      default:
        return {};
    }
  }, [tab, periodRecords, avgKind, days, avgVar, compareMode, records, dates, weeks, compareVar, thresholds, pair, ind, distVar]);

  const corr = useMemo(() => (tab === 'corr' ? correlationOption(periodRecords, cx, cy) : null), [tab, periodRecords, cx, cy]);

  if (!ready) return <div className="loading">Cargando…</div>;

  const toggle = (list: string[], v: string, max: number) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v].slice(-max));

  const compareTitle: Record<CompareMode, string> = {
    days: `Día vs día · ${VARIABLES[compareVar].label}`,
    weeks: `Semana vs semana · ${VARIABLES[compareVar].label}`,
    parts: 'Mañana vs tarde (y madrugada / noche)',
    stages: 'Condiciones por etapa fenológica del tomate',
    inout: 'Temperatura interna vs temperatura externa',
    vars: `${VARIABLES[pair[0]].label} vs ${VARIABLES[pair[1]].label}`,
  };
  const compareEmpty =
    compareMode === 'days' ? dates.length === 0
      : compareMode === 'weeks' ? weeks.length === 0
        : compareMode === 'inout' ? !hasOutside
          : periodRecords.length === 0;

  return (
    <>
      <PageHeader title="Gráficos del microclima" description="Acerca, aleja, toca un punto para ver su valor y descarga o comparte cada gráfico." icon={<ChartLine size={22} />} />
      <PeriodFilter />

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'temp' && <VariableTab k="airTemp" records={periodRecords} />}
      {tab === 'hum' && <VariableTab k="relHumidity" records={periodRecords} />}

      {tab === 'tvh' && (
        <div className="stack">
          <ChartCard title="Gráfico 3 · Temperatura y humedad relativa comparadas" subtitle="Eje izquierdo: °C · eje derecho: %. Observa cómo la humedad baja cuando la temperatura sube." option={options.a!} height={380} empty={!periodRecords.length} />
          <ChartCard title="Ciclo diario promedio de temperatura y humedad" subtitle="Promedio de cada hora del día en el periodo" option={options.b!} height={300} empty={!periodRecords.length}
            footer={<span className="small muted">Para cuantificar la relación entre ambas variables usa la pestaña «7 · Correlación».</span>} />
        </div>
      )}

      {tab === 'daily' && (
        <div className="stack">
          <ChartCard title="Gráfico 4 · Evolución diaria" subtitle="Barras: temperatura promedio · líneas: máxima y mínima · discontinua: humedad relativa promedio" option={options.a!} height={380} empty={days.length === 0} />
          <ChartCard
            title={avgKind === 'week' ? 'Gráfico 5 · Evolución semanal' : avgKind === 'month' ? 'Promedios mensuales' : 'Promedios diarios'}
            subtitle={`${(options.n ?? 0) < 2 && avgKind !== 'day' ? 'Amplía el periodo (p. ej. «Todo») para ver la evolución. ' : ''}Promedio con máxima y mínima.`}
            option={options.b!}
            height={330}
            empty={!options.n}
            controls={
              <>
                <Segmented value={avgKind} onChange={setAvgKind} size="sm" options={[{ value: 'day', label: 'Diario' }, { value: 'week', label: 'Semanal' }, { value: 'month', label: 'Mensual' }]} />
                <VarSelect id="avg-var" value={avgVar} onChange={setAvgVar} records={periodRecords} />
              </>
            }
          />
        </div>
      )}

      {tab === 'compare' && (
        <ChartCard
          title={compareTitle[compareMode]}
          subtitle={
            compareMode === 'days' ? 'Elige hasta 5 días de todo el historial. Eje X: hora del día.'
              : compareMode === 'weeks' ? 'Elige hasta 4 semanas. Promedio de cada día de la semana.'
                : compareMode === 'inout' ? (hasOutside ? 'Requiere registros con temperatura exterior.' : '')
                  : 'Periodo seleccionado.'
          }
          option={options.a!}
          height={400}
          empty={compareEmpty}
          emptyText={compareMode === 'inout' ? 'No existen datos de temperatura exterior en el periodo. Actívalos en Configuración e impórtalos desde la estación externa.' : undefined}
          controls={
            <div className="stack" style={{ gap: 10, width: '100%' }}>
              <div className="chips">
                {([['days', 'Día 1 vs día 2'], ['weeks', 'Semana 1 vs semana 2'], ['parts', 'Mañana vs tarde'], ['stages', 'Etapas fenológicas'], ['inout', 'Interna vs externa'], ['vars', 'Otras variables']] as [CompareMode, string][]).map(([m, l]) => (
                  <button key={m} className={`chip ${compareMode === m ? 'active' : ''}`} onClick={() => setCompareMode(m)}>{l}</button>
                ))}
              </div>
              {compareMode === 'vars' && (
                <div className="chart-controls" style={{ margin: 0 }}>
                  <VarSelect id="pair-a" label="Variable A" value={pair[0]} onChange={(k) => setPair([k, pair[1]])} records={periodRecords} />
                  <VarSelect id="pair-b" label="Variable B" value={pair[1]} onChange={(k) => setPair([pair[0], k])} records={periodRecords} />
                </div>
              )}
              {(compareMode === 'days' || compareMode === 'weeks') && (
                <>
                  <div className="chart-controls" style={{ margin: 0 }}>
                    <VarSelect id="compare-var" value={compareVar} onChange={setCompareVar} records={records} />
                  </div>
                  <div className="chips" style={{ maxHeight: 92, overflowY: 'auto' }}>
                    {compareMode === 'days'
                      ? allDates.slice(0, 60).map((d) => <button key={d} className={`chip ${dates.includes(d) ? 'active' : ''}`} onClick={() => setSelDates(toggle(dates, d, 5))}>{fmtDate(d)}</button>)
                      : allWeeks.slice(0, 26).map((w) => <button key={w} className={`chip ${weeks.includes(w) ? 'active' : ''}`} onClick={() => setSelWeeks(toggle(weeks, w, 4))}>Sem. {w.split('-W')[1]} · {fmtDate(weekRange(w).from)}</button>)}
                  </div>
                </>
              )}
            </div>
          }
          footer={
            options.groups && options.groups.some((g) => g.n) ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Grupo</th><th className="num">n</th><th className="num">T. prom</th><th className="num">T. máx</th><th className="num">T. mín</th><th className="num">HR prom</th><th className="num">T. en ref.</th><th className="num">HR en ref.</th><th className="num">Horas calor</th><th className="num">Horas HR alta</th></tr></thead>
                  <tbody>
                    {options.groups.filter((g) => g.n).map((g) => (
                      <tr key={g.key}>
                        <td><strong>{g.key}</strong></td><td className="num">{g.n}</td><td className="num">{fmt(g.meanT)} °C</td><td className="num">{fmt(g.maxT)} °C</td><td className="num">{fmt(g.minT)} °C</td>
                        <td className="num">{fmt(g.meanH, 0)} %</td><td className="num">{fmt(g.pctTempInRange, 0)} %</td><td className="num">{fmt(g.pctHumInRange, 0)} %</td><td className="num">{fmtHours(g.hoursHot)}</td><td className="num">{fmtHours(g.hoursHumid)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : undefined
          }
        />
      )}

      {tab === 'dist' && (
        <div className="stack">
          <ChartCard title="Gráfico 6 · Distribución respecto al rango de referencia" subtitle="Registros por debajo, dentro y por encima del rango del tomate (el tooltip muestra las horas estimadas)" option={options.a!} height={230} empty={!periodRecords.length} />
          <div className="grid-2">
            <ChartCard title="Horas críticas del día" subtitle="% de lecturas de cada hora fuera de la referencia" option={options.c!} height={290} empty={!periodRecords.length} />
            <ChartCard title={`Distribución de valores · ${VARIABLES[distVar].label}`} subtitle="Frecuencia por rango de valores" option={options.b!} height={290} empty={!periodRecords.length} controls={<VarSelect id="dist-var" value={distVar} onChange={setDistVar} records={periodRecords} />} />
          </div>
          <div className="grid-2">
            <ChartCard title="Registros por hora del día" option={options.d!} height={250} empty={!periodRecords.length} />
            <ChartCard title="Registros por día" subtitle="Permite detectar días con datos incompletos" option={options.e!} height={250} empty={!periodRecords.length} />
          </div>
        </div>
      )}

      {tab === 'corr' && corr && (
        <ChartCard
          title={`Gráfico 7 · Correlación: ${VARIABLES[cx].label} vs ${VARIABLES[cy].label}`}
          subtitle="Cada punto es un registro. Línea roja: tendencia lineal (mínimos cuadrados)."
          option={corr.option}
          height={420}
          empty={corr.n < MIN_CORR || corr.r === null}
          emptyText={`No se calcula la correlación: hay ${corr.n} pares de datos con ambas variables y se necesitan al menos ${MIN_CORR}.`}
          controls={
            <>
              <div className="chips">
                {([['airTemp', 'relHumidity', 'T vs HR'], ['airTemp', 'soilTemp', 'T aire vs T suelo'], ['outsideTemp', 'airTemp', 'T exterior vs interior']] as [NumericKey, NumericKey, string][]).map(([a, b, l]) => (
                  <button key={l} className={`chip ${cx === a && cy === b ? 'active' : ''}`} onClick={() => { setCx(a); setCy(b); }}>{l}</button>
                ))}
              </div>
              <VarSelect id="corr-x" label="Eje X" value={cx} onChange={setCx} records={periodRecords} />
              <VarSelect id="corr-y" label="Eje Y" value={cy} onChange={setCy} records={periodRecords} />
            </>
          }
          footer={
            corr.r !== null && corr.n >= MIN_CORR && (
              <div className="kpi-row" style={{ marginTop: 0 }}>
                <span className="kpi green">Pearson r <b>{fmt(corr.r, 2)}</b></span>
                <span className="kpi">R² <b>{fmt(corr.r * corr.r, 2)}</b></span>
                <span className="kpi">n <b>{corr.n}</b></span>
                <span className="kpi">Ecuación <b>y = {fmt(corr.intercept, 2)} {corr.slope! < 0 ? '−' : '+'} {fmt(Math.abs(corr.slope!), 3)}·x</b></span>
                <span className="kpi">Interpretación <b>{describeCorrelation(corr.r)}</b></span>
              </div>
            )
          }
        />
      )}
      {tab === 'daily' && <p className="small muted" style={{ marginTop: 10 }}><CalendarRange size={13} /> Los promedios usan todos los registros válidos de cada día; si el sensor registra con distinta frecuencia según la hora, compáralo con el gráfico de registros por hora.</p>}
    </>
  );
}

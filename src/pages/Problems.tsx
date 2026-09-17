import { CircleCheck, ShieldAlert, Target } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { hourRiskOption } from '../charts/tomato';
import { ProblemCard, SourceBadge } from '../components/agro';
import { ChartCard } from '../components/ChartCard';
import { PeriodFilter } from '../components/PeriodFilter';
import { EmptyState, PageHeader } from '../components/ui';
import type { RecordSource } from '../db/types';
import { detectProblems } from '../lib/problems';
import { fmt } from '../lib/variables';
import { useData } from '../state/DataContext';

const CLIMATE = ['Exceso de temperatura', 'Temperatura baja', 'Humedad relativa elevada', 'Humedad relativa baja', 'Variaciones bruscas'];

export default function Problems() {
  const { ready, periodRecords, historyRecords, resolved, thresholds, settings } = useData();

  const pa = useMemo(() => {
    const all = historyRecords.filter((r) => r.date >= resolved.from && r.date <= resolved.to);
    return detectProblems(periodRecords, all, thresholds, settings, resolved.from, resolved.to);
  }, [periodRecords, historyRecords, resolved, thresholds, settings]);
  const risk = useMemo(() => hourRiskOption(pa.ind), [pa]);

  if (!ready) return <div className="loading">Cargando…</div>;

  const q = pa.quality;
  const climate = pa.problems.filter((p) => CLIMATE.includes(p.category));
  const dataProblems = pa.problems.filter((p) => !CLIMATE.includes(p.category));

  return (
    <>
      <PageHeader
        title="Problemas climáticos detectados"
        description="Resolución de problemas prácticos: de los datos del sensor a condiciones que requieren observación en el cultivo de tomate."
        icon={<ShieldAlert size={22} />}
      />
      <PeriodFilter />

      <div className="notice info disclaimer" style={{ marginBottom: 16 }}>
        <ShieldAlert size={18} />
        <span>
          Esta sección identifica <strong>condiciones climáticas</strong> a partir de los registros. <strong>No diagnostica enfermedades ni plagas</strong>: no dispone de datos fitosanitarios. Toda condición señalada debe verificarse en campo.
        </span>
      </div>

      <section className="card card-pad">
        <h3 className="card-title"><Target size={17} className="text-green" /> Problema práctico planteado</h3>
        <div className="problem-statement">
          <strong>Planteamiento</strong>
          {settings.studyProblem}
        </div>
        <h4 style={{ margin: '4px 0 8px', fontSize: 14 }}>Respuesta basada en los datos</h4>
        <ul className="verdict">{pa.verdict.map((v, i) => <li key={i}>{v}</li>)}</ul>
        <p className="small muted" style={{ marginTop: 10 }}>Puedes modificar el planteamiento y los rangos de referencia en <Link to="/configuracion">Configuración</Link>.</p>
      </section>

      <div className="section-head">
        <h2>Calidad y procedencia de los datos</h2>
        <p>{resolved.label}</p>
      </div>
      <section className="card card-pad">
        <dl className="quality-grid">
          <div><dt>Registros en el periodo</dt><dd>{q.total.toLocaleString('es-EC')}</dd></div>
          <div><dt>Válidos / sospechosos / descartados</dt><dd>{q.byValidation.valido} <small>/ {q.byValidation.sospechoso} / {q.byValidation.descartado}</small></dd></div>
          <div><dt>Días con datos</dt><dd>{q.daysWithData} <small>de {q.totalDays} ({fmt(q.coveragePct, 0)} %)</small></dd></div>
          <div><dt>Intervalo típico</dt><dd>{q.medianIntervalMin ? (q.medianIntervalMin >= 60 ? `${fmt(q.medianIntervalMin / 60, 1)} h` : `${Math.round(q.medianIntervalMin)} min`) : '—'}</dd></div>
          <div><dt>Vacíos &gt; {settings.gapHours} h</dt><dd>{q.gaps.length}</dd></div>
        </dl>
        <div className="source-row">
          <span>Fuentes:</span>
          {(Object.entries(q.bySource) as [RecordSource, number][]).map(([s, n]) => (
            <span key={s}><SourceBadge source={s} /> {n}</span>
          ))}
          {q.sensors.length > 0 && <span className="muted">· Sensores: {q.sensors.join(', ')}</span>}
        </div>
      </section>

      {periodRecords.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState icon={<ShieldAlert size={30} />} title="Sin registros válidos en el periodo">No es posible identificar problemas climáticos sin datos. Selecciona otro periodo o importa los datos del sensor.</EmptyState>
        </div>
      ) : (
        <>
          <div className="section-head">
            <h2>Condiciones climáticas identificadas</h2>
            <p>{climate.length} {climate.length === 1 ? 'problema' : 'problemas'} · ordenados por prioridad</p>
          </div>
          {climate.length === 0 ? (
            <div className="notice ok"><CircleCheck size={18} /><span>No se identificaron registros fuera de los rangos de referencia ni variaciones bruscas en el periodo.</span></div>
          ) : (
            <div className="problem-list">{climate.map((p) => <ProblemCard key={p.id} problem={p} />)}</div>
          )}

          <div style={{ marginTop: 16 }}>
            <ChartCard
              title="Horas más críticas del día"
              subtitle="Porcentaje de lecturas de cada hora que estuvieron fuera del rango de referencia"
              option={risk}
              height={300}
              empty={!pa.ind.n}
            />
          </div>
        </>
      )}

      {dataProblems.length > 0 && (
        <>
          <div className="section-head">
            <h2>Limitaciones de los datos</h2>
            <p>Condicionan la validez de las conclusiones</p>
          </div>
          <div className="problem-list">{dataProblems.map((p) => <ProblemCard key={p.id} problem={p} />)}</div>
        </>
      )}
    </>
  );
}

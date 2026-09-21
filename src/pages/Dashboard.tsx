import {
  Activity,
  CalendarClock,
  ClipboardPen,
  CloudDrizzle,
  Database,
  Droplets,
  FlaskConical,
  Leaf,
  Snowflake,
  Sun,
  Thermometer,
  TrendingDown,
  TrendingUp,
  ShowerHead,
  Upload,
  Waves,
} from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { timeSeriesOption } from '../charts/options';
import { rangeDistributionOption } from '../charts/tomato';
import { InsufficientNotice, periodReference, ReferenceNote, SourceBadge } from '../components/agro';
import { ChartCard } from '../components/ChartCard';
import { PeriodFilter } from '../components/PeriodFilter';
import { EmptyState, PageHeader, StatCard } from '../components/ui';
import { saveSettings } from '../db/db';
import { hasDemoData, seedDemoData } from '../db/seed';
import { SEVERITY_LABELS } from '../lib/problems';
import { detectProblems } from '../lib/problems';
import { dataConclusions } from '../lib/applied';
import { runLabel } from '../lib/agro';
import { fmtDate, fmtDateLong } from '../lib/dates';
import { summarize } from '../lib/stats';
import { fmt, fmtHours } from '../lib/variables';
import { SOURCE_LABELS, type RecordSource } from '../db/types';
import { useData } from '../state/DataContext';
import { useEsp32 } from '../state/Esp32Context';
import { useToast } from '../state/Toast';
import { AmbientCards, Esp32Badge, ParcelCard } from '../components/irrigation';
import { useLastSystemRecord } from './Irrigation';

/** Condiciones ambientales (2 puntos) y las 4 parcelas: lectura en vivo del ESP32 o último dato guardado. */
function SystemOverview() {
  const esp = useEsp32();
  const last = useLastSystemRecord();
  const r = esp.connected ? esp.reading : null;
  if (!r && !last && !esp.transportKind) {
    return (
      <div className="notice info" style={{ marginBottom: 16 }}>
        <ShowerHead size={18} />
        <span>Sistema de 4 parcelas y 2 puntos ambientales: configura la conexión con el ESP32 en <Link to="/configuracion">Configuración</Link> para ver las lecturas y controlar las electroválvulas.</span>
      </div>
    );
  }
  return (
    <>
      <div className="section-head">
        <h2><ShowerHead size={18} className="text-green" /> Condiciones ambientales <Esp32Badge /></h2>
        <Link to="/riego" className="small">Riego y control →</Link>
      </div>
      <AmbientCards t1={r ? r.airTemp1 : last?.airTemp1} h1={r ? r.relHumidity1 : last?.relHumidity1} t2={r ? r.airTemp2 : last?.airTemp2} h2={r ? r.relHumidity2 : last?.relHumidity2} ts={last?.ts} />
      <div className="section-head"><h2>Parcelas</h2></div>
      <div className="parcel-grid" style={{ marginBottom: 8 }}>
        {esp.parcels.map((p) => (
          <ParcelCard
            key={p.key}
            parcel={p}
            control={false}
            soil={r ? r.soil[p.n - 1] : (last?.[`soilMoisture${p.n}` as 'soilMoisture1'] ?? null)}
            valve={r ? r.valves[p.n - 1] : (last?.[`valve${p.n}` as 'valve1'] ?? null)}
            lastTs={last?.ts}
          />
        ))}
      </div>
    </>
  );
}

const pct =(a: number, b: number) => (b > 0 ? `${fmt((a / b) * 100, 0)} % del tiempo` : '—');

export default function Dashboard() {
  const { ready, records, historyRecords, periodRecords, resolved, settings, thresholds, isDemo } = useData();
  const toast = useToast();
  const last = records[records.length - 1];

  const data = useMemo(() => {
    const allInPeriod = historyRecords.filter((r) => r.date >= resolved.from && r.date <= resolved.to);
    const pa = detectProblems(periodRecords, allInPeriod, thresholds, settings, resolved.from, resolved.to);
    const ref = periodReference(periodRecords, thresholds);
    return {
      pa,
      ref,
      t: summarize(periodRecords, 'airTemp'),
      h: summarize(periodRecords, 'relHumidity'),
      series: timeSeriesOption(periodRecords, 'airTemp', { threshold: ref }),
      distribution: rangeDistributionOption(pa.ind),
      conclusions: dataConclusions(periodRecords, thresholds, pa, resolved.from, resolved.to).slice(0, 3),
    };
  }, [historyRecords, periodRecords, resolved, thresholds, settings]);

  if (!ready) return <div className="loading">Cargando datos…</div>;

  if (!last) {
    return (
      <>
        <PageHeader title="Monitoreo del cultivo de tomate" description="Invernadero UCACUE · Climatología aplicada" icon={<Leaf size={22} />} />
        <SystemOverview />
        <EmptyState icon={<Thermometer size={30} />} title="Aún no hay datos del invernadero">
          {isDemo
            ? 'No hay datos de demostración cargados.'
            : 'Importa los archivos del sensor o datalogger (Excel/CSV), o registra una medición manual. Para conocer la herramienta puedes activar los datos de demostración, que se guardan por separado y nunca se mezclan con los datos reales.'}
          <span className="empty-actions">
            <Link to="/importar" className="btn btn-primary"><Upload size={17} /> Importar datos de sensores</Link>
            <Link to="/registrar" className="btn btn-secondary"><ClipboardPen size={17} /> Registro manual</Link>
            <button
              className="btn btn-light"
              onClick={async () => {
                if (!(await hasDemoData())) await seedDemoData();
                await saveSettings({ dataMode: 'demo' });
                toast('Modo demostración activado. Tus datos reales no se modifican.', 'info');
              }}
            >
              <FlaskConical size={17} /> Ver datos de demostración
            </button>
          </span>
        </EmptyState>
      </>
    );
  }

  const { pa, t, h, ref } = data;
  const ind = pa.ind;
  const covered = ind.coveredHours;
  const has = periodRecords.length > 0;
  const bySource = Object.entries(pa.quality.bySource) as [RecordSource, number][];
  const humid = ind.humidRuns[0];
  const climateProblems = pa.problems.filter((p) => p.category !== 'Datos sospechosos');

  return (
    <>
      <PageHeader
        title="Monitoreo del cultivo de tomate"
        description={<>Última medición: <strong>{fmtDateLong(last.date)}, {last.time}</strong> · <SourceBadge source={last.source} /></>}
        icon={<Leaf size={22} />}
        actions={
          <>
            <Link to="/importar" className="btn btn-secondary"><Upload size={17} /> Importar sensor</Link>
            <Link to="/registrar" className="btn btn-primary"><ClipboardPen size={17} /> Registrar</Link>
          </>
        }
      />

      <SystemOverview />

      <PeriodFilter />

      <div className="section-head">
        <h2><Thermometer size={18} className="text-green" /> Indicadores climáticos</h2>
        <p>{has ? `${periodRecords.length} registros válidos del periodo` : 'Sin registros en el periodo seleccionado'}</p>
      </div>
      <div className="stats-grid">
        <StatCard tone="orange" icon={<Thermometer size={21} />} label="Último registro" value={fmt(last.airTemp)} unit="°C" hint={<>{fmt(last.relHumidity, 0)} % HR · {fmtDate(last.date)} {last.time}</>} />
        <StatCard tone="green" icon={<Activity size={21} />} label="Temperatura promedio" value={fmt(t.mean)} unit="°C" hint={has ? `Periodo: ${resolved.label.split(' (')[0]}` : 'Sin datos'} />
        <StatCard tone="red" icon={<TrendingUp size={21} />} label="Temperatura máxima" value={fmt(t.max)} unit="°C" hint={t.maxRecord ? `${fmtDate(t.maxRecord.date)} · ${t.maxRecord.time}` : 'Sin datos'} />
        <StatCard tone="blue" icon={<TrendingDown size={21} />} label="Temperatura mínima" value={fmt(t.min)} unit="°C" hint={t.minRecord ? `${fmtDate(t.minRecord.date)} · ${t.minRecord.time}` : 'Sin datos'} />
        <StatCard tone="teal" icon={<Droplets size={21} />} label="Humedad relativa promedio" value={fmt(h.mean, 0)} unit="%" hint={has ? `Máx. ${fmt(h.max, 0)} % · Mín. ${fmt(h.min, 0)} %` : 'Sin datos'} />
        <StatCard tone="gray" icon={<Database size={21} />} label="Número de registros" value={periodRecords.length.toLocaleString('es-EC')} hint={bySource.length ? bySource.map(([s, n]) => `${SOURCE_LABELS[s]}: ${n}`).join(' · ') : 'Sin datos'} />
        <StatCard tone="amber" icon={<CalendarClock size={21} />} label="Última medición" value={<span style={{ fontSize: 18 }}>{last.time}</span>} hint={`${fmtDate(last.date)}${last.sensorId ? ` · ${last.sensorId}` : ''}`} />
      </div>

      <div className="section-head">
        <h2><Leaf size={18} className="text-green" /> Indicadores agronómicos del tomate</h2>
        <p>Horas estimadas según el intervalo entre mediciones{ind.medianIntervalMin ? ` (típico: ${Math.round(ind.medianIntervalMin)} min)` : ''}</p>
      </div>
      {!ind.sufficient && <InsufficientNotice>{ind.reason} Los indicadores se muestran solo como referencia.</InsufficientNotice>}
      <div className="stats-grid" style={{ marginTop: ind.sufficient ? 0 : 12 }}>
        <StatCard tone="red" icon={<Sun size={21} />} label="Horas con temperatura elevada" value={has ? fmtHours(ind.hoursTempHigh) : '—'} hint={has ? `${pct(ind.hoursTempHigh, covered)} · ${ind.countTempHigh} registros` : 'Sin datos'} />
        <StatCard tone="blue" icon={<Snowflake size={21} />} label="Horas con temperatura baja" value={has ? fmtHours(ind.hoursTempLow) : '—'} hint={has ? `${pct(ind.hoursTempLow, covered)} · ${ind.countTempLow} registros` : 'Sin datos'} />
        <StatCard tone="teal" icon={<CloudDrizzle size={21} />} label="Horas con HR elevada" value={has ? fmtHours(ind.hoursHumHigh) : '—'} hint={has ? `${pct(ind.hoursHumHigh, covered)} · ${ind.countHumHigh} registros` : 'Sin datos'} />
        <StatCard tone="green" icon={<Leaf size={21} />} label="Horas dentro del rango del tomate" value={has ? fmtHours(ind.hoursBothInRange) : '—'} hint={has ? `${pct(ind.hoursBothInRange, covered)} (temperatura y HR)` : 'Sin datos'} />
        <StatCard
          tone="orange"
          icon={<Activity size={21} />}
          label="Mayor variación térmica"
          value={ind.maxAmplitudeDay ? fmt(ind.maxAmplitudeDay.range) : '—'}
          unit="°C"
          hint={ind.maxAmplitudeDay ? `${fmtDate(ind.maxAmplitudeDay.date)} (${fmt(ind.maxAmplitudeDay.min)}–${fmt(ind.maxAmplitudeDay.max)} °C)${ind.maxChange ? ` · salto máx. ${fmt(ind.maxChange.delta)} °C a las ${ind.maxChange.to.time}` : ''}` : 'Se necesitan 2+ mediciones por día'}
        />
        <StatCard
          tone="blue"
          icon={<Waves size={21} />}
          label="Periodo de mayor humedad"
          value={humid ? fmtHours(humid.hours) : '—'}
          hint={humid ? `${runLabel(humid)} · máx. ${fmt(humid.peak, 0)} %` : has ? 'Sin periodos sobre la referencia' : 'Sin datos'}
        />
      </div>
      <ReferenceNote threshold={ref} text={settings.referenceSource} />

      <div className="grid-main-side" style={{ marginTop: 16 }}>
        <ChartCard
          title="Temperatura del aire y rango de referencia"
          subtitle="Rojo: sobre la referencia · azul: bajo la referencia · banda verde: rango del tomate"
          option={data.series}
          height={320}
          empty={!has}
        />
        <section className="card card-pad">
          <h3 className="card-title">
            Problemas climáticos detectados
            <span className="count">{climateProblems.length ? `${climateProblems.length}` : ''}</span>
          </h3>
          {climateProblems.length === 0 ? (
            <div className="notice ok">No se detectaron problemas climáticos con los rangos de referencia configurados.</div>
          ) : (
            <div className="alert-list">
              {climateProblems.slice(0, 4).map((p) => (
                <Link key={p.id} to="/problemas" className={`problem-mini sev-${p.severity}`}>
                  <span className={`sev-chip sev-${p.severity}`}>{SEVERITY_LABELS[p.severity]}</span>
                  <strong>{p.category}</strong>
                  <span>{p.facts[0]}</span>
                </Link>
              ))}
            </div>
          )}
          <Link to="/problemas" className="btn btn-secondary btn-sm" style={{ marginTop: 12 }}>Ver análisis de problemas</Link>
        </section>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <ChartCard title="Registros respecto a la referencia" subtitle="Porcentaje de registros por debajo, dentro y por encima del rango" option={data.distribution} height={220} empty={!has} />
        <section className="card card-pad">
          <h3 className="card-title">Conclusiones del periodo</h3>
          <ul className="conclusions">{data.conclusions.map((c, i) => <li key={i}>{c}</li>)}</ul>
          <div className="quick-actions" style={{ marginTop: 14 }}>
            <Link to="/analisis" className="btn btn-secondary btn-sm">Preguntas prácticas</Link>
            <Link to="/reportes" className="btn btn-secondary btn-sm">Reporte académico</Link>
          </div>
        </section>
      </div>
    </>
  );
}

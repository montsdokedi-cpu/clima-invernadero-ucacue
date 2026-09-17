import { hourRange, type AgroIndicators, type GroupStats } from '../lib/agro';
import { fmtDate, fmtDateShort } from '../lib/dates';
import type { PeriodSummary } from '../lib/stats';
import { fmt, VARIABLES } from '../lib/variables';
import type { EChartsOption } from './echarts';
import { base, COLORS, valueAxis } from './options';

// Gráficos orientados al cultivo de tomate (Climatología Aplicada).

const r1 = (v: number | null, d = 1) => (v === null ? null : +v.toFixed(d));
const tip = () => base().tooltip as object;

/** Evolución diaria: T promedio (barras), máxima y mínima (líneas), HR promedio (eje derecho). */
export function dailyEvolutionOption(days: PeriodSummary[], interactive = true): EChartsOption {
  return {
    ...base(interactive, days.length > 14),
    tooltip: {
      ...tip(),
      formatter: (params: unknown) => {
        const ps = params as { dataIndex: number; seriesName: string; marker: string; value: number | null }[];
        if (!ps.length) return '';
        const d = days[ps[0].dataIndex];
        return [
          `<b>${fmtDate(d.key)}</b> <span style="color:#62716a">(${d.n} registros)</span>`,
          ...ps.map((p) => `${p.marker}${p.seriesName}: <b>${p.value ?? '—'} ${p.seriesName.startsWith('HR') ? '%' : '°C'}</b>`),
        ].join('<br/>');
      },
    },
    xAxis: { type: 'category', data: days.map((d) => fmtDateShort(d.key)), axisLabel: { color: '#62716a', hideOverlap: true } },
    yAxis: [valueAxis('°C'), valueAxis('HR %', { splitLine: { show: false }, min: 0, max: 100, scale: false })],
    series: [
      { name: 'T. promedio', type: 'bar', data: days.map((d) => r1(d.stats.airTemp.mean)), itemStyle: { color: VARIABLES.airTemp.color, opacity: 0.8, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 26 },
      { name: 'T. máxima', type: 'line', data: days.map((d) => r1(d.stats.airTemp.max)), lineStyle: { color: COLORS.red, width: 1.8 }, itemStyle: { color: COLORS.red }, symbolSize: 5 },
      { name: 'T. mínima', type: 'line', data: days.map((d) => r1(d.stats.airTemp.min)), lineStyle: { color: '#5b6fd6', width: 1.8 }, itemStyle: { color: '#5b6fd6' }, symbolSize: 5 },
      { name: 'HR promedio', type: 'line', yAxisIndex: 1, data: days.map((d) => r1(d.stats.relHumidity.mean, 0)), lineStyle: { color: COLORS.blue, width: 2, type: 'dashed' }, itemStyle: { color: COLORS.blue }, symbolSize: 5 },
    ],
  };
}

/** Porcentaje de registros por debajo, dentro y por encima de la referencia. */
export function rangeDistributionOption(ind: AgroIndicators, interactive = true): EChartsOption {
  const cats = ['Temperatura', 'Humedad relativa'];
  const counts = [
    [ind.countTempLow, ind.countTempInRange, ind.countTempHigh],
    [ind.countHumLow, ind.countHumInRange, ind.countHumHigh],
  ];
  const hours = [
    [ind.hoursTempLow, ind.hoursTempInRange, ind.hoursTempHigh],
    [ind.hoursHumLow, ind.hoursHumInRange, ind.hoursHumHigh],
  ];
  const names = ['Por debajo', 'Dentro del rango', 'Por encima'];
  const colors = [COLORS.blue, COLORS.green, COLORS.red];
  const total = Math.max(ind.n, 1);
  return {
    ...base(interactive, false),
    grid: { left: 12, right: 24, top: 48, bottom: 16, containLabel: true },
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: (p: unknown) => {
        const q = p as { seriesIndex: number; dataIndex: number; marker: string };
        const c = counts[q.dataIndex][q.seriesIndex];
        return `${q.marker}<b>${cats[q.dataIndex]} · ${names[q.seriesIndex]}</b><br/>${c} registros (${fmt((c / total) * 100, 1)} %)<br/>≈ ${fmt(hours[q.dataIndex][q.seriesIndex], 1)} h estimadas`;
      },
    },
    xAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value} %', color: '#62716a' }, splitLine: { lineStyle: { color: '#edf1ee' } } },
    yAxis: { type: 'category', data: cats, axisLabel: { color: '#33413a', fontWeight: 600 } },
    series: names.map((name, i) => ({
      name,
      type: 'bar' as const,
      stack: 'total',
      barWidth: 34,
      itemStyle: { color: colors[i] },
      label: { show: true, formatter: (p: { value: unknown }) => (Number(p.value) >= 6 ? `${fmt(Number(p.value), 0)} %` : ''), color: '#fff', fontWeight: 600 },
      data: counts.map((row) => +((row[i] / total) * 100).toFixed(1)),
    })) as EChartsOption['series'],
  };
}

/** Frecuencia de condiciones fuera de la referencia por hora del día (horas críticas). */
export function hourRiskOption(ind: AgroIndicators, interactive = true): EChartsOption {
  const hours = ind.hourProfile;
  return {
    ...base(interactive, false),
    tooltip: {
      ...tip(),
      formatter: (params: unknown) => {
        const ps = params as { dataIndex: number; seriesName: string; marker: string; value: number }[];
        if (!ps.length) return '';
        const p = hours[ps[0].dataIndex];
        return [`<b>${hourRange(p.hour)}</b> <span style="color:#62716a">(${p.n} lecturas)</span>`, ...ps.map((s) => `${s.marker}${s.seriesName}: <b>${fmt(s.value, 0)} %</b>`)].join('<br/>');
      },
    },
    xAxis: { type: 'category', data: hours.map((h) => `${String(h.hour).padStart(2, '0')}h`), axisLabel: { color: '#62716a' } },
    yAxis: valueAxis('% de lecturas', { scale: false, max: 100 }),
    series: [
      { name: 'T. sobre la referencia', type: 'bar', data: hours.map((h) => +h.pctHot.toFixed(1)), itemStyle: { color: COLORS.red, borderRadius: [3, 3, 0, 0] } },
      { name: 'HR sobre la referencia', type: 'bar', data: hours.map((h) => +h.pctHumid.toFixed(1)), itemStyle: { color: COLORS.blue, borderRadius: [3, 3, 0, 0] } },
      { name: 'T. bajo la referencia', type: 'bar', data: hours.map((h) => +h.pctCold.toFixed(1)), itemStyle: { color: '#8e9bd8', borderRadius: [3, 3, 0, 0] } },
    ],
  };
}

/** Comparación de grupos (mañana/tarde, etapas, periodos): temperatura y HR. */
export function groupCompareOption(groups: GroupStats[], interactive = true): EChartsOption {
  const g = groups.filter((x) => x.n > 0);
  return {
    ...base(interactive, false),
    tooltip: {
      ...tip(),
      formatter: (params: unknown) => {
        const ps = params as { dataIndex: number; seriesName: string; marker: string; value: number | null }[];
        if (!ps.length) return '';
        const x = g[ps[0].dataIndex];
        return [
          `<b>${x.key}</b> <span style="color:#62716a">(${x.n} registros)</span>`,
          ...ps.map((p) => `${p.marker}${p.seriesName}: <b>${p.value ?? '—'} ${p.seriesName.startsWith('HR') ? '%' : '°C'}</b>`),
          `Dentro de la referencia · T: <b>${fmt(x.pctTempInRange, 0)} %</b> · HR: <b>${fmt(x.pctHumInRange, 0)} %</b>`,
        ].join('<br/>');
      },
    },
    xAxis: { type: 'category', data: g.map((x) => x.key), axisLabel: { color: '#33413a', interval: 0, width: 100, overflow: 'break' } },
    yAxis: [valueAxis('°C', { scale: false }), valueAxis('HR %', { splitLine: { show: false }, min: 0, max: 100, scale: false })],
    series: [
      { name: 'T. máxima', type: 'bar', data: g.map((x) => r1(x.maxT)), itemStyle: { color: COLORS.red, opacity: 0.8, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 22 },
      { name: 'T. promedio', type: 'bar', data: g.map((x) => r1(x.meanT)), itemStyle: { color: VARIABLES.airTemp.color, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 22 },
      { name: 'T. mínima', type: 'bar', data: g.map((x) => r1(x.minT)), itemStyle: { color: '#5b6fd6', opacity: 0.8, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 22 },
      { name: 'HR promedio', type: 'line', yAxisIndex: 1, data: g.map((x) => r1(x.meanH, 0)), lineStyle: { color: COLORS.blue, width: 2.5 }, itemStyle: { color: COLORS.blue }, symbolSize: 9, label: { show: true, formatter: '{c} %', color: COLORS.blue, fontSize: 11, position: 'top' } },
    ],
  };
}

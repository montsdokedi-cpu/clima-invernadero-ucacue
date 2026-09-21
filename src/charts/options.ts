import type { ClimateRecord, ClimateThreshold } from '../db/types';
import { fmtDate, fmtDateShort, fmtMonthKey, parseISODate, weekRange } from '../lib/dates';
import { correlation, hourlyMeans, histogram, recordsPerHour, summarize, type PeriodSummary } from '../lib/stats';
import { fmt, isNum, VARIABLES, type NumericKey } from '../lib/variables';
import type { EChartsOption } from './echarts';

// Constructores de opciones de ECharts reutilizados por la pantalla de gráficos,
// el dashboard y los reportes PDF.

export const COLORS = {
  green: '#2f7d4a',
  blue: '#2b7bd6',
  amber: '#d9a21b',
  red: '#d9483b',
  gray: '#8a978f',
  palette: ['#2b7bd6', '#e0663b', '#2f7d4a', '#9b59b6', '#d9a21b', '#1f9e8f', '#c2407a', '#6b7fa8'],
};

const FONT = 'Inter, "Segoe UI", system-ui, sans-serif';
const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function base(interactive = true, zoomX = true): EChartsOption {
  return {
    color: COLORS.palette,
    textStyle: { fontFamily: FONT, color: '#33413a' },
    animationDuration: 350,
    grid: { left: 12, right: 18, top: 56, bottom: interactive && zoomX ? 64 : 16, containLabel: true },
    legend: { top: 6, left: 0, type: 'scroll', itemWidth: 16, itemHeight: 10, textStyle: { fontSize: 12 }, right: interactive ? 90 : 0 },
    tooltip: { trigger: 'axis', confine: true, backgroundColor: 'rgba(255,255,255,0.97)', borderColor: '#dfe6e1', textStyle: { color: '#1d2a22', fontSize: 12 } },
    toolbox: interactive
      ? {
          right: 0,
          top: 0,
          itemSize: 15,
          feature: {
            dataZoom: { yAxisIndex: 'none', title: { zoom: 'Seleccionar área para acercar', back: 'Deshacer acercamiento' } },
            restore: { title: 'Restablecer vista' },
          },
        }
      : { show: false },
    dataZoom: interactive && zoomX
      ? [
          { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
          { type: 'slider', xAxisIndex: 0, height: 20, bottom: 10, filterMode: 'none', borderColor: '#dfe6e1', fillerColor: 'rgba(47,125,74,0.12)' },
        ]
      : [],
  };
}

export const valueAxis = (name: string, extra: Record<string, unknown> = {}) => ({
  type: 'value' as const,
  name,
  nameTextStyle: { color: '#62716a', fontSize: 11, align: 'left' as const },
  scale: true,
  splitLine: { lineStyle: { color: '#edf1ee' } },
  axisLabel: { color: '#62716a' },
  ...extra,
});

function timeLabel(v: number) {
  const d = new Date(v);
  if (d.getHours() === 0 && d.getMinutes() === 0) return `{b|${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}}`;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const timeAxis = () => ({
  type: 'time' as const,
  axisLabel: { formatter: timeLabel, hideOverlap: true, color: '#62716a', rich: { b: { fontWeight: 600 as const, color: '#33413a' } } },
  splitLine: { show: false },
});

export function tsTooltip(params: unknown) {
  const ps = (Array.isArray(params) ? params : [params]) as { value: [number, number]; seriesName: string; marker: string }[];
  if (!ps.length) return '';
  const d = new Date(ps[0].value[0]);
  const head = `<b>${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}</b>`;
  return [head, ...ps.map((p) => `${p.marker}${p.seriesName}: <b>${p.value[1] ?? '—'}</b>`)].join('<br/>');
}

interface SeriesOpts {
  interactive?: boolean;
  threshold?: ClimateThreshold;
  showStats?: boolean;
}

/** Variable en función de la hora, con promedio, máximo y mínimo marcados. */
export function timeSeriesOption(records: ClimateRecord[], key: NumericKey, opts: SeriesOpts = {}): EChartsOption {
  const def = VARIABLES[key];
  const data = records.filter((r) => isNum(r[key])).map((r) => [r.ts, r[key] as number]);
  const s = summarize(records, key);
  const markLines: Record<string, unknown>[] = [];
  if (opts.showStats !== false && s.mean !== null)
    markLines.push({ yAxis: +s.mean.toFixed(def.decimals), name: 'Promedio', lineStyle: { color: COLORS.green, type: 'dashed', width: 1.5 }, label: { formatter: `Prom. ${fmt(s.mean, def.decimals)} ${def.unit}`, position: 'insideEndTop', color: COLORS.green, fontWeight: 600 } });
  const th = opts.threshold;
  let band: [number, number] | null = null;
  if (th && (key === 'airTemp' || key === 'relHumidity')) {
    const [lo, hi] = key === 'airTemp' ? [th.tempMin, th.tempMax] : [th.humidityMin, th.humidityMax];
    band = [lo, hi];
    markLines.push(
      { yAxis: hi, lineStyle: { color: COLORS.red, type: 'dashed', width: 1.4 }, label: { formatter: `Referencia máx. ${hi} ${def.unit}`, position: 'insideStartTop', color: COLORS.red, fontSize: 10 } },
      { yAxis: lo, lineStyle: { color: COLORS.blue, type: 'dashed', width: 1.4 }, label: { formatter: `Referencia mín. ${lo} ${def.unit}`, position: 'insideStartBottom', color: COLORS.blue, fontSize: 10 } },
    );
  }
  const showSymbols = data.length <= 80;
  return {
    ...base(opts.interactive),
    // Colorea la línea: rojo sobre la referencia, azul bajo la referencia
    ...(band
      ? { visualMap: { show: false, seriesIndex: 0, dimension: 1, pieces: [{ lt: band[0], color: COLORS.blue }, { gte: band[0], lte: band[1], color: def.color }, { gt: band[1], color: COLORS.red }] } }
      : {}),
    tooltip: { ...(base().tooltip as object), formatter: tsTooltip },
    xAxis: timeAxis(),
    yAxis: valueAxis(def.unit),
    series: [
      {
        name: def.label,
        type: 'line',
        data,
        smooth: 0.25,
        showSymbol: showSymbols,
        symbolSize: 6,
        lineStyle: { width: 2.2, color: def.color },
        itemStyle: { color: def.color },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: def.color + '33' }, { offset: 1, color: def.color + '03' }] } },
        markLine: { symbol: 'none', silent: true, data: markLines as never },
        markArea: band ? { silent: true, itemStyle: { color: 'rgba(47,125,74,0.07)' }, data: [[{ yAxis: band[0] }, { yAxis: band[1] }]] as never } : undefined,
        markPoint:
          opts.showStats !== false && s.maxRecord
            ? {
                symbolSize: 44,
                label: { fontSize: 10, fontWeight: 600 },
                data: [
                  { name: 'Máxima', coord: [s.maxRecord.ts, s.max], value: fmt(s.max, def.decimals), itemStyle: { color: COLORS.red } },
                  { name: 'Mínima', coord: [s.minRecord!.ts, s.min], value: fmt(s.min, def.decimals), itemStyle: { color: COLORS.blue }, symbolRotate: 180, label: { offset: [0, 6] } },
                ] as never,
              }
            : undefined,
      },
    ],
  };
}

/** Dos variables con eje Y doble (ej. temperatura vs humedad). */
export function dualAxisOption(records: ClimateRecord[], a: NumericKey, b: NumericKey, interactive = true): EChartsOption {
  const da = VARIABLES[a];
  const dbv = VARIABLES[b];
  const sameUnit = da.unit === dbv.unit;
  const line = (key: NumericKey, axis: number) => ({
    name: VARIABLES[key].label,
    type: 'line' as const,
    yAxisIndex: axis,
    smooth: 0.25,
    showSymbol: records.length <= 60,
    symbolSize: 5,
    lineStyle: { width: 2, color: VARIABLES[key].color },
    itemStyle: { color: VARIABLES[key].color },
    data: records.filter((r) => isNum(r[key])).map((r) => [r.ts, r[key] as number]),
  });
  return {
    ...base(interactive),
    tooltip: { ...(base().tooltip as object), formatter: tsTooltip },
    xAxis: timeAxis(),
    yAxis: sameUnit
      ? [valueAxis(da.unit)]
      : [valueAxis(`${da.short} (${da.unit})`), valueAxis(`${dbv.short} (${dbv.unit})`, { splitLine: { show: false } })],
    series: [line(a, 0), line(b, sameUnit ? 0 : 1)],
  };
}

const periodTooltip = (unit: string, labels: string[], counts: number[]) => (params: unknown) => {
  const ps = params as { dataIndex: number; seriesName: string; marker: string; value: number | null }[];
  if (!ps.length) return '';
  const i = ps[0].dataIndex;
  return [
    `<b>${labels[i]}</b> <span style="color:#62716a">(${counts[i]} registros)</span>`,
    ...ps.filter((p) => p.seriesName !== '_base').map((p) => `${p.marker}${p.seriesName}: <b>${p.value ?? '—'} ${unit}</b>`),
  ].join('<br/>');
};

type PeriodKind = 'day' | 'week' | 'month';
function periodLabel(kind: PeriodKind, key: string, long = false) {
  if (kind === 'day') return long ? fmtDate(key) : fmtDateShort(key);
  if (kind === 'week') {
    const r = weekRange(key);
    return long ? `Semana ${key.split('-W')[1]} (${fmtDate(r.from)} – ${fmtDate(r.to)})` : `S${key.split('-W')[1]} · ${fmtDateShort(r.from)}`;
  }
  const n = fmtMonthKey(key);
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/** Barras con el promedio (o acumulado) por periodo + líneas de máximo y mínimo. */
export function periodBarsOption(
  periods: PeriodSummary[],
  key: NumericKey,
  kind: PeriodKind,
  interactive = true,
  style: 'bar' | 'line' = 'bar',
): EChartsOption {
  const def = VARIABLES[key];
  const labels = periods.map((p) => periodLabel(kind, p.key));
  const longLabels = periods.map((p) => periodLabel(kind, p.key, true));
  const counts = periods.map((p) => p.n);
  const r = (v: number | null) => (v === null ? null : +v.toFixed(def.decimals));
  const isSum = def.aggregate === 'sum';
  const series: EChartsOption['series'] = [
    {
      name: isSum ? `${def.short} acumulada` : `Promedio ${kind === 'day' ? 'diario' : kind === 'week' ? 'semanal' : 'mensual'}`,
      type: style,
      data: periods.map((p) => r(isSum ? p.stats[key].sum : p.stats[key].mean)),
      itemStyle: { color: style === 'line' ? COLORS.green : def.color, borderRadius: [4, 4, 0, 0], opacity: 0.85 },
      ...(style === 'line'
        ? { smooth: 0.2, symbolSize: 8, lineStyle: { width: 3, color: COLORS.green } }
        : { barMaxWidth: 34 }),
      label: periods.length <= 14 ? { show: true, position: 'top', fontSize: 10, color: '#33413a' } : undefined,
    } as never,
  ];
  if (!isSum)
    series.push(
      { name: 'Máxima', type: 'line', data: periods.map((p) => r(p.stats[key].max)), lineStyle: { color: COLORS.red, width: 1.6 }, itemStyle: { color: COLORS.red }, symbolSize: 5 },
      { name: 'Mínima', type: 'line', data: periods.map((p) => r(p.stats[key].min)), lineStyle: { color: COLORS.blue, width: 1.6 }, itemStyle: { color: COLORS.blue }, symbolSize: 5 },
    );
  return {
    ...base(interactive, periods.length > 12),
    tooltip: { ...(base().tooltip as object), formatter: periodTooltip(def.unit, longLabels, counts) },
    xAxis: { type: 'category', data: labels, axisLabel: { color: '#62716a', hideOverlap: true }, axisTick: { alignWithLabel: true } },
    yAxis: valueAxis(def.unit, isSum ? { scale: false } : {}),
    series,
  };
}

/** Evolución de máximos, mínimos y promedio con banda de amplitud. */
export function maxMinOption(periods: PeriodSummary[], key: NumericKey, interactive = true): EChartsOption {
  const def = VARIABLES[key];
  const labels = periods.map((p) => fmtDateShort(p.key));
  const longLabels = periods.map((p) => fmtDate(p.key));
  const r = (v: number | null) => (v === null ? null : +v.toFixed(def.decimals));
  const mins = periods.map((p) => r(p.stats[key].min));
  return {
    ...base(interactive, periods.length > 14),
    tooltip: { ...(base().tooltip as object), formatter: periodTooltip(def.unit, longLabels, periods.map((p) => p.n)) },
    xAxis: { type: 'category', data: labels, boundaryGap: false, axisLabel: { color: '#62716a', hideOverlap: true } },
    yAxis: valueAxis(def.unit),
    series: [
      { name: '_base', type: 'line', stack: 'band', data: mins, lineStyle: { opacity: 0 }, symbol: 'none', silent: true, tooltip: { show: false } },
      {
        name: 'Amplitud', type: 'line', stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, silent: true,
        data: periods.map((p) => r(p.stats[key].range)), areaStyle: { color: 'rgba(47,125,74,0.10)' },
      },
      { name: 'Máxima', type: 'line', data: periods.map((p) => r(p.stats[key].max)), lineStyle: { color: COLORS.red, width: 2 }, itemStyle: { color: COLORS.red }, symbolSize: 6 },
      { name: 'Promedio', type: 'line', data: periods.map((p) => r(p.stats[key].mean)), lineStyle: { color: COLORS.green, width: 2, type: 'dashed' }, itemStyle: { color: COLORS.green }, symbolSize: 5 },
      { name: 'Mínima', type: 'line', data: mins, lineStyle: { color: COLORS.blue, width: 2 }, itemStyle: { color: COLORS.blue }, symbolSize: 6 },
    ],
    legend: { ...(base().legend as object), data: ['Máxima', 'Promedio', 'Mínima', 'Amplitud'] },
  };
}

/** Superpone varios días usando la hora del día como eje X. */
export function compareDaysOption(records: ClimateRecord[], dates: string[], key: NumericKey, interactive = true): EChartsOption {
  const def = VARIABLES[key];
  return {
    ...base(interactive, false),
    tooltip: {
      ...(base().tooltip as object),
      trigger: 'item',
      formatter: (p: unknown) => {
        const q = p as { seriesName: string; value: [number, number]; marker: string };
        const h = Math.floor(q.value[0]);
        const m = Math.round((q.value[0] - h) * 60);
        return `${q.marker}<b>${q.seriesName}</b><br/>${pad(h)}:${pad(m)} · <b>${q.value[1]} ${def.unit}</b>`;
      },
    },
    xAxis: { type: 'value', min: 0, max: 24, interval: 2, axisLabel: { formatter: (v: number) => `${pad(v)}:00`, color: '#62716a' }, splitLine: { lineStyle: { color: '#f2f5f3' } } },
    yAxis: valueAxis(def.unit),
    series: dates.map((d) => ({
      name: fmtDate(d),
      type: 'line' as const,
      smooth: 0.25,
      symbolSize: 6,
      data: records
        .filter((r) => r.date === d && isNum(r[key]))
        .map((r) => [Number(r.time.slice(0, 2)) + Number(r.time.slice(3, 5)) / 60, r[key] as number]),
    })),
  };
}

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** Compara semanas: promedio diario de cada día de la semana. */
export function compareWeeksOption(records: ClimateRecord[], weekKeys: string[], key: NumericKey, interactive = true): EChartsOption {
  const def = VARIABLES[key];
  return {
    ...base(interactive, false),
    xAxis: { type: 'category', data: WEEKDAYS, axisLabel: { color: '#62716a' } },
    yAxis: valueAxis(def.unit),
    tooltip: { ...(base().tooltip as object), valueFormatter: (v: unknown) => (v == null ? '—' : `${v} ${def.unit}`) },
    series: weekKeys.map((wk) => {
      const { from, to } = weekRange(wk);
      const recs = records.filter((r) => r.date >= from && r.date <= to);
      const byDay = Array.from({ length: 7 }, (_, i) => {
        const dayRecs = recs.filter((r) => (parseISODate(r.date).getDay() + 6) % 7 === i);
        const s = summarize(dayRecs, key);
        return s.mean === null ? null : +s.mean.toFixed(def.decimals);
      });
      return { name: `Semana ${wk.split('-W')[1]} (${fmtDateShort(from)})`, type: 'line' as const, data: byDay, smooth: 0.2, symbolSize: 7, connectNulls: false };
    }),
  };
}

/** Promedio por hora del día. */
export function hourlyProfileOption(records: ClimateRecord[], keys: NumericKey[], interactive = true): EChartsOption {
  const hours = Array.from({ length: 24 }, (_, i) => `${pad(i)}:00`);
  const units = [...new Set(keys.map((k) => VARIABLES[k].unit))];
  return {
    ...base(interactive, false),
    xAxis: { type: 'category', data: hours, axisLabel: { color: '#62716a', interval: 1 } },
    yAxis: units.map((u, i) => valueAxis(u, i > 0 ? { splitLine: { show: false } } : {})),
    tooltip: { ...(base().tooltip as object) },
    series: keys.map((k) => ({
      name: `${VARIABLES[k].label} (prom. por hora)`,
      type: 'line' as const,
      yAxisIndex: units.indexOf(VARIABLES[k].unit),
      connectNulls: true,
      smooth: 0.3,
      symbolSize: 6,
      lineStyle: { color: VARIABLES[k].color, width: 2 },
      itemStyle: { color: VARIABLES[k].color },
      data: hourlyMeans(records, k).map((v) => (v === null ? null : +v.toFixed(VARIABLES[k].decimals))),
    })),
  };
}

export function histogramOption(records: ClimateRecord[], key: NumericKey, interactive = true): EChartsOption {
  const def = VARIABLES[key];
  const values = records.map((r) => r[key]).filter(isNum);
  const width = key === 'airTemp' || key === 'soilTemp' ? 2 : key === 'relHumidity' || key === 'soilMoisture' ? 5 : Math.max(1, Math.ceil((Math.max(...values, 1) - Math.min(...values, 0)) / 12));
  const bins = histogram(values, width);
  return {
    ...base(interactive, false),
    tooltip: { ...(base().tooltip as object), formatter: (p: unknown) => { const q = (p as { dataIndex: number }[])[0]; const b = bins[q.dataIndex]; return `<b>${fmt(b.from, def.decimals)} – ${fmt(b.to, def.decimals)} ${def.unit}</b><br/>${b.count} registros (${fmt((b.count / values.length) * 100, 0)} %)`; } },
    xAxis: { type: 'category', data: bins.map((b) => `${fmt(b.from, 0)}–${fmt(b.to, 0)}`), name: def.unit, axisLabel: { color: '#62716a' } },
    yAxis: valueAxis('Registros', { scale: false, minInterval: 1 }),
    series: [{ name: 'Frecuencia', type: 'bar', data: bins.map((b) => b.count), barCategoryGap: '8%', itemStyle: { color: def.color, borderRadius: [3, 3, 0, 0] } }],
  };
}

export function recordsDistributionOption(records: ClimateRecord[], periods: PeriodSummary[], interactive = true): { byHour: EChartsOption; byDay: EChartsOption } {
  const perHour = recordsPerHour(records);
  return {
    byHour: {
      ...base(interactive, false),
      xAxis: { type: 'category', data: perHour.map((_, i) => `${pad(i)}h`), axisLabel: { color: '#62716a' } },
      yAxis: valueAxis('Registros', { scale: false, minInterval: 1 }),
      series: [{ name: 'Registros por hora del día', type: 'bar', data: perHour, itemStyle: { color: COLORS.green, borderRadius: [3, 3, 0, 0] } }],
    },
    byDay: {
      ...base(interactive, periods.length > 20),
      xAxis: { type: 'category', data: periods.map((p) => fmtDateShort(p.key)), axisLabel: { color: '#62716a', hideOverlap: true } },
      yAxis: valueAxis('Registros', { scale: false, minInterval: 1 }),
      series: [{ name: 'Registros por día', type: 'bar', data: periods.map((p) => p.n), itemStyle: { color: COLORS.blue, borderRadius: [3, 3, 0, 0] } }],
    },
  };
}

/** Dispersión entre dos variables con recta de regresión y coeficiente r. */
export function correlationOption(records: ClimateRecord[], x: NumericKey, y: NumericKey, interactive = true): { option: EChartsOption; r: number | null; n: number; slope: number | null; intercept: number | null } {
  const dx = VARIABLES[x];
  const dy = VARIABLES[y];
  const c = correlation(records, x, y);
  const xs = c.points.map((p) => p[0]);
  const series: EChartsOption['series'] = [
    { name: 'Registros', type: 'scatter', data: c.points, symbolSize: 7, itemStyle: { color: dy.color, opacity: 0.6 } },
  ];
  if (c.slope !== null && c.intercept !== null && xs.length) {
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    series.push({
      name: 'Tendencia lineal', type: 'line', symbol: 'none', lineStyle: { color: COLORS.red, width: 2, type: 'dashed' },
      data: [[x0, +(c.intercept + c.slope * x0).toFixed(2)], [x1, +(c.intercept + c.slope * x1).toFixed(2)]], tooltip: { show: false },
    });
  }
  return {
    ...c,
    option: {
      ...base(interactive, false),
      tooltip: { trigger: 'item', confine: true, formatter: (p: unknown) => { const q = p as { value: [number, number] }; return `${dx.short}: <b>${q.value[0]} ${dx.unit}</b><br/>${dy.short}: <b>${q.value[1]} ${dy.unit}</b>`; } },
      xAxis: { ...valueAxis(`${dx.label} (${dx.unit})`), nameLocation: 'middle', nameGap: 28 },
      yAxis: valueAxis(`${dy.label} (${dy.unit})`),
      grid: { left: 12, right: 18, top: 56, bottom: 36, containLabel: true },
      dataZoom: interactive ? [{ type: 'inside', xAxisIndex: 0 }, { type: 'inside', yAxisIndex: 0 }] : [],
      series,
    },
  };
}

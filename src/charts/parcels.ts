import type { ClimateRecord, ValveEvent } from '../db/types';
import { isNum, VARIABLES, type NumericKey } from '../lib/variables';
import type { EChartsOption } from './echarts';
import { base, COLORS, timeAxis, tsTooltip, valueAxis } from './options';

// Gráficos del sistema de 4 parcelas: tiempo en el eje X, variable en el eje Y.

export function sensorLinesOption(
  records: ClimateRecord[],
  keys: NumericKey[],
  opts: { unit: string; valveEvents?: ValveEvent[]; from?: number; to?: number; interactive?: boolean } = { unit: '' },
): EChartsOption {
  const bands = (opts.valveEvents ?? []).map((e) => [
    { xAxis: Math.max(e.start, opts.from ?? e.start), name: `Riego P${e.parcel}` },
    { xAxis: Math.min(e.end ?? Date.now(), opts.to ?? Date.now()) },
  ]);
  return {
    ...base(opts.interactive ?? true),
    tooltip: { ...(base().tooltip as object), formatter: tsTooltip },
    xAxis: timeAxis(),
    yAxis: valueAxis(opts.unit, opts.unit === '%' ? { scale: false, min: 0, max: 100 } : {}),
    series: keys.map((k, i) => ({
      name: VARIABLES[k].label,
      type: 'line' as const,
      smooth: 0.2,
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 2, color: VARIABLES[k].color },
      itemStyle: { color: VARIABLES[k].color },
      data: records.filter((r) => isNum(r[k])).map((r) => [r.ts, r[k] as number]),
      ...(i === 0 && bands.length
        ? { markArea: { silent: true, itemStyle: { color: 'rgba(43,123,214,0.10)' }, label: { show: false }, data: bands as never } }
        : {}),
    })),
    legend: { ...(base().legend as object), data: keys.map((k) => VARIABLES[k].label) },
    color: COLORS.palette,
  };
}

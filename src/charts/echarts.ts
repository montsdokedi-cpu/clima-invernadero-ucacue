import * as echarts from 'echarts/core';
import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  ToolboxComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  TitleComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export { echarts };
export type { EChartsOption } from 'echarts';

/** Renderiza una opción de gráfico fuera de pantalla y devuelve un JPEG (liviano para PDF). */
export function renderChartImage(option: echarts.EChartsCoreOption, width = 1000, height = 420): string {
  const div = document.createElement('div');
  div.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;`;
  document.body.appendChild(div);
  const chart = echarts.init(div, null, { renderer: 'canvas', width, height });
  const printable: Record<string, unknown> = { ...(option as Record<string, unknown>), animation: false, dataZoom: [], toolbox: { show: false } };
  const grid = printable.grid as Record<string, unknown> | undefined;
  if (grid) printable.grid = { ...grid, bottom: 30 };
  chart.setOption(printable);
  const url = chart.getDataURL({ type: 'jpeg', pixelRatio: 1.6, backgroundColor: '#ffffff' });
  chart.dispose();
  div.remove();
  return url;
}

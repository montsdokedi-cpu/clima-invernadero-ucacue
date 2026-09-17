import { Download, Share2 } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { echarts, type EChartsOption } from '../charts/echarts';
import { dataURLToBlob, downloadBlob, safeFileName, shareOrDownload } from '../lib/download';
import { useToast } from '../state/Toast';

interface ChartProps {
  option: EChartsOption;
  height?: number;
  onReady?: (chart: echarts.ECharts) => void;
}

export function EChart({ option, height = 320, onReady }: ChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, null, { renderer: 'canvas' });
    chartRef.current = chart;
    onReady?.(chart);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={ref} className="echart" style={{ height }} />;
}

interface ChartCardProps extends ChartProps {
  title: string;
  subtitle?: ReactNode;
  controls?: ReactNode;
  footer?: ReactNode;
  empty?: boolean;
  emptyText?: string;
}

export function ChartCard({ title, subtitle, controls, footer, empty, emptyText, ...chart }: ChartCardProps) {
  const chartRef = useRef<echarts.ECharts | null>(null);
  const toast = useToast();

  const image = () => {
    const c = chartRef.current;
    if (!c) return null;
    return dataURLToBlob(c.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff', excludeComponents: ['toolbox', 'dataZoom'] }));
  };
  const name = `${safeFileName(title)}.png`;

  return (
    <section className="card chart-card">
      <header className="chart-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p className="muted small">{subtitle}</p>}
        </div>
        {!empty && (
          <div className="chart-actions">
            <button className="icon-btn" title="Descargar gráfico (PNG)" aria-label="Descargar gráfico" onClick={() => { const b = image(); if (b) downloadBlob(b, name); }}>
              <Download size={17} />
            </button>
            <button
              className="icon-btn"
              title="Compartir gráfico"
              aria-label="Compartir gráfico"
              onClick={async () => {
                const b = image();
                if (!b) return;
                const res = await shareOrDownload(b, name, title);
                if (res === 'downloaded') toast('Tu dispositivo no permite compartir directamente; se descargó la imagen.', 'info');
              }}
            >
              <Share2 size={17} />
            </button>
          </div>
        )}
      </header>
      {controls && <div className="chart-controls">{controls}</div>}
      {empty ? (
        <div className="chart-empty" style={{ height: chart.height ?? 320 }}>
          {emptyText ?? 'No hay datos suficientes para este gráfico en el periodo seleccionado.'}
        </div>
      ) : (
        <EChart {...chart} onReady={(c) => { chartRef.current = c; chart.onReady?.(c); }} />
      )}
      {footer && <footer className="chart-foot">{footer}</footer>}
    </section>
  );
}

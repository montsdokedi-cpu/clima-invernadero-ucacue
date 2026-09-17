import { CalendarDays } from 'lucide-react';
import { saveSettings } from '../db/db';
import { REAL_SOURCES, SOURCE_LABELS } from '../db/types';
import { monthName, todayISO } from '../lib/dates';
import { PRESET_LABELS, type Preset } from '../lib/period';
import { useData } from '../state/DataContext';

const PRESETS: Preset[] = ['today', 'yesterday', '7d', '15d', '30d', 'week', 'month', 'custom', 'all'];

export function PeriodFilter({ compact, showSources = true }: { compact?: boolean; showSources?: boolean }) {
  const { period, setPeriod, resolved, periodRecords, records, settings, isDemo } = useData();
  const today = todayISO();
  const months = [...new Set([today.slice(0, 7), ...records.map((r) => r.date.slice(0, 7))])].sort().reverse();

  const toggleSource = (s: (typeof REAL_SOURCES)[number]) => {
    const cur = settings.sourceFilter;
    const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
    if (next.length) saveSettings({ sourceFilter: next });
  };

  return (
    <div className={`card period-filter ${compact ? 'compact' : ''}`}>
      <div className="period-top">
        <CalendarDays size={18} className="text-green" />
        <div className="chips" role="group" aria-label="Periodo">
          {PRESETS.map((p) => (
            <button key={p} className={`chip ${period.preset === p ? 'active' : ''}`} onClick={() => setPeriod({ ...period, preset: p })}>
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {(period.preset === 'week' || period.preset === 'month' || period.preset === 'custom') && (
        <div className="period-inputs">
          {period.preset === 'week' && (
            <label>
              Cualquier día de la semana
              <input id="period-week" type="date" max={today} value={period.weekDay} onChange={(e) => e.target.value && setPeriod({ ...period, weekDay: e.target.value })} />
            </label>
          )}
          {period.preset === 'month' && (
            <label>
              Mes
              <select id="period-month" value={period.month} onChange={(e) => setPeriod({ ...period, month: e.target.value })}>
                {months.map((m) => {
                  const [y, mm] = m.split('-').map(Number);
                  return (
                    <option key={m} value={m}>
                      {monthName(mm - 1).replace(/^./, (c) => c.toUpperCase())} {y}
                    </option>
                  );
                })}
              </select>
            </label>
          )}
          {period.preset === 'custom' && (
            <>
              <label>
                Desde
                <input id="period-from" type="date" max={today} value={period.from} onChange={(e) => e.target.value && setPeriod({ ...period, from: e.target.value })} />
              </label>
              <label>
                Hasta
                <input id="period-to" type="date" max={today} value={period.to} onChange={(e) => e.target.value && setPeriod({ ...period, to: e.target.value })} />
              </label>
            </>
          )}
        </div>
      )}

      {showSources && (
        <div className="source-row">
          <span>Fuente de datos:</span>
          {isDemo ? (
            <span className="src-badge src-demo">Datos de demostración (simulados)</span>
          ) : (
            REAL_SOURCES.map((s) => (
              <button key={s} className={`chip src-toggle ${settings.sourceFilter.includes(s) ? 'active' : ''}`} onClick={() => toggleSource(s)} aria-pressed={settings.sourceFilter.includes(s)}>
                {SOURCE_LABELS[s]}
              </button>
            ))
          )}
        </div>
      )}

      <p className="period-label">
        <strong>{resolved.label}</strong>
        <span className="muted"> · {periodRecords.length.toLocaleString('es-EC')} registros válidos</span>
      </p>
    </div>
  );
}

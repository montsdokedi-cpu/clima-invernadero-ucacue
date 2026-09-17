import { addDays, fmtDate, fmtDateLong, fmtMonthKey, isoWeekKey, monthRange, todayISO, weekRange } from './dates';

export type Preset = 'today' | 'yesterday' | '7d' | '15d' | '30d' | 'week' | 'month' | 'custom' | 'all';

export interface PeriodState {
  preset: Preset;
  weekDay: string; // cualquier día dentro de la semana elegida
  month: string; // YYYY-MM
  from: string;
  to: string;
}

export const PRESET_LABELS: Record<Preset, string> = {
  today: 'Hoy',
  yesterday: 'Ayer',
  '7d': 'Últimos 7 días',
  '15d': 'Últimos 15 días',
  '30d': 'Últimos 30 días',
  week: 'Semana',
  month: 'Mes',
  custom: 'Personalizado',
  all: 'Todo',
};

export function defaultPeriod(): PeriodState {
  const t = todayISO();
  return { preset: '7d', weekDay: t, month: t.slice(0, 7), from: addDays(t, -6), to: t };
}

export interface ResolvedPeriod {
  from: string;
  to: string;
  label: string;
}

export function resolvePeriod(p: PeriodState, firstDate?: string): ResolvedPeriod {
  const t = todayISO();
  switch (p.preset) {
    case 'today':
      return { from: t, to: t, label: `Hoy, ${fmtDateLong(t)}` };
    case 'yesterday': {
      const y = addDays(t, -1);
      return { from: y, to: y, label: `Ayer, ${fmtDateLong(y)}` };
    }
    case '7d':
    case '15d':
    case '30d': {
      const n = Number(p.preset.replace('d', ''));
      const from = addDays(t, -(n - 1));
      return { from, to: t, label: `Últimos ${n} días (${fmtDate(from)} – ${fmtDate(t)})` };
    }
    case 'week': {
      const key = isoWeekKey(p.weekDay || t);
      const r = weekRange(key);
      return { ...r, label: `Semana ${key.split('-W')[1]} (${fmtDate(r.from)} – ${fmtDate(r.to)})` };
    }
    case 'month': {
      const r = monthRange(p.month || t.slice(0, 7));
      const name = fmtMonthKey(p.month);
      return { ...r, label: name.charAt(0).toUpperCase() + name.slice(1) };
    }
    case 'custom': {
      const from = p.from <= p.to ? p.from : p.to;
      const to = p.from <= p.to ? p.to : p.from;
      return { from, to, label: `Desde ${fmtDate(from)} hasta ${fmtDate(to)}` };
    }
    case 'all': {
      const from = firstDate ?? t;
      return { from, to: t, label: `Todo el historial (${fmtDate(from)} – ${fmtDate(t)})` };
    }
  }
}

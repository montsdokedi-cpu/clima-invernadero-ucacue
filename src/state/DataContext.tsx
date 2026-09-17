import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db, DEFAULT_SETTINGS, ensureBaseData, getSettings } from '../db/db';
import type { AppSettings, ClimateRecord, ClimateThreshold, Crop, Greenhouse, User } from '../db/types';
import { defaultPeriod, resolvePeriod, type PeriodState, type ResolvedPeriod } from '../lib/period';

interface DataContextValue {
  ready: boolean;
  settings: AppSettings;
  isDemo: boolean;
  greenhouses: Greenhouse[];
  crops: Crop[];
  thresholds: ClimateThreshold[];
  users: User[];
  /**
   * Registros para ANÁLISIS: modo actual (real o demo), invernadero seleccionado,
   * fuentes seleccionadas y sin datos descartados. Ordenados por fecha/hora.
   */
  records: ClimateRecord[];
  /** Registros para el HISTORIAL: modo e invernadero, incluye todas las fuentes y los descartados. */
  historyRecords: ClimateRecord[];
  /** Todos los registros del modo actual, sin filtros. */
  allRecords: ClimateRecord[];
  greenhouseFilter: number | null;
  setGreenhouseFilter: (id: number | null) => void;
  greenhouseById: Map<number, Greenhouse>;
  cropById: Map<number, Crop>;
  period: PeriodState;
  setPeriod: (p: PeriodState) => void;
  resolved: ResolvedPeriod;
  /** Registros de análisis dentro del periodo seleccionado */
  periodRecords: ClimateRecord[];
}

const Ctx = createContext<DataContextValue | null>(null);

function loadPeriod(): PeriodState {
  try {
    const raw = localStorage.getItem('clima-ucc-period');
    if (raw) return { ...defaultPeriod(), ...JSON.parse(raw) };
  } catch {
    /* sin almacenamiento */
  }
  return defaultPeriod();
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [baseReady, setBaseReady] = useState(false);
  const [greenhouseFilter, setGreenhouseFilter] = useState<number | null>(null);
  const [period, setPeriodState] = useState<PeriodState>(loadPeriod);

  useEffect(() => {
    ensureBaseData().finally(() => setBaseReady(true));
  }, []);

  const settings = useLiveQuery(() => getSettings(), [], undefined);
  const isDemo = (settings ?? DEFAULT_SETTINGS).dataMode === 'demo';
  const sourceKey = (settings ?? DEFAULT_SETTINGS).sourceFilter.join(',');

  const greenhouses = useLiveQuery(() => db.greenhouses.filter((g) => g.isDemo === isDemo).toArray(), [isDemo]);
  const crops = useLiveQuery(() => db.crops.filter((c) => c.isDemo === isDemo).toArray(), [isDemo]);
  const thresholds = useLiveQuery(() => db.climateThresholds.filter((t) => t.isDemo === isDemo).toArray(), [isDemo]);
  const users = useLiveQuery(() => db.users.filter((u) => u.isDemo === isDemo).toArray(), [isDemo]);
  const allRecords = useLiveQuery(() => db.climateRecords.orderBy('ts').filter((r) => r.isDemo === isDemo).toArray(), [isDemo]);

  useEffect(() => setGreenhouseFilter(null), [isDemo]);

  const historyRecords = useMemo(
    () => (allRecords ?? []).filter((r) => greenhouseFilter === null || r.greenhouseId === greenhouseFilter),
    [allRecords, greenhouseFilter],
  );

  const records = useMemo(() => {
    const sources = new Set(sourceKey.split(','));
    return historyRecords.filter((r) => r.validation !== 'descartado' && (isDemo || sources.has(r.source)));
  }, [historyRecords, sourceKey, isDemo]);

  const resolved = useMemo(() => resolvePeriod(period, records[0]?.date), [period, records]);
  const periodRecords = useMemo(() => records.filter((r) => r.date >= resolved.from && r.date <= resolved.to), [records, resolved]);

  const value: DataContextValue = {
    ready: baseReady && !!settings && !!greenhouses && !!crops && !!thresholds && !!allRecords && !!users,
    settings: settings ?? DEFAULT_SETTINGS,
    isDemo,
    greenhouses: greenhouses ?? [],
    crops: crops ?? [],
    thresholds: thresholds ?? [],
    users: users ?? [],
    records,
    historyRecords,
    allRecords: allRecords ?? [],
    greenhouseFilter,
    setGreenhouseFilter,
    greenhouseById: useMemo(() => new Map((greenhouses ?? []).map((g) => [g.id!, g])), [greenhouses]),
    cropById: useMemo(() => new Map((crops ?? []).map((c) => [c.id!, c])), [crops]),
    period,
    setPeriod: (p) => {
      setPeriodState(p);
      try {
        localStorage.setItem('clima-ucc-period', JSON.stringify(p));
      } catch {
        /* sin almacenamiento */
      }
    },
    resolved,
    periodRecords,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData debe usarse dentro de DataProvider');
  return v;
}

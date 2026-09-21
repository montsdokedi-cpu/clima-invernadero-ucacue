import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db } from '../db/db';
import type { ClimateRecord, Parcel, ParcelId, ValveEvent, ValveOrigin } from '../db/types';
import { stageForDate } from '../lib/agro';
import type { ClimateAlert } from '../lib/alerts';
import { toISODate } from '../lib/dates';
import { parseEsp32Payload, type Esp32Reading } from '../lib/esp32/protocol';
import { HttpTransport, SimulatorTransport, type Esp32Transport } from '../lib/esp32/transport';
import { decide, irrigationAlerts } from '../lib/irrigation';
import { assessRecord } from '../lib/validation';
import { isNum } from '../lib/variables';
import { useData } from './DataContext';

// Servicio de comunicación con el ESP32: consulta periódica, guardado en el histórico,
// registro de activaciones de electroválvulas, confirmación de órdenes y alertas.

export type ConnStatus = 'desactivado' | 'sin-configurar' | 'conectando' | 'conectado' | 'desconectado';

interface Pending {
  desired: boolean;
  since: number;
  origin: ValveOrigin;
  reason: string;
}

interface Esp32ContextValue {
  status: ConnStatus;
  connected: boolean;
  transportKind: 'http' | 'simulador' | null;
  address: string;
  lastOk: number | null;
  lastAttempt: number | null;
  lastError: string | null;
  latencyMs: number | null;
  ip: string | null;
  firmware: string | null;
  reading: Esp32Reading | null;
  parcels: Parcel[];
  openEvents: ValveEvent[];
  pending: Partial<Record<ParcelId, Pending>>;
  alerts: ClimateAlert[];
  lastSaved: number | null;
  testConnection: () => Promise<{ ok: boolean; message: string }>;
  setValve: (n: ParcelId, open: boolean, origin?: ValveOrigin, reason?: string) => Promise<void>;
  sendConfig: () => Promise<{ ok: boolean; message: string }>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<Esp32ContextValue | null>(null);
const SENSOR_KEYS = ['t1', 'h1', 't2', 'h2', 's1', 's2', 's3', 's4'] as const;

const avg = (xs: (number | null)[]) => {
  const v = xs.filter(isNum);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export function Esp32Provider({ children }: { children: ReactNode }) {
  const { ready, settings, isDemo, greenhouses, crops } = useData();
  const e = settings.esp32;
  const cfgKey = JSON.stringify(e);

  const parcels = useLiveQuery(() => db.parcels.filter((p) => p.isDemo === isDemo).sortBy('n'), [isDemo]) ?? [];
  const openEvents = useLiveQuery(() => db.valveEvents.filter((v) => v.isDemo === isDemo && v.end === null).toArray(), [isDemo]) ?? [];

  const transport: Esp32Transport | null = useMemo(() => {
    if (isDemo) return e.transport === 'simulador' ? new SimulatorTransport(e.controlLogic === 'esp32') : null;
    return e.transport === 'http' && e.host.trim() ? new HttpTransport(e) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, cfgKey]);

  const [snap, setSnap] = useState({
    lastOk: null as number | null,
    lastAttempt: null as number | null,
    lastError: null as string | null,
    latencyMs: null as number | null,
    reading: null as Esp32Reading | null,
    lastSaved: null as number | null,
    pending: {} as Partial<Record<ParcelId, Pending>>,
    noResponse: {} as Partial<Record<ParcelId, { desired: boolean; since: number }>>,
    sensorLastValid: {} as Record<string, number>,
    tick: 0,
  });

  // Estado mutable compartido entre consultas
  const ref = useRef({
    prevValves: null as (boolean | null)[] | null,
    pending: {} as Partial<Record<ParcelId, Pending>>,
    noResponse: {} as Partial<Record<ParcelId, { desired: boolean; since: number }>>,
    sensorLastValid: {} as Record<string, number>,
    lastSaved: null as number | null,
    lastOk: null as number | null,
    busy: false,
  });
  const live = useRef({ parcels, openEvents, settings, isDemo, greenhouses, crops, transport });
  live.current = { parcels, openEvents, settings, isDemo, greenhouses, crops, transport };

  // Reiniciar el estado al cambiar de transporte o de modo de datos
  useEffect(() => {
    ref.current = { prevValves: null, pending: {}, noResponse: {}, sensorLastValid: {}, lastSaved: null, lastOk: null, busy: false };
    setSnap((s) => ({ ...s, lastOk: null, lastError: null, reading: null, pending: {}, noResponse: {}, sensorLastValid: {}, latencyMs: null }));
  }, [transport]);

  const saveRecord = useCallback(async (r: Esp32Reading) => {
    const { settings: st, isDemo: demo, greenhouses: ghs, crops: cs } = live.current;
    const airTemp = avg([r.airTemp1, r.airTemp2]);
    const relHumidity = avg([r.relHumidity1, r.relHumidity2]);
    if (airTemp === null || relHumidity === null) return false; // la temperatura y HR del aire son obligatorias
    const gh = ghs.find((g) => g.id === st.defaultGreenhouseId) ?? ghs[0];
    if (!gh) return false;
    const crop = cs.find((c) => c.active && c.greenhouseId === gh.id);
    const d = new Date(r.ts);
    const date = toISODate(d);
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const soilAvg = avg(r.soil);
    const q = assessRecord({ airTemp, relHumidity, soilMoisture: soilAvg });
    const rec: ClimateRecord = {
      date, time, ts: r.ts, greenhouseId: gh.id!, cropId: crop?.id ?? null,
      airTemp: +airTemp.toFixed(1), relHumidity: Math.round(relHumidity),
      soilMoisture: soilAvg === null ? null : Math.round(soilAvg),
      airTemp1: r.airTemp1, relHumidity1: r.relHumidity1, airTemp2: r.airTemp2, relHumidity2: r.relHumidity2,
      soilMoisture1: r.soil[0], soilMoisture2: r.soil[1], soilMoisture3: r.soil[2], soilMoisture4: r.soil[3],
      valve1: r.valves[0], valve2: r.valves[1], valve3: r.valves[2], valve4: r.valves[3],
      phenologicalStage: stageForDate(crop, date),
      method: 'Sensor / datalogger',
      recordedBy: 'ESP32',
      source: demo ? 'demo' : 'sensor',
      sensorId: 'ESP32',
      validation: q.validation,
      validationNote: q.note,
      isDemo: demo,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.climateRecords.add(rec);
    return true;
  }, []);

  /** Registra aperturas y cierres de electroválvulas a partir de los cambios de estado reportados. */
  const trackValves = useCallback(async (r: Esp32Reading) => {
    const { parcels: ps, openEvents: open, isDemo: demo } = live.current;
    const prev = ref.current.prevValves;
    let changed = false;
    for (let i = 0; i < 4; i++) {
      const n = (i + 1) as ParcelId;
      const now = r.valves[i];
      if (now === null) continue;
      const openEv = open.find((ev) => ev.parcel === n);
      const was = prev ? prev[i] : openEv ? true : false;
      const p = ps.find((x) => x.n === n);
      const pend = ref.current.pending[n];
      if (now && (!was || !openEv) && !openEv) {
        const d = p ? decide(p, r, false, null, r.ts) : null;
        await db.valveEvents.add({
          parcel: n, start: r.ts, end: null, mode: r.modes[i] ?? p?.mode ?? 'manual',
          reason: pend?.desired ? pend.reason : r.reasons[i] ?? (d?.action === 'abrir' ? d.reason : 'Apertura informada por el ESP32.'),
          origin: pend?.desired ? pend.origin : demo ? 'demo' : 'esp32', isDemo: demo,
        });
        changed = true;
      } else if (!now && openEv) {
        const d = p ? decide(p, r, true, openEv.start, r.ts) : null;
        await db.valveEvents.update(openEv.id!, {
          end: r.ts,
          closeReason: pend && !pend.desired ? pend.reason : d?.action === 'cerrar' ? d.reason : 'Cierre informado por el ESP32.',
        });
        changed = true;
      }
      if (prev && prev[i] !== now) changed = true;
      // Confirmación de órdenes
      if (pend && pend.desired === now) {
        delete ref.current.pending[n];
        delete ref.current.noResponse[n];
      }
    }
    ref.current.prevValves = r.valves;
    return changed;
  }, []);

  const poll = useCallback(async () => {
    const t = live.current.transport;
    if (!t || ref.current.busy) return;
    ref.current.busy = true;
    const st = live.current.settings.esp32;
    const started = Date.now();
    try {
      const raw = await t.getReading();
      const r = parseEsp32Payload(raw);
      const now = Date.now();
      ref.current.lastOk = now;
      const vals = [r.airTemp1, r.relHumidity1, r.airTemp2, r.relHumidity2, ...r.soil];
      vals.forEach((v, i) => isNum(v) && (ref.current.sensorLastValid[SENSOR_KEYS[i]] = now));
      const valveChanged = await trackValves(r);
      // Órdenes sin confirmar dentro del tiempo configurado → "no responde"
      for (const [k, p] of Object.entries(ref.current.pending)) {
        if (p && now - p.since > st.commandTimeoutSeconds * 1000) ref.current.noResponse[Number(k) as ParcelId] = { desired: p.desired, since: p.since };
      }
      let saved = false;
      if (valveChanged || !ref.current.lastSaved || now - ref.current.lastSaved >= st.saveEveryMin * 60000) {
        saved = await saveRecord(r);
        if (saved) ref.current.lastSaved = now;
      }
      // Control desde la aplicación (solo si se eligió así): aplica las reglas y envía órdenes
      if (st.controlLogic === 'app') {
        const { parcels: ps, openEvents: open } = live.current;
        for (const p of ps) {
          const i = p.n - 1;
          if (p.mode === 'manual' || ref.current.pending[p.n]) continue;
          const d = decide(p, r, r.valves[i], open.find((ev) => ev.parcel === p.n)?.start ?? null, now);
          if (d.action === 'abrir' || d.action === 'cerrar') {
            ref.current.pending[p.n] = { desired: d.action === 'abrir', since: now, origin: 'app', reason: d.reason };
            t.setValve(p.n, d.action === 'abrir').catch(() => undefined);
          }
        }
      }
      setSnap((s) => ({
        ...s, lastOk: now, lastAttempt: started, lastError: null, latencyMs: now - started, reading: r,
        lastSaved: ref.current.lastSaved, pending: { ...ref.current.pending }, noResponse: { ...ref.current.noResponse },
        sensorLastValid: { ...ref.current.sensorLastValid }, tick: s.tick + 1,
      }));
    } catch (err) {
      const now = Date.now();
      for (const [k, p] of Object.entries(ref.current.pending)) {
        if (p && now - p.since > st.commandTimeoutSeconds * 1000) ref.current.noResponse[Number(k) as ParcelId] = { desired: p.desired, since: p.since };
      }
      setSnap((s) => ({ ...s, lastAttempt: started, lastError: (err as Error).message || 'Error de comunicación', noResponse: { ...ref.current.noResponse }, tick: s.tick + 1 }));
    } finally {
      ref.current.busy = false;
    }
  }, [saveRecord, trackValves]);

  // Bucle de consulta
  useEffect(() => {
    if (!ready || !transport || !e.autoConnect) return;
    poll();
    const id = setInterval(poll, Math.max(2, e.pollSeconds) * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, transport, e.autoConnect, e.pollSeconds, poll]);

  // Envía la configuración de las parcelas al ESP32 cuando cambia
  const parcelsKey = JSON.stringify(parcels.map((p) => [p.n, p.mode, p.humidityMin, p.humidityTarget, p.tempMin, p.tempMax, p.maxDurationMin, p.tempSource]));
  useEffect(() => {
    if (!transport || !parcels.length) return;
    transport.sendConfig(parcels).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport, parcelsKey]);

  const connected = !!snap.lastOk && Date.now() - snap.lastOk <= Math.max(e.offlineSeconds, e.pollSeconds * 2) * 1000;
  const status: ConnStatus = e.transport === 'desactivado' || (!isDemo && e.transport === 'simulador')
    ? 'desactivado'
    : !transport
      ? 'sin-configurar'
      : connected
        ? 'conectado'
        : snap.lastAttempt && !snap.lastOk
          ? 'desconectado'
          : snap.lastOk
            ? 'desconectado'
            : 'conectando';

  const alerts = useMemo(
    () =>
      irrigationAlerts(parcels, {
        enabled: !!transport,
        connected,
        lastOk: snap.lastOk,
        reading: snap.reading,
        sensorLastValid: snap.sensorLastValid,
        noResponse: snap.noResponse,
        staleMinutes: e.sensorStaleMinutes,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parcels, transport, connected, snap.tick, e.sensorStaleMinutes],
  );

  const value: Esp32ContextValue = {
    status,
    connected,
    transportKind: transport?.kind ?? null,
    address: transport?.address ?? '',
    lastOk: snap.lastOk,
    lastAttempt: snap.lastAttempt,
    lastError: snap.lastError,
    latencyMs: snap.latencyMs,
    ip: snap.reading?.ip ?? null,
    firmware: snap.reading?.firmware ?? null,
    reading: snap.reading,
    parcels,
    openEvents,
    pending: snap.pending,
    alerts,
    lastSaved: snap.lastSaved,
    refresh: poll,
    testConnection: async () => {
      const t = live.current.transport;
      if (!t) return { ok: false, message: isDemo ? 'En modo demostración elige «Simulador» como tipo de conexión.' : 'Configura la dirección IP del ESP32 y el tipo de conexión «Wi-Fi (HTTP)».' };
      try {
        const res = await t.ping();
        await poll();
        return { ok: true, message: `ESP32 respondió en ${res.ms} ms (${t.address}).` };
      } catch (err) {
        return { ok: false, message: `Sin conexión con ${t.address}: ${(err as Error).message}` };
      }
    },
    setValve: async (n, open, origin = 'manual', reason) => {
      const t = live.current.transport;
      if (!t) throw new Error('No hay conexión configurada con el ESP32.');
      ref.current.pending[n] = { desired: open, since: Date.now(), origin, reason: reason ?? (open ? 'Apertura manual desde la aplicación.' : 'Cierre manual desde la aplicación.') };
      delete ref.current.noResponse[n];
      setSnap((s) => ({ ...s, pending: { ...ref.current.pending }, noResponse: { ...ref.current.noResponse } }));
      try {
        await t.setValve(n, open);
      } finally {
        await poll();
      }
    },
    sendConfig: async () => {
      const t = live.current.transport;
      if (!t) return { ok: false, message: 'No hay conexión configurada con el ESP32.' };
      try {
        await t.sendConfig(live.current.parcels);
        return { ok: true, message: 'Configuración de las 4 parcelas enviada al ESP32.' };
      } catch (err) {
        return { ok: false, message: `No se pudo enviar la configuración: ${(err as Error).message}` };
      }
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEsp32() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEsp32 debe usarse dentro de Esp32Provider');
  return v;
}

import { Cpu, Droplets, Loader, Power, PowerOff, RefreshCw, Send, SlidersHorizontal, Thermometer, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import { MODE_HELP, MODE_LABELS, type IrrigationMode, type Parcel, type ParcelId, type TempSource } from '../db/types';
import { fmtDateTime } from '../lib/dates';
import { ambientTemp, decide, fmtDuration, missingConfig, TEMP_SOURCE_LABELS } from '../lib/irrigation';
import { parseNumber } from '../lib/validation';
import { fmt, isNum } from '../lib/variables';
import { useEsp32, type ConnStatus } from '../state/Esp32Context';
import { useToast } from '../state/Toast';
import { ConfirmModal, Field, Modal } from './ui';

const STATUS_TEXT: Record<ConnStatus, string> = {
  conectado: 'CONECTADO',
  desconectado: 'DESCONECTADO',
  conectando: 'CONECTANDO…',
  'sin-configurar': 'SIN CONFIGURAR',
  desactivado: 'DESACTIVADO',
};

export function Esp32Badge({ compact }: { compact?: boolean }) {
  const { status } = useEsp32();
  const ok = status === 'conectado';
  return (
    <span className={`esp-badge ${ok ? 'ok' : status === 'conectando' ? 'wait' : status === 'desconectado' ? 'bad' : 'off'}`} title="Estado de conexión del ESP32">
      {ok ? <Wifi size={14} /> : <WifiOff size={14} />} {compact ? 'ESP32' : `ESP32 · ${STATUS_TEXT[status]}`}
    </span>
  );
}

export function Esp32StatusCard({ showActions = true }: { showActions?: boolean }) {
  const esp = useEsp32();
  const toast = useToast();
  const [testing, setTesting] = useState(false);
  const ok = esp.status === 'conectado';
  return (
    <section className="card card-pad esp-card">
      <div className="esp-head">
        <div className={`esp-dot ${ok ? 'ok' : esp.status === 'desconectado' ? 'bad' : 'off'}`}><Cpu size={20} /></div>
        <div>
          <strong className="esp-title">ESP32 {ok ? '🟢 CONECTADO' : esp.status === 'desconectado' ? '🔴 DESCONECTADO' : `· ${STATUS_TEXT[esp.status]}`}</strong>
          <span className="small muted">
            {esp.transportKind === 'simulador' ? 'Simulador de demostración' : esp.transportKind === 'http' ? 'Wi-Fi · HTTP' : 'Sin conexión configurada'}
          </span>
        </div>
      </div>
      <dl className="quality-grid esp-grid">
        <div><dt>Estado de conexión</dt><dd style={{ fontSize: 14 }}>{STATUS_TEXT[esp.status]}</dd></div>
        <div><dt>Última comunicación</dt><dd style={{ fontSize: 14 }}>{esp.lastOk ? fmtDateTime(esp.lastOk) : '—'}</dd></div>
        <div><dt>Dirección IP</dt><dd style={{ fontSize: 14 }}>{esp.ip || esp.address || '—'}</dd></div>
        <div><dt>Respuesta</dt><dd style={{ fontSize: 14 }}>{esp.latencyMs !== null ? `${esp.latencyMs} ms` : '—'}</dd></div>
      </dl>
      {esp.lastError && esp.status !== 'conectado' && <p className="small" style={{ color: 'var(--red)', marginTop: 8 }}>Último error: {esp.lastError}</p>}
      {esp.status === 'sin-configurar' || esp.status === 'desactivado' ? (
        <p className="small muted" style={{ marginTop: 8 }}>Configura la conexión en <Link to="/configuracion">Configuración → Conexión con el ESP32</Link>.</p>
      ) : null}
      {showActions && (
        <div className="quick-actions" style={{ marginTop: 12 }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              const r = await esp.testConnection();
              setTesting(false);
              toast(r.message, r.ok ? 'success' : 'error');
            }}
          >
            {testing ? <Loader size={15} /> : <RefreshCw size={15} />} Probar conexión
          </button>
          <button className="btn btn-secondary btn-sm" disabled={!esp.transportKind} onClick={async () => { const r = await esp.sendConfig(); toast(r.message, r.ok ? 'success' : 'error'); }}>
            <Send size={15} /> Enviar configuración
          </button>
        </div>
      )}
    </section>
  );
}

export function ValveState({ open }: { open: boolean | null | undefined }) {
  if (open === null || open === undefined) return <span className="valve-state unknown">⚪ SIN DATO</span>;
  return <span className={`valve-state ${open ? 'open' : 'closed'}`}>{open ? '🟢 ABIERTA' : '🔴 CERRADA'}</span>;
}

/** Tarjeta de una parcela: lectura, estado, modo y control de la electroválvula. */
export function ParcelCard({ parcel, soil, valve, lastTs, control = true }: { parcel: Parcel; soil: number | null | undefined; valve: boolean | null | undefined; lastTs?: number | null; control?: boolean }) {
  const esp = useEsp32();
  const toast = useToast();
  const [confirm, setConfirm] = useState<boolean | null>(null);
  const [config, setConfig] = useState(false);
  const pending = esp.pending[parcel.n];
  const openEv = esp.openEvents.find((e) => e.parcel === parcel.n);
  const d = esp.reading ? decide(parcel, esp.reading, valve ?? null, openEv?.start ?? null) : null;
  const canControl = control && esp.connected && parcel.mode === 'manual';
  const below = isNum(soil) && isNum(parcel.humidityMin) && soil < parcel.humidityMin;

  const changeMode = async (mode: IrrigationMode) => {
    await db.parcels.update(parcel.key, { mode, updatedAt: Date.now() });
    const miss = missingConfig({ ...parcel, mode });
    toast(miss.length && mode !== 'manual' ? `Modo ${MODE_LABELS[mode]}: falta configurar ${miss.join(', ')}.` : `${parcel.name}: modo ${MODE_LABELS[mode]}.`, miss.length && mode !== 'manual' ? 'info' : 'success');
  };

  return (
    <article className={`card parcel-card ${valve ? 'is-open' : ''}`}>
      <header>
        <h3>{parcel.name.toUpperCase()}</h3>
        <ValveState open={valve} />
      </header>
      <div className="parcel-reading">
        <Droplets size={20} />
        <div>
          <span className="small muted">Humedad del suelo</span>
          <strong className={below ? 'text-red' : ''}>{isNum(soil) ? `${fmt(soil, 0)} %` : '—'}</strong>
        </div>
        <div className="parcel-bar" aria-hidden>
          <span style={{ width: `${isNum(soil) ? Math.max(0, Math.min(100, soil)) : 0}%` }} />
          {isNum(parcel.humidityMin) && <i className="mark min" style={{ left: `${parcel.humidityMin}%` }} />}
          {isNum(parcel.humidityTarget) && <i className="mark target" style={{ left: `${parcel.humidityTarget}%` }} />}
        </div>
      </div>
      <dl className="parcel-meta">
        <div><dt>Electroválvula</dt><dd>EV-{parcel.n}</dd></div>
        <div><dt>Modo de operación</dt><dd>{MODE_LABELS[parcel.mode]}</dd></div>
        <div><dt>Umbrales</dt><dd>{isNum(parcel.humidityMin) || isNum(parcel.tempMax) ? `${isNum(parcel.humidityMin) ? `${fmt(parcel.humidityMin, 0)}–${fmt(parcel.humidityTarget, 0)} %` : ''}${isNum(parcel.tempMax) ? ` · ${isNum(parcel.tempMin) ? `${fmt(parcel.tempMin)}–` : '≤'}${fmt(parcel.tempMax)} °C` : ''}` : 'Sin configurar'}</dd></div>
        <div><dt>Riego en curso</dt><dd>{openEv ? `desde ${fmtDateTime(openEv.start).slice(11)} (${fmtDuration(Date.now() - openEv.start)})` : '—'}</dd></div>
      </dl>
      {lastTs && !esp.connected && <p className="small muted">Último dato registrado: {fmtDateTime(lastTs)}</p>}

      {control && (
        <>
          <div className="mode-picker" role="radiogroup" aria-label={`Modo de ${parcel.name}`}>
            {(Object.keys(MODE_LABELS) as IrrigationMode[]).map((m) => (
              <button key={m} role="radio" aria-checked={parcel.mode === m} className={`chip ${parcel.mode === m ? 'active' : ''}`} onClick={() => parcel.mode !== m && changeMode(m)} title={MODE_HELP[m]}>
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
          {d && (
            <p className={`decision small ${d.blocked ? 'blocked' : ''}`}>
              {d.blocked ? `⚠ ${d.blocked}` : parcel.mode === 'manual' ? 'Control manual activo.' : `Regla: ${d.action === 'mantener' ? d.reason : `${d.action === 'abrir' ? 'abrir' : 'cerrar'} — ${d.reason}`}`}
            </p>
          )}
          {pending && <p className="small" style={{ color: 'var(--amber-text)' }}>Esperando confirmación del ESP32: {pending.desired ? 'ABRIR' : 'CERRAR'}…</p>}
          <div className="parcel-actions">
            <button className="btn btn-primary btn-sm" disabled={!canControl || valve === true || !!pending} onClick={() => setConfirm(true)}><Power size={15} /> ABRIR</button>
            <button className="btn btn-danger-outline btn-sm" disabled={!canControl || valve === false || !!pending} onClick={() => setConfirm(false)}><PowerOff size={15} /> CERRAR</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfig(true)}><SlidersHorizontal size={15} /> Umbrales</button>
          </div>
          {!esp.connected && <p className="small muted">El control se habilita cuando el ESP32 está conectado.</p>}
          {esp.connected && parcel.mode !== 'manual' && <p className="small muted">Para abrir o cerrar a mano, cambia al modo Manual.</p>}
        </>
      )}

      {confirm !== null && (
        <ConfirmModal
          title={confirm ? 'Activar electroválvula' : 'Cerrar electroválvula'}
          confirmLabel={confirm ? 'Sí, activar' : 'Sí, cerrar'}
          danger={!confirm}
          message={confirm ? `¿Desea activar la electroválvula de la ${parcel.name}?` : `¿Desea cerrar la electroválvula de la ${parcel.name}?`}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              await esp.setValve(parcel.n as ParcelId, confirm, 'manual');
              toast(`Orden enviada: ${confirm ? 'abrir' : 'cerrar'} EV-${parcel.n}.`);
            } catch (e) {
              toast((e as Error).message, 'error');
            }
          }}
        />
      )}
      {config && <ParcelConfigModal parcel={parcel} onClose={() => setConfig(false)} />}
    </article>
  );
}

type Form = Record<'humidityMin' | 'humidityTarget' | 'tempMin' | 'tempMax' | 'maxDurationMin', string> & { name: string; mode: IrrigationMode; tempSource: TempSource };

export function ParcelConfigForm({ parcel, onSaved }: { parcel: Parcel; onSaved?: () => void }) {
  const toast = useToast();
  const str = (v: number | null) => (v === null ? '' : String(v));
  const [f, setF] = useState<Form>({
    name: parcel.name, mode: parcel.mode, tempSource: parcel.tempSource,
    humidityMin: str(parcel.humidityMin), humidityTarget: str(parcel.humidityTarget), tempMin: str(parcel.tempMin), tempMax: str(parcel.tempMax), maxDurationMin: str(parcel.maxDurationMin),
  });
  const [err, setErr] = useState('');
  const id = (k: string) => `p${parcel.n}-${k}`;

  const save = async () => {
    const nums = Object.fromEntries((['humidityMin', 'humidityTarget', 'tempMin', 'tempMax', 'maxDurationMin'] as const).map((k) => [k, parseNumber(f[k])])) as Record<string, number | undefined>;
    for (const [k, v] of Object.entries(nums)) if (v !== undefined && Number.isNaN(v)) return setErr(`Revisa el valor de ${k === 'maxDurationMin' ? 'duración máxima' : k}: debe ser numérico.`);
    const h = (v: number | undefined) => v === undefined || (v >= 0 && v <= 100);
    if (!h(nums.humidityMin) || !h(nums.humidityTarget)) return setErr('La humedad del suelo debe estar entre 0 y 100 %.');
    const next: Parcel = {
      ...parcel, name: f.name.trim() || `Parcela ${parcel.n}`, mode: f.mode, tempSource: f.tempSource,
      humidityMin: nums.humidityMin ?? null, humidityTarget: nums.humidityTarget ?? null, tempMin: nums.tempMin ?? null, tempMax: nums.tempMax ?? null,
      maxDurationMin: nums.maxDurationMin ?? null, updatedAt: Date.now(),
    };
    const miss = missingConfig(next);
    if (miss.some((m) => m.includes('debe'))) return setErr(miss.filter((m) => m.includes('debe')).join('; ') + '.');
    setErr('');
    await db.parcels.put(next);
    toast(miss.length && next.mode !== 'manual' ? `Guardado. Para el modo ${MODE_LABELS[next.mode]} falta: ${miss.join(', ')}.` : `${next.name}: configuración guardada.`, miss.length && next.mode !== 'manual' ? 'info' : 'success');
    onSaved?.();
  };

  const need = (k: 'hum' | 'tmax') =>
    (k === 'hum' && (f.mode === 'humedad' || f.mode === 'automatico')) || (k === 'tmax' && f.mode === 'temperatura');

  return (
    <div className="parcel-form">
      <div className="form-grid">
        <Field label="Nombre" htmlFor={id('name')}><input id={id('name')} type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Modo" htmlFor={id('mode')} hint={MODE_HELP[f.mode]}>
          <select id={id('mode')} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as IrrigationMode })}>
            {(Object.keys(MODE_LABELS) as IrrigationMode[]).map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
          </select>
        </Field>
        <Field label="Humedad mínima (%)" htmlFor={id('hmin')} required={need('hum')} hint="Por debajo: abrir"><input id={id('hmin')} type="text" inputMode="decimal" placeholder="Sin definir" value={f.humidityMin} onChange={(e) => setF({ ...f, humidityMin: e.target.value })} /></Field>
        <Field label="Humedad objetivo (%)" htmlFor={id('htgt')} required={need('hum')} hint="Al alcanzarla: cerrar"><input id={id('htgt')} type="text" inputMode="decimal" placeholder="Sin definir" value={f.humidityTarget} onChange={(e) => setF({ ...f, humidityTarget: e.target.value })} /></Field>
        <Field label="Temperatura mínima (°C)" htmlFor={id('tmin')} hint="Solo temperatura: cerrar · Automático: no regar por debajo"><input id={id('tmin')} type="text" inputMode="decimal" placeholder="Sin definir" value={f.tempMin} onChange={(e) => setF({ ...f, tempMin: e.target.value })} /></Field>
        <Field label="Temperatura máxima (°C)" htmlFor={id('tmax')} required={need('tmax')} hint="Por encima: abrir"><input id={id('tmax')} type="text" inputMode="decimal" placeholder="Sin definir" value={f.tempMax} onChange={(e) => setF({ ...f, tempMax: e.target.value })} /></Field>
        <Field label="Duración máxima de riego (min)" htmlFor={id('dur')} hint="Límite de seguridad; vacío = sin límite"><input id={id('dur')} type="text" inputMode="decimal" placeholder="Sin definir" value={f.maxDurationMin} onChange={(e) => setF({ ...f, maxDurationMin: e.target.value })} /></Field>
        <Field label="Temperatura usada" htmlFor={id('tsrc')}>
          <select id={id('tsrc')} value={f.tempSource} onChange={(e) => setF({ ...f, tempSource: e.target.value as TempSource })}>
            {(Object.keys(TEMP_SOURCE_LABELS) as TempSource[]).map((t) => <option key={t} value={t}>{TEMP_SOURCE_LABELS[t]}</option>)}
          </select>
        </Field>
      </div>
      {err && <p className="field-error" style={{ marginTop: 8 }}>{err}</p>}
      <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={save}>Guardar {f.name || `Parcela ${parcel.n}`}</button>
    </div>
  );
}

export function ParcelConfigModal({ parcel, onClose }: { parcel: Parcel; onClose: () => void }) {
  return (
    <Modal title={`Umbrales · ${parcel.name}`} onClose={onClose} wide>
      <p className="small muted" style={{ marginBottom: 12 }}>Valores configurables: no son recomendaciones agronómicas. Déjalos vacíos hasta definirlos.</p>
      <ParcelConfigForm parcel={parcel} onSaved={onClose} />
    </Modal>
  );
}

/** Tarjetas de los 2 puntos ambientales */
export function AmbientCards({ t1, h1, t2, h2, ts }: { t1?: number | null; h1?: number | null; t2?: number | null; h2?: number | null; ts?: number | null }) {
  const esp = useEsp32();
  const avgT = esp.reading ? ambientTemp(esp.reading, 'promedio') : null;
  return (
    <div className="ambient-grid">
      {[[1, t1, h1], [2, t2, h2]].map(([n, t, h]) => (
        <div key={n as number} className="card ambient-card">
          <span className="ambient-title">Punto ambiental {n as number}</span>
          <div className="ambient-values">
            <span><Thermometer size={18} className="text-orange" /> <b>{isNum(t) ? fmt(t as number) : '—'}</b> °C</span>
            <span><Droplets size={18} className="text-blue" /> <b>{isNum(h) ? fmt(h as number, 0) : '—'}</b> %</span>
          </div>
        </div>
      ))}
      <p className="small muted ambient-note">
        {esp.connected ? `Lectura en vivo del ESP32${isNum(avgT) ? ` · promedio ${fmt(avgT)} °C` : ''}.` : ts ? `Sin conexión en vivo. Último dato registrado: ${fmtDateTime(ts)}.` : 'Aún no hay lecturas de los sensores ambientales.'}
      </p>
    </div>
  );
}

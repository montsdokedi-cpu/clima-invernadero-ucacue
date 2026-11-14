import { Cpu, Loader, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DEFAULT_ESP32, saveSettings } from '../db/db';
import type { Esp32Settings } from '../db/types';
import { baseUrl } from '../lib/esp32/transport';
import { parseNumber } from '../lib/validation';
import { useData } from '../state/DataContext';
import { useEsp32 } from '../state/Esp32Context';
import { useToast } from '../state/Toast';
import { Esp32Badge } from './irrigation';
import { Field } from './ui';

/** Clave aleatoria de 20 caracteres (sin letras confusas como O/0 o l/1). */
function generateKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

type NumKey = 'port' | 'pollSeconds' | 'saveEveryMin' | 'offlineSeconds' | 'commandTimeoutSeconds' | 'sensorStaleMinutes';

/** Configuración de la conexión Wi-Fi con el ESP32. No asume IP, protocolo ni hardware definitivos. */
export function Esp32SettingsCard() {
  const { settings, isDemo } = useData();
  const esp = useEsp32();
  const toast = useToast();
  const [f, setF] = useState<Esp32Settings>(settings.esp32);
  const [nums, setNums] = useState<Record<NumKey, string>>({} as Record<NumKey, string>);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    setF(settings.esp32);
    const s = settings.esp32;
    setNums({ port: s.port === null ? '' : String(s.port), pollSeconds: String(s.pollSeconds), saveEveryMin: String(s.saveEveryMin), offlineSeconds: String(s.offlineSeconds), commandTimeoutSeconds: String(s.commandTimeoutSeconds), sensorStaleMinutes: String(s.sensorStaleMinutes) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(settings.esp32)]);

  const save = async () => {
    const parsed: Partial<Esp32Settings> = {};
    for (const [k, v] of Object.entries(nums) as [NumKey, string][]) {
      const n = parseNumber(v);
      if (k === 'port') {
        if (n !== undefined && (Number.isNaN(n) || n < 1 || n > 65535)) return toast('El puerto debe estar entre 1 y 65535 (o vacío).', 'error');
        parsed.port = n ?? null;
        continue;
      }
      if (n === undefined || Number.isNaN(n) || n <= 0) return toast('Los intervalos y tiempos deben ser números mayores que cero.', 'error');
      (parsed as Record<string, number>)[k] = n;
    }
    if (f.transport === 'http' && !f.host.trim()) return toast('Para la conexión Wi-Fi (HTTP) indica la dirección IP del ESP32.', 'error');
    const key = (f.apiKey ?? '').trim();
    if (f.transport === 'http' && key.length < 12) return toast('Por seguridad, la clave secreta del ESP32 debe tener al menos 12 caracteres. Usa «Generar clave».', 'error');
    if (/[^\x21-\x7e]/.test(key)) return toast('La clave solo puede tener letras, números y símbolos, sin espacios ni tildes.', 'error');
    await saveSettings({ esp32: { ...f, ...parsed } });
    toast('Conexión con el ESP32 guardada.');
  };

  const num = (k: NumKey, label: string, hint?: string) => (
    <Field label={label} htmlFor={`esp-${k}`} hint={hint}>
      <input id={`esp-${k}`} type="text" inputMode="numeric" value={nums[k] ?? ''} onChange={(e) => setNums({ ...nums, [k]: e.target.value })} />
    </Field>
  );

  return (
    <section className="card card-pad">
      <h3 className="card-title"><Cpu size={17} className="text-green" /> Conexión con el ESP32 (Wi-Fi) <span style={{ marginLeft: 'auto' }}><Esp32Badge /></span></h3>
      <p className="small muted" style={{ marginBottom: 12 }}>
        El ESP32 recibe los datos de los 2 puntos ambientales y de los 4 sensores de suelo, y controla las 4 electroválvulas. La dirección IP, el protocolo y el hardware se definen cuando el montaje físico esté listo.
      </p>
      <div className="form-grid">
        <Field label="Tipo de conexión" htmlFor="esp-transport">
          <select id="esp-transport" value={f.transport} onChange={(e) => setF({ ...f, transport: e.target.value as Esp32Settings['transport'] })}>
            <option value="desactivado">Desactivada</option>
            <option value="http">Wi-Fi · HTTP (JSON)</option>
            <option value="simulador" disabled={!isDemo}>Simulador (solo modo demostración)</option>
          </select>
        </Field>
        <Field label="Dirección IP del ESP32" htmlFor="esp-host" hint="Ej.: 192.168.1.50 (pendiente de definir)">
          <input id="esp-host" type="text" inputMode="url" value={f.host} placeholder="Sin definir" onChange={(e) => setF({ ...f, host: e.target.value })} />
        </Field>
        <div className="span-all">
        <Field label="Clave secreta del ESP32" htmlFor="esp-key" hint="Debe ser igual a la clave programada en el ESP32. Sin ella, el ESP32 no obedece.">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>
            <input id="esp-key" type={showKey ? 'text' : 'password'} autoComplete="off" value={f.apiKey ?? ''} placeholder="Mínimo 12 caracteres" onChange={(e) => setF({ ...f, apiKey: e.target.value })} style={{ flex: '1 1 200px', minWidth: 0 }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowKey(!showKey)}>{showKey ? 'Ocultar' : 'Ver'}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setF({ ...f, apiKey: generateKey() }); setShowKey(true); }}>Generar clave</button>
          </div>
        </Field>
        </div>
        {num('port', 'Puerto', 'Vacío = 80')}
        {num('pollSeconds', 'Consultar cada (s)')}
        {num('saveEveryMin', 'Guardar en histórico cada (min)', 'También se guarda en cada cambio de válvula')}
        {num('offlineSeconds', 'Desconectado tras (s) sin respuesta')}
        {num('commandTimeoutSeconds', 'Espera de confirmación de válvula (s)')}
        {num('sensorStaleMinutes', 'Alerta si un sensor no envía datos en (min)')}
        <Field label="Ejecución de los modos automáticos" htmlFor="esp-logic" hint={f.controlLogic === 'esp32' ? 'Recomendado: sigue funcionando aunque el celular esté apagado' : 'Solo funciona mientras la aplicación está abierta'}>
          <select id="esp-logic" value={f.controlLogic} onChange={(e) => setF({ ...f, controlLogic: e.target.value as Esp32Settings['controlLogic'] })}>
            <option value="esp32">En el ESP32 (la app envía la configuración)</option>
            <option value="app">En la aplicación (la app envía órdenes)</option>
          </select>
        </Field>
        <label className="check span-all">
          <input id="esp-auto" type="checkbox" checked={f.autoConnect} onChange={(e) => setF({ ...f, autoConnect: e.target.checked })} /> Conectar automáticamente al abrir la aplicación
        </label>
      </div>
      <details style={{ marginTop: 10 }}>
        <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>Rutas del protocolo (avanzado)</summary>
        <div className="form-grid" style={{ marginTop: 10 }}>
          {(['dataPath', 'commandPath', 'configPath', 'statusPath'] as const).map((k) => (
            <Field key={k} label={{ dataPath: 'Lecturas (GET)', commandPath: 'Orden de válvula (POST)', configPath: 'Configuración de parcelas (POST)', statusPath: 'Estado / prueba (GET)' }[k]} htmlFor={`esp-${k}`}>
              <input id={`esp-${k}`} type="text" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setF({ ...f, dataPath: DEFAULT_ESP32.dataPath, commandPath: DEFAULT_ESP32.commandPath, configPath: DEFAULT_ESP32.configPath, statusPath: DEFAULT_ESP32.statusPath })}>Restablecer rutas</button>
      </details>
      {f.transport === 'http' && f.host && <p className="small muted" style={{ marginTop: 8 }}>Lecturas: <code>{baseUrl({ ...f, port: parseNumber(nums.port) ?? null })}{f.dataPath}</code></p>}
      <div className="quick-actions" style={{ marginTop: 12 }}>
        <button className="btn btn-primary btn-sm" onClick={save}>Guardar conexión</button>
        <button
          className="btn btn-secondary btn-sm"
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
        <Link to="/riego" className="btn btn-ghost btn-sm">Umbrales y modos de las parcelas →</Link>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>«Probar conexión» usa la configuración guardada. Protocolo y formato de datos: <code>docs/esp32-protocolo.md</code>.</p>
    </section>
  );
}

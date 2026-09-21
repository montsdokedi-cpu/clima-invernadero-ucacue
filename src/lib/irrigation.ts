import { MODE_LABELS, type Parcel, type ParcelId, type TempSource } from '../db/types';
import type { ClimateAlert } from './alerts';
import { fmtDateTime } from './dates';
import { fmt, isNum } from './variables';

// Reglas de los 4 modos de operación de cada electroválvula.
// Los umbrales los define el usuario; si faltan, la regla no actúa (nunca se usan valores por defecto).
// Estas mismas reglas debe implementarlas el ESP32 (ver docs/esp32-protocolo.md).

export interface AmbientReading {
  airTemp1: number | null;
  relHumidity1: number | null;
  airTemp2: number | null;
  relHumidity2: number | null;
  soil: (number | null)[]; // índice 0..3 → parcelas 1..4
  valves: (boolean | null)[];
}

export function ambientTemp(r: AmbientReading, source: TempSource): number | null {
  if (source === 'punto1') return r.airTemp1;
  if (source === 'punto2') return r.airTemp2;
  const v = [r.airTemp1, r.airTemp2].filter(isNum);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export const TEMP_SOURCE_LABELS: Record<TempSource, string> = {
  promedio: 'Promedio de los 2 puntos',
  punto1: 'Punto ambiental 1',
  punto2: 'Punto ambiental 2',
};

/** Qué umbrales faltan para que el modo pueda funcionar. */
export function missingConfig(p: Parcel): string[] {
  const miss: string[] = [];
  if (p.mode === 'humedad' || p.mode === 'automatico') {
    if (!isNum(p.humidityMin)) miss.push('humedad mínima');
    if (!isNum(p.humidityTarget)) miss.push('humedad objetivo');
    if (isNum(p.humidityMin) && isNum(p.humidityTarget) && p.humidityMin >= p.humidityTarget) miss.push('la humedad mínima debe ser menor que la objetivo');
  }
  if (p.mode === 'temperatura' && !isNum(p.tempMax)) miss.push('temperatura máxima');
  if (isNum(p.tempMin) && isNum(p.tempMax) && p.tempMin >= p.tempMax) miss.push('la temperatura mínima debe ser menor que la máxima');
  return miss;
}

export type ValveAction = 'abrir' | 'cerrar' | 'mantener';

export interface Decision {
  action: ValveAction;
  /** Motivo legible (se guarda en el historial de activaciones) */
  reason: string;
  /** Por qué la regla no puede actuar (configuración incompleta, falta de datos) */
  blocked?: string;
}

/**
 * Decide la acción de una electroválvula según el modo y los umbrales de la parcela.
 * - Solo humedad: abre si suelo < mínima; cierra al llegar a la objetivo.
 * - Solo temperatura: abre si T > máxima; cierra si T ≤ mínima (o ≤ máxima si no hay mínima).
 * - Automático: abre si suelo < mínima (salvo T < mínima configurada) o si T > máxima y suelo < objetivo;
 *   cierra al llegar a la humedad objetivo.
 * - En todos los modos automáticos, cierra al superar la duración máxima configurada.
 */
export function decide(p: Parcel, r: AmbientReading, isOpen: boolean | null, openSince: number | null, now = Date.now()): Decision {
  if (p.mode === 'manual') return { action: 'mantener', reason: 'Modo manual: la electroválvula solo cambia por orden del usuario.' };
  const miss = missingConfig(p);
  if (miss.length) return { action: 'mantener', reason: '', blocked: `Falta configurar: ${miss.join(', ')}.` };
  if (isOpen === null) return { action: 'mantener', reason: '', blocked: 'Sin estado de la electroválvula.' };

  const soil = r.soil[p.n - 1];
  const temp = ambientTemp(r, p.tempSource);

  if (isOpen && isNum(p.maxDurationMin) && openSince && now - openSince >= p.maxDurationMin * 60000)
    return { action: 'cerrar', reason: `Se alcanzó la duración máxima configurada (${fmt(p.maxDurationMin, 0)} min).` };

  if (p.mode === 'humedad') {
    if (!isNum(soil)) return { action: 'mantener', reason: '', blocked: 'Sin dato del sensor de humedad del suelo.' };
    if (!isOpen && soil < p.humidityMin!) return { action: 'abrir', reason: `Humedad del suelo ${fmt(soil, 0)} % menor que la mínima (${fmt(p.humidityMin, 0)} %).` };
    if (isOpen && soil >= p.humidityTarget!) return { action: 'cerrar', reason: `Humedad del suelo alcanzó la objetivo (${fmt(soil, 0)} % ≥ ${fmt(p.humidityTarget, 0)} %).` };
    return { action: 'mantener', reason: isOpen ? `Regando hasta ${fmt(p.humidityTarget, 0)} % (actual ${fmt(soil, 0)} %).` : `Humedad del suelo ${fmt(soil, 0)} % dentro del rango.` };
  }

  if (p.mode === 'temperatura') {
    if (!isNum(temp)) return { action: 'mantener', reason: '', blocked: 'Sin dato de temperatura ambiental.' };
    const closeAt = isNum(p.tempMin) ? p.tempMin : p.tempMax!;
    if (!isOpen && temp > p.tempMax!) return { action: 'abrir', reason: `Temperatura ambiental ${fmt(temp)} °C mayor que la máxima (${fmt(p.tempMax)} °C).` };
    if (isOpen && temp <= closeAt) return { action: 'cerrar', reason: `Temperatura ambiental bajó a ${fmt(temp)} °C (≤ ${fmt(closeAt)} °C).` };
    return { action: 'mantener', reason: `Temperatura ambiental ${fmt(temp)} °C.` };
  }

  // Automático: humedad del suelo + temperatura ambiental
  if (!isNum(soil)) return { action: 'mantener', reason: '', blocked: 'Sin dato del sensor de humedad del suelo.' };
  if (isOpen) {
    if (soil >= p.humidityTarget!) return { action: 'cerrar', reason: `Humedad del suelo alcanzó la objetivo (${fmt(soil, 0)} % ≥ ${fmt(p.humidityTarget, 0)} %).` };
    return { action: 'mantener', reason: `Regando hasta ${fmt(p.humidityTarget, 0)} % (actual ${fmt(soil, 0)} %).` };
  }
  if (soil < p.humidityMin!) {
    if (isNum(temp) && isNum(p.tempMin) && temp < p.tempMin)
      return { action: 'mantener', reason: '', blocked: `Suelo seco (${fmt(soil, 0)} %) pero la temperatura (${fmt(temp)} °C) está bajo la mínima configurada (${fmt(p.tempMin)} °C): no se riega.` };
    return { action: 'abrir', reason: `Humedad del suelo ${fmt(soil, 0)} % menor que la mínima (${fmt(p.humidityMin, 0)} %)${isNum(temp) ? ` con ${fmt(temp)} °C` : ''}.` };
  }
  if (isNum(temp) && isNum(p.tempMax) && temp > p.tempMax && soil < p.humidityTarget!)
    return { action: 'abrir', reason: `Temperatura ${fmt(temp)} °C sobre la máxima (${fmt(p.tempMax)} °C) y suelo bajo la objetivo (${fmt(soil, 0)} %).` };
  return { action: 'mantener', reason: `Suelo ${fmt(soil, 0)} %${isNum(temp) ? ` · ${fmt(temp)} °C` : ''}: sin necesidad de riego.` };
}

export function modeLabel(p: Parcel) {
  return MODE_LABELS[p.mode];
}

// ---------------------------------------------------------------------------
// Alertas del sistema de riego (se muestran con el mismo componente de alertas)
// ---------------------------------------------------------------------------

export interface LiveStatusForAlerts {
  enabled: boolean;
  connected: boolean;
  lastOk: number | null;
  reading: AmbientReading | null;
  /** Última lectura válida de cada sensor: t1, h1, t2, h2, s1..s4 */
  sensorLastValid: Record<string, number>;
  /** Parcelas cuya electroválvula no confirmó la última orden */
  noResponse: Partial<Record<ParcelId, { desired: boolean; since: number }>>;
  staleMinutes: number;
}

export const SENSOR_NAMES: Record<string, string> = {
  t1: 'Temperatura ambiental 1',
  h1: 'Humedad ambiental 1',
  t2: 'Temperatura ambiental 2',
  h2: 'Humedad ambiental 2',
  s1: 'Humedad del suelo · Parcela 1',
  s2: 'Humedad del suelo · Parcela 2',
  s3: 'Humedad del suelo · Parcela 3',
  s4: 'Humedad del suelo · Parcela 4',
};

export function irrigationAlerts(parcels: Parcel[], st: LiveStatusForAlerts, now = Date.now()): ClimateAlert[] {
  const out: ClimateAlert[] = [];
  const base = { date: new Date(now).toISOString().slice(0, 10), ts: now };
  if (!st.enabled) return out;

  if (!st.connected)
    out.push({
      ...base, id: 'esp32-offline', kind: 'esp32-offline', level: 'danger',
      title: 'El ESP32 perdió la conexión.',
      detail: st.lastOk ? `Última comunicación: ${fmtDateTime(st.lastOk)}. Las lecturas y el control no están disponibles.` : 'No se ha logrado comunicación con el ESP32. Revisa la red Wi-Fi y la dirección configurada.',
    });

  for (const [n, info] of Object.entries(st.noResponse)) {
    if (!info) continue;
    out.push({
      ...base, id: `valve-nr-${n}`, kind: 'valve-no-response', level: 'danger',
      title: `La electroválvula ${n} no responde.`,
      detail: `Se ordenó ${info.desired ? 'ABRIR' : 'CERRAR'} a las ${fmtDateTime(info.since).slice(11)} y el ESP32 no reporta el cambio. Verifica la válvula, el relé y la alimentación.`,
    });
  }

  if (st.connected || st.lastOk) {
    for (const [key, name] of Object.entries(SENSOR_NAMES)) {
      const last = st.sensorLastValid[key];
      if (!last || now - last > st.staleMinutes * 60000)
        out.push({
          ...base, id: `stale-${key}`, kind: 'sensor-stale', level: 'warning',
          title: `El sensor «${name}» dejó de enviar datos.`,
          detail: last ? `Último dato válido: ${fmtDateTime(last)} (límite ${st.staleMinutes} min).` : 'No se ha recibido ningún dato válido de este sensor.',
        });
    }
  }

  const r = st.reading;
  if (r) {
    for (const p of parcels) {
      const soil = r.soil[p.n - 1];
      if (isNum(soil) && isNum(p.humidityMin) && soil < p.humidityMin)
        out.push({
          ...base, id: `soil-low-${p.n}`, kind: 'soil-low', level: 'warning',
          title: `Humedad del suelo bajo el umbral en la ${p.name}.`,
          detail: `${fmt(soil, 0)} % (mínima configurada ${fmt(p.humidityMin, 0)} %). Modo: ${MODE_LABELS[p.mode]}.`,
        });
      const t = ambientTemp(r, p.tempSource);
      if (isNum(t) && isNum(p.tempMax) && t > p.tempMax)
        out.push({
          ...base, id: `temp-thr-${p.n}`, kind: 'temp-threshold', level: 'warning',
          title: `Temperatura sobre el umbral configurado para la ${p.name}.`,
          detail: `${fmt(t)} °C (máxima configurada ${fmt(p.tempMax)} °C, ${p.tempSource === 'promedio' ? 'promedio de los 2 puntos' : p.tempSource === 'punto1' ? 'punto 1' : 'punto 2'}).`,
        });
    }
  }
  return out;
}

export function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

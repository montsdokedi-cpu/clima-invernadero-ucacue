import type { Esp32Settings, Parcel, ParcelId } from '../../db/types';
import { decide } from '../irrigation';
import { configPayload, valveCommand } from './protocol';

// Capa de transporte intercambiable. Hoy: HTTP/JSON por Wi-Fi y un simulador para demostración.
// Para otro protocolo (WebSocket, MQTT, Bluetooth) basta con implementar esta interfaz.

export interface Esp32Transport {
  readonly kind: 'http' | 'simulador';
  readonly address: string;
  getReading(): Promise<unknown>;
  setValve(n: ParcelId, open: boolean): Promise<unknown>;
  sendConfig(parcels: Parcel[]): Promise<unknown>;
  ping(): Promise<{ ok: boolean; ms: number; info?: unknown }>;
}

export function baseUrl(s: Esp32Settings): string {
  const host = s.host.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!host) return '';
  return `http://${host}${s.port ? `:${s.port}` : ''}`;
}

const path = (p: string) => (p.startsWith('/') ? p : `/${p}`);

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' });
    if (res.status === 401 || res.status === 403) throw new Error('El ESP32 rechazó la clave secreta. Revisa que sea la misma en la app y en el ESP32.');
    if (!res.ok) throw new Error(`El ESP32 respondió con el código ${res.status}.`);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`Sin respuesta en ${Math.round(timeoutMs / 1000)} s.`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export class HttpTransport implements Esp32Transport {
  readonly kind = 'http' as const;
  constructor(private s: Esp32Settings) {}
  get address() {
    return baseUrl(this.s);
  }
  private timeout() {
    return Math.max(2, Math.min(this.s.offlineSeconds, 10)) * 1000;
  }
  private url(p: string) {
    if (!this.address) throw new Error('Configura la dirección IP del ESP32 en Configuración.');
    return `${this.address}${path(p)}`;
  }
  /** Cabeceras comunes: la clave secreta permite que el ESP32 rechace órdenes de otros equipos de la red. */
  private headers(json = false): Record<string, string> {
    const h: Record<string, string> = {};
    if (json) h['Content-Type'] = 'application/json';
    const key = (this.s.apiKey ?? '').trim();
    if (key) h['X-Clave'] = key;
    return h;
  }
  getReading() {
    return request(this.url(this.s.dataPath), { method: 'GET', headers: this.headers() }, this.timeout());
  }
  setValve(n: ParcelId, open: boolean) {
    return request(this.url(this.s.commandPath), { method: 'POST', headers: this.headers(true), body: JSON.stringify(valveCommand(n, open)) }, this.timeout());
  }
  sendConfig(parcels: Parcel[]) {
    return request(this.url(this.s.configPath), { method: 'POST', headers: this.headers(true), body: JSON.stringify(configPayload(parcels)) }, this.timeout());
  }
  async ping() {
    const t0 = performance.now();
    let info: unknown;
    try {
      info = await request(this.url(this.s.statusPath), { method: 'GET', headers: this.headers() }, this.timeout());
    } catch {
      info = await request(this.url(this.s.dataPath), { method: 'GET', headers: this.headers() }, this.timeout());
    }
    return { ok: true, ms: Math.round(performance.now() - t0), info };
  }
}

/**
 * Simulador de ESP32 (solo en modo demostración): genera lecturas plausibles de 2 puntos
 * ambientales y 4 parcelas, obedece órdenes y ejecuta las reglas configuradas, como lo haría el firmware.
 */
export class SimulatorTransport implements Esp32Transport {
  readonly kind = 'simulador' as const;
  readonly address = 'simulador (demostración)';
  private soil = [34, 41, 38, 45];
  private valves = [false, false, false, false];
  private openSince: (number | null)[] = [null, null, null, null];
  private reasons: (string | null)[] = [null, null, null, null];
  private parcels: Parcel[] = [];
  private last = Date.now();
  constructor(private runRules: boolean) {}

  private tick() {
    const now = Date.now();
    const dtMin = Math.min(10, (now - this.last) / 60000);
    this.last = now;
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    const phase = h >= 6 && h <= 20 ? Math.sin(((h - 6) / 14) * Math.PI) : 0;
    const t = 16 + 12 * phase;
    this.soil = this.soil.map((s, i) => {
      const drying = (0.04 + 0.12 * phase) * dtMin * (1 + i * 0.15);
      const wetting = this.valves[i] ? 1.6 * dtMin : 0;
      return Math.max(8, Math.min(95, s - drying + wetting));
    });
    const reading = {
      airTemp1: t + (Math.random() - 0.5) * 0.6,
      relHumidity1: Math.max(35, Math.min(98, 95 - (t - 16) * 3.2 + (Math.random() - 0.5) * 3)),
      airTemp2: t + 0.8 + (Math.random() - 0.5) * 0.6,
      relHumidity2: Math.max(35, Math.min(98, 92 - (t - 16) * 3.1 + (Math.random() - 0.5) * 3)),
      soil: this.soil,
      valves: this.valves,
    };
    if (this.runRules) {
      for (const p of this.parcels) {
        const i = p.n - 1;
        const d = decide(p, reading, this.valves[i], this.openSince[i], now);
        if (d.action === 'abrir') this.set(i, true, d.reason);
        if (d.action === 'cerrar') this.set(i, false, d.reason);
      }
    }
    return reading;
  }

  private set(i: number, open: boolean, reason: string | null) {
    if (this.valves[i] === open) return;
    this.valves[i] = open;
    this.openSince[i] = open ? Date.now() : null;
    this.reasons[i] = open ? reason : null;
  }

  async getReading() {
    const r = this.tick();
    await new Promise((res) => setTimeout(res, 120));
    const out: Record<string, unknown> = {
      temperatura_ambiente_1: +r.airTemp1.toFixed(1),
      humedad_ambiente_1: Math.round(r.relHumidity1),
      temperatura_ambiente_2: +r.airTemp2.toFixed(1),
      humedad_ambiente_2: Math.round(r.relHumidity2),
      ip: '192.168.4.1 (simulado)',
      firmware: 'simulador-demo',
    };
    r.soil.forEach((s, i) => (out[`humedad_suelo_${i + 1}`] = Math.round(s)));
    this.valves.forEach((v, i) => (out[`valvula_${i + 1}`] = v ? 1 : 0));
    this.reasons.forEach((m, i) => m && (out[`motivo_${i + 1}`] = m));
    this.parcels.forEach((p) => (out[`modo_${p.n}`] = p.mode));
    return out;
  }
  async setValve(n: ParcelId, open: boolean) {
    await new Promise((res) => setTimeout(res, 200));
    this.set(n - 1, open, open ? 'Orden manual desde la aplicación.' : null);
    return { ok: true, valvula: n, abierta: open };
  }
  async sendConfig(parcels: Parcel[]) {
    this.parcels = parcels;
    return { ok: true };
  }
  async ping() {
    await new Promise((res) => setTimeout(res, 80));
    return { ok: true, ms: 80, info: { modelo: 'Simulador de demostración' } };
  }
}

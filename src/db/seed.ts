import { addDays, todayISO, toTimestamp } from '../lib/dates';
import { decide } from '../lib/irrigation';
import { flagSensorJumps } from '../lib/validation';
import { db, defaultParcels, tomatoThresholds } from './db';
import type { ClimateRecord, Parcel, ParcelId, StageChange, ValveEvent } from './types';

// DATOS DE DEMOSTRACIÓN — simulados, NO provienen del invernadero real.
// Imitan un datalogger (lecturas cada 30 min, 24 h) para mostrar el análisis
// de sensores. Se guardan con isDemo = true y source = 'demo'.

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WEATHER = ['Soleado', 'Parcialmente nublado', 'Nublado', 'Llovizna', 'Lluvia', 'Neblina'];

export async function hasDemoData() {
  return (await db.climateRecords.filter((r) => r.isDemo).count()) > 0;
}

export async function removeDemoData() {
  await db.transaction('rw', [db.climateRecords, db.crops, db.greenhouses, db.climateThresholds, db.reports, db.users, db.parcels, db.valveEvents], async () => {
    await db.climateRecords.filter((r) => r.isDemo).delete();
    await db.parcels.filter((r) => r.isDemo).delete();
    await db.valveEvents.filter((r) => r.isDemo).delete();
    await db.crops.filter((r) => r.isDemo).delete();
    await db.greenhouses.filter((r) => r.isDemo).delete();
    await db.climateThresholds.filter((r) => r.isDemo).delete();
    await db.reports.filter((r) => r.isDemo).delete();
    await db.users.filter((r) => r.isDemo).delete();
  });
}

export async function seedDemoData(days = 45) {
  await removeDemoData();
  const rand = mulberry32(20260914);
  const now = Date.now();
  const noise = (amp: number) => (rand() - 0.5) * 2 * amp;
  const start = addDays(todayISO(), -(days - 1));
  const stageHistory: StageChange[] = [
    { stage: 'Crecimiento vegetativo', from: start },
    { stage: 'Floración', from: addDays(start, 14) },
    { stage: 'Fructificación', from: addDays(start, 30) },
  ];
  const stageOn = (date: string) => stageHistory.filter((s) => s.from <= date).at(-1)!.stage;

  await db.transaction('rw', [db.climateRecords, db.crops, db.greenhouses, db.climateThresholds, db.users, db.parcels, db.valveEvents], async () => {
    const ghId = (await db.greenhouses.add({
      code: 'DEMO-01',
      name: 'Invernadero de demostración',
      location: 'Datos simulados (referencia: clima amazónico de Ecuador)',
      areaM2: 200,
      coverType: 'Polietileno',
      notes: 'Datos de demostración. No corresponden a mediciones reales.',
      isDemo: true,
      createdAt: now,
    })) as number;

    const tomatoId = (await db.crops.add({
      name: 'Tomate',
      variety: 'Pietro (demo)',
      sowingDate: addDays(start, -40),
      transplantDate: addDays(start, -8),
      stage: stageHistory.at(-1)!.stage,
      stageHistory,
      greenhouseId: ghId,
      active: true,
      notes: 'Cultivo de demostración.',
      isDemo: true,
      createdAt: now,
    })) as number;

    await db.climateThresholds.bulkAdd(tomatoThresholds(true));
    await db.users.bulkAdd([
      { name: 'Estudiante Demo A', role: 'estudiante', isDemo: true, createdAt: now },
      { name: 'Docente Demo', role: 'docente', isDemo: true, createdAt: now },
    ]);

    const records: ClimateRecord[] = [];
    let persistence = 0;
    let weather = 'Parcialmente nublado';
    let soil = 19;
    let soilM = 62;

    // Sistema de 4 parcelas (demostración): umbrales de EJEMPLO, no recomendaciones agronómicas
    const demoParcels: Parcel[] = defaultParcels(true).map((p) =>
      p.n === 1 ? { ...p, mode: 'automatico', humidityMin: 30, humidityTarget: 45, tempMin: 12, tempMax: 30, maxDurationMin: 40, notes: 'Umbrales de ejemplo (demo)' }
        : p.n === 2 ? { ...p, mode: 'humedad', humidityMin: 35, humidityTarget: 50, maxDurationMin: 40, notes: 'Umbrales de ejemplo (demo)' }
          : p.n === 3 ? { ...p, mode: 'temperatura', tempMin: 26, tempMax: 29, maxDurationMin: 30, notes: 'Umbrales de ejemplo (demo)' }
            : { ...p, mode: 'manual', notes: 'Riego manual de ejemplo (demo)' },
    );
    await db.parcels.bulkAdd(demoParcels);
    const soilP = [38, 44, 40, 47];
    const valveP = [false, false, false, false];
    const openSince: (number | null)[] = [null, null, null, null];
    const events: ValveEvent[] = [];
    const openEvent = (i: number, ts: number, reason: string) => {
      valveP[i] = true;
      openSince[i] = ts;
      events.push({ parcel: (i + 1) as ParcelId, start: ts, end: null, mode: demoParcels[i].mode, reason, origin: i === 3 ? 'manual' : 'demo', isDemo: true });
    };
    const closeEvent = (i: number, ts: number, reason: string) => {
      valveP[i] = false;
      openSince[i] = null;
      const ev = [...events].reverse().find((e) => e.parcel === i + 1 && e.end === null);
      if (ev) {
        ev.end = ts;
        ev.closeReason = reason;
      }
    };

    for (let d = 0; d < days; d++) {
      const date = addDays(start, d);
      // Algunos días el datalogger no registró (batería / descarga pendiente)
      const outage = rand() < 0.05;
      const outageFrom = Math.floor(rand() * 40);
      if (persistence-- <= 0) {
        weather = WEATHER[Math.floor(rand() * WEATHER.length)];
        persistence = 1 + Math.floor(rand() * 3);
      }
      const sunny = weather === 'Soleado' ? 1 : weather === 'Parcialmente nublado' ? 0.72 : weather === 'Nublado' || weather === 'Neblina' ? 0.4 : 0.25;
      const rainy = weather.startsWith('Lluvia') || weather === 'Llovizna';
      const tNight = 15.2 + noise(1.4) + Math.sin((d / days) * Math.PI) * 1.1;
      const tBoost = 7.5 + sunny * 10.5 + noise(1.5);

      for (let slot = 0; slot < 48; slot++) {
        if (outage && slot >= outageFrom && slot < outageFrom + 14) continue;
        const h = slot / 2;
        const time = `${String(Math.floor(h)).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`;
        const ts = toTimestamp(date, time);
        if (ts > now) continue;
        // Curva diaria: mínimo ~06:00, máximo ~13:30
        const phase = h >= 6 && h <= 20 ? Math.sin(((h - 6) / 15) * Math.PI) ** 1.25 : 0;
        const nightCool = h > 20 ? (h - 20) * 0.35 : h < 6 ? (6 - h) * -0.05 + 1.2 : 0;
        let airTemp = tNight + tBoost * phase - nightCool * 0.6 + noise(0.45);
        if (rand() < 0.006 && h >= 10 && h <= 16) airTemp -= 5.5 + rand() * 2; // nube/lluvia repentina
        // HR nocturna alta (típica de la Amazonía) sin saturar; lecturas de 100 % solo ocasionales (sensor mojado)
        const relHumidity = rand() < 0.002 ? 100 : Math.min(98, Math.max(40, 96 - (airTemp - tNight) * 3.2 + (1 - sunny) * 4 + (rainy ? 3 : 0) + noise(2.2)));
        soil += (airTemp - soil) * 0.035 + noise(0.05);
        soilM = Math.min(88, Math.max(40, soilM - phase * 0.18 + (slot === 16 ? 9 : 0) + (rainy ? 0.05 : 0) + noise(0.3)));
        const solarRadiation = Math.round(Math.max(0, phase * (160 + sunny * 640) + noise(20)));
        const outsideTemp = tNight - 1.8 + (tBoost - 4.5) * phase + noise(0.6);
        // Dos puntos ambientales con el mismo promedio que la temperatura/HR general
        const dT = 0.4 + phase * 0.6 + noise(0.2);
        const t1 = +(airTemp - dT).toFixed(1);
        const t2 = +(airTemp + dT).toFixed(1);
        const h1 = Math.min(100, Math.round(relHumidity + 1.5 + noise(1)));
        const h2 = Math.max(0, Math.round(relHumidity - 1.5 + noise(1)));
        // Suelo por parcela: se seca con el calor del día y se humedece al regar
        for (let i = 0; i < 4; i++) soilP[i] = Math.max(12, Math.min(90, soilP[i] - (0.12 + 0.55 * phase) * (1 + i * 0.12) + (valveP[i] ? 4.2 : 0) + noise(0.25)));
        const reading = { airTemp1: t1, relHumidity1: h1, airTemp2: t2, relHumidity2: h2, soil: soilP.map((s) => Math.round(s)), valves: [...valveP] };
        for (let i = 0; i < 3; i++) {
          const dec = decide(demoParcels[i], reading, valveP[i], openSince[i], ts);
          if (dec.action === 'abrir') openEvent(i, ts, dec.reason);
          if (dec.action === 'cerrar') closeEvent(i, ts, dec.reason);
        }
        // Parcela 4 (manual): riego de 30 min a las 07:00 cada 3 días
        if (d % 3 === 0 && time === '07:00') openEvent(3, ts, 'Apertura manual desde la aplicación (demo).');
        if (valveP[3] && openSince[3] && ts - openSince[3] >= 30 * 60000) closeEvent(3, ts, 'Cierre manual desde la aplicación (demo).');
        records.push({
          date, time, ts, greenhouseId: ghId, cropId: tomatoId,
          airTemp: +((t1 + t2) / 2).toFixed(1),
          relHumidity: Math.round((h1 + h2) / 2),
          airTemp1: t1, relHumidity1: h1, airTemp2: t2, relHumidity2: h2,
          soilMoisture1: Math.round(soilP[0]), soilMoisture2: Math.round(soilP[1]), soilMoisture3: Math.round(soilP[2]), soilMoisture4: Math.round(soilP[3]),
          valve1: valveP[0], valve2: valveP[1], valve3: valveP[2], valve4: valveP[3],
          soilTemp: +soil.toFixed(1),
          soilMoisture: Math.round(soilM),
          luminosity: Math.round(solarRadiation * 110),
          solarRadiation,
          windSpeed: +Math.max(0, 0.2 + phase * 0.7 + noise(0.2)).toFixed(1),
          precipitation: null,
          outsideTemp: slot % 2 === 0 ? +outsideTemp.toFixed(1) : null,
          outsideHumidity: slot % 2 === 0 ? Math.round(Math.min(100, relHumidity + 4 + noise(3))) : null,
          phenologicalStage: stageOn(date),
          recordedBy: 'Datalogger demo',
          method: 'Sensor / datalogger',
          outsideWeather: weather,
          observations: slot === 18 && rand() < 0.25 ? `${weather}. Dato de demostración.` : '',
          cropObservations: slot === 24 && rand() < 0.1 ? 'Revisión visual sin síntomas anotados (demo).' : '',
          source: 'demo',
          sensorId: 'DEMO-SHT31-01',
          validation: relHumidity >= 100 ? 'sospechoso' : 'valido',
          validationNote: relHumidity >= 100 ? 'HR de 100 %: posible saturación o condensación sobre el sensor' : '',
          isDemo: true, createdAt: now, updatedAt: now,
        });
      }
    }
    await db.climateRecords.bulkAdd(flagSensorJumps(records));
    // Los riegos que quedaron abiertos al final se cierran en la última lectura
    const lastTs = records.at(-1)?.ts ?? now;
    for (const e of events) if (e.end === null) { e.end = lastTs; e.closeReason = 'Fin de los datos de demostración.'; }
    await db.valveEvents.bulkAdd(events);
  });
}

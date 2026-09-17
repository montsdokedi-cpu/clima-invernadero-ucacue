import { addDays, todayISO, toTimestamp } from '../lib/dates';
import { flagSensorJumps } from '../lib/validation';
import { db, tomatoThresholds } from './db';
import type { ClimateRecord, StageChange } from './types';

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
  await db.transaction('rw', [db.climateRecords, db.crops, db.greenhouses, db.climateThresholds, db.reports, db.users], async () => {
    await db.climateRecords.filter((r) => r.isDemo).delete();
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

  await db.transaction('rw', [db.climateRecords, db.crops, db.greenhouses, db.climateThresholds, db.users], async () => {
    const ghId = (await db.greenhouses.add({
      code: 'DEMO-01',
      name: 'Invernadero de demostración',
      location: 'Datos simulados (referencia: clima de Macas, Morona Santiago)',
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
        // HR nocturna alta (típica de Macas) sin saturar; lecturas de 100 % solo ocasionales (sensor mojado)
        const relHumidity = rand() < 0.002 ? 100 : Math.min(98, Math.max(40, 96 - (airTemp - tNight) * 3.2 + (1 - sunny) * 4 + (rainy ? 3 : 0) + noise(2.2)));
        soil += (airTemp - soil) * 0.035 + noise(0.05);
        soilM = Math.min(88, Math.max(40, soilM - phase * 0.18 + (slot === 16 ? 9 : 0) + (rainy ? 0.05 : 0) + noise(0.3)));
        const solarRadiation = Math.round(Math.max(0, phase * (160 + sunny * 640) + noise(20)));
        const outsideTemp = tNight - 1.8 + (tBoost - 4.5) * phase + noise(0.6);
        records.push({
          date, time, ts, greenhouseId: ghId, cropId: tomatoId,
          airTemp: +airTemp.toFixed(1),
          relHumidity: Math.round(relHumidity),
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
  });
}

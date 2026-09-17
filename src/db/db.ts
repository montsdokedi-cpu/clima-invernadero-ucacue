import Dexie, { type EntityTable } from 'dexie';
import type {
  AppSettings,
  ClimateRecord,
  ClimateThreshold,
  Crop,
  Greenhouse,
  Report,
  User,
} from './types';
import { TOMATO_STAGES } from './types';

// Base de datos local (IndexedDB) — funciona sin internet en web, PWA y APK.
// El esquema replica las tablas del modelo relacional (docs/base-de-datos.sql)
// para poder sincronizar más adelante con un servidor o con sensores IoT.
// Se conserva el nombre interno de la base para no perder los datos existentes.
export const db = new Dexie('ClimaInvernaderoUCC') as Dexie & {
  users: EntityTable<User, 'id'>;
  greenhouses: EntityTable<Greenhouse, 'id'>;
  crops: EntityTable<Crop, 'id'>;
  climateRecords: EntityTable<ClimateRecord, 'id'>;
  climateThresholds: EntityTable<ClimateThreshold, 'id'>;
  reports: EntityTable<Report, 'id'>;
  settings: EntityTable<AppSettings, 'id'>;
};

// Nota: IndexedDB no indexa booleanos, por eso `isDemo` se filtra en memoria.
db.version(1).stores({
  users: '++id, name',
  greenhouses: '++id, code',
  crops: '++id, name, greenhouseId',
  climateRecords: '++id, ts, date, greenhouseId, cropId, [greenhouseId+date+time]',
  climateThresholds: '++id, cropId',
  reports: '++id, generatedAt',
  settings: 'id',
});

// v2: origen del dato, sensor y estado de validación.
db.version(2)
  .stores({
    climateRecords: '++id, ts, date, greenhouseId, cropId, source, sensorId, validation, [greenhouseId+date+time]',
    climateThresholds: '++id, cropId, stage',
  })
  .upgrade(async (tx) => {
    await tx
      .table('climateRecords')
      .toCollection()
      .modify((r: ClimateRecord) => {
        if (!r.validation) r.validation = 'valido';
        if (r.sensorId === undefined) r.sensorId = null;
      });
  });

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  institution: 'Universidad Católica de Cuenca (UCACUE)',
  campus: 'Sede Macas',
  dataMode: 'real',
  sourceFilter: ['sensor', 'manual', 'importado'],
  defaultGreenhouseId: null,
  defaultResponsible: '',
  optionalFields: {
    soilTemp: true,
    soilMoisture: true,
    luminosity: false,
    solarRadiation: false,
    windSpeed: false,
    precipitation: false,
    outsideTemp: false,
    outsideHumidity: false,
  },
  abruptTempChange: 5,
  abruptHumidityChange: 20,
  gapHours: 6,
  radiationUnit: 'W/m²',
  windUnit: 'm/s',
  studyTitle:
    'Análisis de las condiciones microclimáticas del invernadero de la UCACUE mediante datos reales de sensores para el monitoreo del cultivo de tomate',
  studyProblem:
    'Determinar si las condiciones de temperatura y humedad relativa registradas dentro del invernadero son adecuadas para el desarrollo del cultivo de tomate e identificar periodos de posible estrés climático.',
  referenceSource: 'Rangos referenciales configurables según variedad, etapa fenológica y bibliografía utilizada.',
};

export async function getSettings(): Promise<AppSettings> {
  const s = await db.settings.get('app');
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    optionalFields: { ...DEFAULT_SETTINGS.optionalFields, ...s?.optionalFields },
    sourceFilter: s?.sourceFilter?.length ? s.sourceFilter : DEFAULT_SETTINGS.sourceFilter,
  };
}

export async function saveSettings(patch: Partial<AppSettings>) {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, id: 'app' });
}

/**
 * Rangos REFERENCIALES del tomate (no son mediciones). Valores de partida frecuentes en
 * la bibliografía hortícola; el docente o investigador debe ajustarlos a la variedad,
 * etapa fenológica y referencia bibliográfica utilizada.
 */
export const TOMATO_REFERENCES: { stage: string | null; tempMin: number; tempMax: number; humidityMin: number; humidityMax: number }[] = [
  { stage: null, tempMin: 15, tempMax: 30, humidityMin: 60, humidityMax: 85 },
  { stage: 'Semillero', tempMin: 20, tempMax: 30, humidityMin: 70, humidityMax: 90 },
  { stage: 'Crecimiento vegetativo', tempMin: 18, tempMax: 30, humidityMin: 60, humidityMax: 80 },
  { stage: 'Floración', tempMin: 15, tempMax: 30, humidityMin: 60, humidityMax: 80 },
  { stage: 'Fructificación', tempMin: 15, tempMax: 30, humidityMin: 60, humidityMax: 85 },
  { stage: 'Maduración', tempMin: 18, tempMax: 30, humidityMin: 60, humidityMax: 85 },
];

export function tomatoThresholds(isDemo: boolean): ClimateThreshold[] {
  return TOMATO_REFERENCES.map((r) => ({
    cropId: null,
    stage: r.stage,
    label: r.stage ? `Tomate · ${r.stage}` : 'Tomate · referencia general',
    tempMin: r.tempMin,
    tempMax: r.tempMax,
    humidityMin: r.humidityMin,
    humidityMax: r.humidityMax,
    soilTempMin: r.stage ? null : 15,
    soilTempMax: r.stage ? null : 28,
    soilMoistureMin: r.stage ? null : 40,
    soilMoistureMax: r.stage ? null : 80,
    isDemo,
  }));
}

let basePromise: Promise<void> | null = null;

/** Crea los datos base reales la primera vez (una sola vez por sesión) y adapta instalaciones anteriores. */
export function ensureBaseData() {
  basePromise ??= db.transaction('rw', [db.greenhouses, db.climateThresholds, db.settings, db.crops], createBaseData);
  return basePromise;
}

async function createBaseData() {
  if (!(await db.settings.get('app'))) await db.settings.put(DEFAULT_SETTINGS);
  const s = await getSettings();
  // Instalaciones previas con el nombre antiguo de la institución
  if (s.institution === 'Universidad Católica de Cuenca') await saveSettings({ institution: DEFAULT_SETTINGS.institution });

  let ghId = s.defaultGreenhouseId;
  const realGreenhouses = await db.greenhouses.filter((g) => !g.isDemo).toArray();
  if (realGreenhouses.length === 0) {
    ghId = (await db.greenhouses.add({
      code: 'INV-UCACUE-01',
      name: 'Invernadero UCACUE Macas',
      location: 'Universidad Católica de Cuenca, sede Macas – Morona Santiago',
      coverType: 'Polietileno',
      isDemo: false,
      createdAt: Date.now(),
    })) as number;
    await saveSettings({ defaultGreenhouseId: ghId });
  } else if (!ghId) {
    ghId = realGreenhouses[0].id!;
    await saveSettings({ defaultGreenhouseId: ghId });
  }

  const realThresholds = await db.climateThresholds.filter((t) => !t.isDemo && t.cropId === null).toArray();
  const general = realThresholds.find((t) => !t.stage);
  if (!general) {
    await db.climateThresholds.bulkAdd(tomatoThresholds(false));
  } else {
    // Rango general antiguo sin modificar → pasa a referencia del tomate
    if (general.label === 'Rango general del invernadero' && general.humidityMin === 50 && general.humidityMax === 90) {
      await db.climateThresholds.update(general.id!, { label: 'Tomate · referencia general', humidityMin: 60, humidityMax: 85 });
    }
    if (!realThresholds.some((t) => t.stage)) await db.climateThresholds.bulkAdd(tomatoThresholds(false).filter((t) => t.stage));
  }

  const realCrops = await db.crops.filter((c) => !c.isDemo).count();
  if (realCrops === 0 && ghId) {
    await db.crops.add({
      name: 'Tomate',
      variety: '',
      stage: 'Crecimiento vegetativo',
      stageHistory: [],
      greenhouseId: ghId,
      active: true,
      notes: 'Cultivo de estudio – Climatología Aplicada. Completa variedad y fechas.',
      isDemo: false,
      createdAt: Date.now(),
    });
  }
}

export { TOMATO_STAGES };

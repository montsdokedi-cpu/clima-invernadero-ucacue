// Modelo de datos de Clima Invernadero UCACUE.
// Cada registro identifica su ORIGEN (sensor, manual, importado, demostración) y su
// ESTADO DE VALIDACIÓN. Todas las entidades llevan `isDemo` para que los datos
// simulados nunca se mezclen con los datos reales usados en el análisis académico.

export type Role = 'estudiante' | 'docente' | 'investigador' | 'productor';

export interface User {
  id?: number;
  name: string;
  role: Role;
  email?: string;
  isDemo: boolean;
  createdAt: number;
}

export interface Greenhouse {
  id?: number;
  code: string;
  name: string;
  location: string;
  areaM2?: number;
  coverType?: string;
  notes?: string;
  isDemo: boolean;
  createdAt: number;
}

/** Etapas fenológicas del tomate usadas para el análisis climático por etapa. */
export const TOMATO_STAGES = ['Semillero', 'Crecimiento vegetativo', 'Floración', 'Fructificación', 'Maduración'] as const;
export type TomatoStage = (typeof TOMATO_STAGES)[number];

export const PHENOLOGICAL_STAGES: string[] = [...TOMATO_STAGES, 'Trasplante / establecimiento', 'Cosecha', 'Fin de ciclo'];

export interface StageChange {
  stage: string;
  /** Fecha de inicio de la etapa (YYYY-MM-DD) */
  from: string;
}

export interface Crop {
  id?: number;
  name: string;
  variety?: string;
  sowingDate?: string;
  transplantDate?: string;
  /** Etapa actual */
  stage: string;
  /** Cronología de etapas: permite asignar la etapa a cada registro según su fecha. */
  stageHistory?: StageChange[];
  greenhouseId: number;
  active: boolean;
  notes?: string;
  isDemo: boolean;
  createdAt: number;
}

export const MEASUREMENT_METHODS = [
  'Sensor / datalogger',
  'Termohigrómetro digital',
  'Termómetro de mercurio / alcohol',
  'Psicrómetro',
  'Estación meteorológica portátil',
  'Sonda de suelo',
  'Luxómetro',
  'Otro',
] as const;

export const OUTSIDE_WEATHER = [
  'Soleado',
  'Parcialmente nublado',
  'Nublado',
  'Llovizna',
  'Lluvia',
  'Lluvia intensa',
  'Neblina',
  'Ventoso',
] as const;

export type RecordSource = 'sensor' | 'manual' | 'importado' | 'demo';
export const REAL_SOURCES: RecordSource[] = ['sensor', 'manual', 'importado'];
export const SOURCE_LABELS: Record<RecordSource, string> = {
  sensor: 'Sensor',
  manual: 'Manual',
  importado: 'Importado',
  demo: 'Demostración',
};

/**
 * Estado de validación del dato:
 * - valido: se usa en el análisis.
 * - sospechoso: se usa, pero queda marcado para revisión (valor atípico o salto brusco).
 * - descartado: se conserva en el historial pero se EXCLUYE de cálculos, gráficos y reportes.
 */
export type DataValidation = 'valido' | 'sospechoso' | 'descartado';
export const VALIDATION_LABELS: Record<DataValidation, string> = {
  valido: 'Válido',
  sospechoso: 'Sospechoso',
  descartado: 'Descartado',
};

export interface ClimateRecord {
  id?: number;
  date: string; // YYYY-MM-DD (hora local de Macas)
  time: string; // HH:mm
  ts: number;
  greenhouseId: number;
  cropId?: number | null;
  airTemp: number; // °C
  relHumidity: number; // %
  soilTemp?: number | null;
  soilMoisture?: number | null;
  luminosity?: number | null;
  solarRadiation?: number | null;
  windSpeed?: number | null;
  precipitation?: number | null;
  /** Temperatura y HR exteriores (estación externa), si existen */
  outsideTemp?: number | null;
  outsideHumidity?: number | null;
  phenologicalStage?: string;
  recordedBy?: string;
  method?: string;
  outsideWeather?: string;
  observations?: string;
  cropObservations?: string;
  source: RecordSource;
  /** Identificador del sensor o datalogger (ej. "SHT31-01") */
  sensorId?: string | null;
  validation: DataValidation;
  validationNote?: string;
  isDemo: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ClimateThreshold {
  id?: number;
  /** null = referencia general (tomate) */
  cropId: number | null;
  /** Etapa fenológica a la que aplica; null/undefined = todas */
  stage?: string | null;
  label: string;
  tempMin: number;
  tempMax: number;
  humidityMin: number;
  humidityMax: number;
  soilTempMin?: number | null;
  soilTempMax?: number | null;
  soilMoistureMin?: number | null;
  soilMoistureMax?: number | null;
  isDemo: boolean;
}

export interface Report {
  id?: number;
  title: string;
  from: string;
  to: string;
  greenhouseId: number | null;
  cropId: number | null;
  responsible: string;
  format: 'pdf' | 'xlsx' | 'csv';
  recordCount: number;
  sources?: RecordSource[];
  generatedAt: number;
  isDemo: boolean;
}

export type OptionalField =
  | 'soilTemp'
  | 'soilMoisture'
  | 'luminosity'
  | 'solarRadiation'
  | 'windSpeed'
  | 'precipitation'
  | 'outsideTemp'
  | 'outsideHumidity';

export interface AppSettings {
  id: 'app';
  institution: string;
  campus: string;
  dataMode: 'real' | 'demo';
  /** Fuentes de datos reales incluidas en el análisis */
  sourceFilter: RecordSource[];
  defaultGreenhouseId: number | null;
  defaultResponsible: string;
  optionalFields: Record<OptionalField, boolean>;
  abruptTempChange: number;
  abruptHumidityChange: number;
  gapHours: number;
  radiationUnit: 'W/m²';
  windUnit: 'm/s' | 'km/h';
  /** Planteamiento del problema práctico que se analiza */
  studyProblem: string;
  studyTitle: string;
  /** Bibliografía o criterio usado para los rangos de referencia */
  referenceSource: string;
}

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
  /** Sistema de 4 parcelas: 2 puntos ambientales y 4 sensores de humedad del suelo (ESP32) */
  airTemp1?: number | null;
  relHumidity1?: number | null;
  airTemp2?: number | null;
  relHumidity2?: number | null;
  soilMoisture1?: number | null;
  soilMoisture2?: number | null;
  soilMoisture3?: number | null;
  soilMoisture4?: number | null;
  /** Estado de las electroválvulas en el momento de la lectura (true = abierta) */
  valve1?: boolean | null;
  valve2?: boolean | null;
  valve3?: boolean | null;
  valve4?: boolean | null;
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
  | 'outsideHumidity'
  | 'airTemp1'
  | 'relHumidity1'
  | 'airTemp2'
  | 'relHumidity2'
  | 'soilMoisture1'
  | 'soilMoisture2'
  | 'soilMoisture3'
  | 'soilMoisture4';

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
  /** Conexión con el ESP32 (Wi-Fi) */
  esp32: Esp32Settings;
}

// ---------------------------------------------------------------------------
// Sistema físico: 4 parcelas (sensor de suelo + electroválvula), 2 puntos
// ambientales y 1 ESP32 por Wi-Fi. No se asume hardware específico.
// ---------------------------------------------------------------------------

export const PARCEL_IDS = [1, 2, 3, 4] as const;
export type ParcelId = (typeof PARCEL_IDS)[number];

export type IrrigationMode = 'automatico' | 'humedad' | 'temperatura' | 'manual';
export const MODE_LABELS: Record<IrrigationMode, string> = {
  automatico: 'Automático',
  humedad: 'Solo humedad',
  temperatura: 'Solo temperatura',
  manual: 'Manual',
};
export const MODE_HELP: Record<IrrigationMode, string> = {
  automatico: 'Considera la humedad del suelo de la parcela y la temperatura ambiental.',
  humedad: 'Abre si la humedad del suelo baja de la mínima y cierra al alcanzar la objetivo.',
  temperatura: 'Abre si la temperatura ambiental supera la máxima y cierra al bajar de la mínima.',
  manual: 'El usuario abre y cierra la electroválvula desde la aplicación.',
};

/** Punto ambiental usado para las decisiones por temperatura */
export type TempSource = 'promedio' | 'punto1' | 'punto2';

export interface Parcel {
  /** 'real-1' … 'real-4' / 'demo-1' … 'demo-4' */
  key: string;
  n: ParcelId;
  name: string;
  mode: IrrigationMode;
  /** Umbrales configurables (null = sin configurar). No son valores agronómicos definitivos. */
  humidityMin: number | null;
  humidityTarget: number | null;
  tempMin: number | null;
  tempMax: number | null;
  /** Límite de seguridad de un riego automático (min); null = sin límite */
  maxDurationMin: number | null;
  tempSource: TempSource;
  cropId?: number | null;
  notes?: string;
  isDemo: boolean;
  updatedAt: number;
}

export type ValveOrigin = 'esp32' | 'app' | 'manual' | 'demo';

/** Historial de activaciones de electroválvulas */
export interface ValveEvent {
  id?: number;
  parcel: ParcelId;
  start: number;
  end: number | null;
  mode: IrrigationMode;
  reason: string;
  closeReason?: string;
  origin: ValveOrigin;
  isDemo: boolean;
}

export interface Esp32Settings {
  /** 'desactivado' no intenta conectar; 'simulador' solo en modo demostración */
  transport: 'desactivado' | 'http' | 'simulador';
  /** Dirección IP o nombre del ESP32 (sin definir hasta tener el hardware) */
  host: string;
  port: number | null;
  dataPath: string;
  commandPath: string;
  configPath: string;
  statusPath: string;
  /** Segundos entre consultas al ESP32 */
  pollSeconds: number;
  /** Cada cuántos minutos se guarda una lectura en el histórico (además de cada cambio de válvula) */
  saveEveryMin: number;
  /** Segundos sin respuesta para considerar el ESP32 desconectado */
  offlineSeconds: number;
  /** Segundos de espera para confirmar una orden a una electroválvula */
  commandTimeoutSeconds: number;
  /** Minutos sin datos válidos de un sensor para alertar */
  sensorStaleMinutes: number;
  /** Dónde se ejecutan los modos automáticos */
  controlLogic: 'esp32' | 'app';
  autoConnect: boolean;
}

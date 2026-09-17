-- ============================================================================
-- CLIMA INVERNADERO UCACUE – Modelo relacional (PostgreSQL) · versión 2
-- ----------------------------------------------------------------------------
-- La aplicación guarda los datos en el dispositivo (IndexedDB) con estas mismas
-- entidades. Este script sirve para montar un servidor central que sincronice
-- varios dispositivos o reciba datos directamente de sensores IoT.
-- ============================================================================

CREATE TABLE users (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(120) NOT NULL,
  role         VARCHAR(20)  NOT NULL CHECK (role IN ('estudiante','docente','investigador','productor')),
  email        VARCHAR(160) UNIQUE,
  is_demo      BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE greenhouses (
  id           SERIAL PRIMARY KEY,
  code         VARCHAR(30)  NOT NULL UNIQUE,
  name         VARCHAR(120) NOT NULL,
  location     VARCHAR(200),
  area_m2      NUMERIC(8,2),
  cover_type   VARCHAR(60),
  notes        TEXT,
  is_demo      BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE sensors (
  id             VARCHAR(40) PRIMARY KEY,          -- ej. 'SHT31-01'
  greenhouse_id  INTEGER NOT NULL REFERENCES greenhouses(id),
  model          VARCHAR(80),
  variables      TEXT[],                            -- {'air_temp','rel_humidity',...}
  location_note  VARCHAR(200),                      -- altura, abrigo, posición
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  is_demo        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE crops (
  id               SERIAL PRIMARY KEY,
  greenhouse_id    INTEGER      NOT NULL REFERENCES greenhouses(id),
  name             VARCHAR(80)  NOT NULL,           -- 'Tomate'
  variety          VARCHAR(80),
  sowing_date      DATE,
  transplant_date  DATE,
  stage            VARCHAR(60)  NOT NULL,           -- etapa actual
  active           BOOLEAN      NOT NULL DEFAULT TRUE,
  notes            TEXT,
  is_demo          BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (transplant_date IS NULL OR sowing_date IS NULL OR transplant_date >= sowing_date)
);

-- Cronología de etapas fenológicas (permite asignar la etapa a cada lectura por fecha)
CREATE TABLE crop_stages (
  crop_id     INTEGER     NOT NULL REFERENCES crops(id) ON DELETE CASCADE,
  stage       VARCHAR(60) NOT NULL CHECK (stage IN ('Semillero','Crecimiento vegetativo','Floración','Fructificación','Maduración','Trasplante / establecimiento','Cosecha','Fin de ciclo')),
  start_date  DATE        NOT NULL,
  PRIMARY KEY (crop_id, start_date)
);

CREATE TABLE climate_records (
  id                 BIGSERIAL PRIMARY KEY,
  greenhouse_id      INTEGER      NOT NULL REFERENCES greenhouses(id),
  crop_id            INTEGER      REFERENCES crops(id) ON DELETE SET NULL,
  sensor_id          VARCHAR(40)  REFERENCES sensors(id),
  record_date        DATE         NOT NULL,
  record_time        TIME         NOT NULL,
  air_temp           NUMERIC(4,1) NOT NULL CHECK (air_temp BETWEEN -10 AND 60),       -- °C
  rel_humidity       NUMERIC(4,1) NOT NULL CHECK (rel_humidity BETWEEN 0 AND 100),    -- %
  soil_temp          NUMERIC(4,1) CHECK (soil_temp BETWEEN -5 AND 50),
  soil_moisture      NUMERIC(4,1) CHECK (soil_moisture BETWEEN 0 AND 100),
  luminosity         INTEGER      CHECK (luminosity BETWEEN 0 AND 200000),            -- lux
  solar_radiation    NUMERIC(6,1) CHECK (solar_radiation BETWEEN 0 AND 1500),         -- W/m²
  wind_speed         NUMERIC(4,1) CHECK (wind_speed BETWEEN 0 AND 60),                -- m/s
  precipitation      NUMERIC(5,1) CHECK (precipitation BETWEEN 0 AND 500),            -- mm
  outside_temp       NUMERIC(4,1) CHECK (outside_temp BETWEEN -10 AND 60),            -- °C exterior
  outside_humidity   NUMERIC(4,1) CHECK (outside_humidity BETWEEN 0 AND 100),         -- % exterior
  phenological_stage VARCHAR(60),
  recorded_by        VARCHAR(120),
  method             VARCHAR(60),
  outside_weather    VARCHAR(40),
  observations       TEXT,
  crop_observations  TEXT,
  source             VARCHAR(12)  NOT NULL CHECK (source IN ('sensor','manual','importado','demo')),
  validation         VARCHAR(12)  NOT NULL DEFAULT 'valido' CHECK (validation IN ('valido','sospechoso','descartado')),
  validation_note    TEXT,
  is_demo            BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (greenhouse_id, record_date, record_time, is_demo),
  CHECK ((source = 'demo') = is_demo)
);
CREATE INDEX idx_records_date   ON climate_records (is_demo, greenhouse_id, record_date, record_time);
CREATE INDEX idx_records_source ON climate_records (source, validation);
CREATE INDEX idx_records_sensor ON climate_records (sensor_id);

-- Rangos REFERENCIALES (no mediciones). crop_id NULL = referencia del tomate; stage NULL = todas las etapas
CREATE TABLE climate_thresholds (
  id                 SERIAL PRIMARY KEY,
  crop_id            INTEGER REFERENCES crops(id) ON DELETE CASCADE,
  stage              VARCHAR(60),
  label              VARCHAR(120) NOT NULL,
  temp_min           NUMERIC(4,1) NOT NULL,
  temp_max           NUMERIC(4,1) NOT NULL,
  humidity_min       NUMERIC(4,1) NOT NULL,
  humidity_max       NUMERIC(4,1) NOT NULL,
  soil_temp_min      NUMERIC(4,1),
  soil_temp_max      NUMERIC(4,1),
  soil_moisture_min  NUMERIC(4,1),
  soil_moisture_max  NUMERIC(4,1),
  reference_source   TEXT,                           -- bibliografía o criterio
  is_demo            BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (temp_min < temp_max AND humidity_min < humidity_max),
  UNIQUE (crop_id, stage, is_demo)
);

CREATE TABLE reports (
  id             SERIAL PRIMARY KEY,
  title          TEXT NOT NULL,
  date_from      DATE NOT NULL,
  date_to        DATE NOT NULL,
  greenhouse_id  INTEGER REFERENCES greenhouses(id),
  crop_id        INTEGER REFERENCES crops(id) ON DELETE SET NULL,
  responsible    VARCHAR(120),
  format         VARCHAR(4) NOT NULL CHECK (format IN ('pdf','xlsx','csv')),
  sources        TEXT[],
  record_count   INTEGER NOT NULL,
  is_demo        BOOLEAN NOT NULL DEFAULT FALSE,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

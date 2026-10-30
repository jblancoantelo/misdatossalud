/**
 * Esquema SQLite del proyecto.
 *
 * Todas las tablas llevan `source` para poder distinguir el origen del dato.
 * La prioridad es Zepp: las importaciones de Google Health usan
 * `INSERT OR IGNORE`, así que solo rellenan huecos.
 */

export const SCHEMA_VERSION = 1

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id TEXT,
  gender INTEGER,
  height_cm REAL,
  weight_kg REAL,
  nickname TEXT,
  birthday TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS daily_activity (
  date TEXT PRIMARY KEY,
  steps INTEGER,
  distance_m REAL,
  run_distance_m REAL,
  calories REAL,
  source TEXT NOT NULL DEFAULT 'zepp'
);

CREATE TABLE IF NOT EXISTS minute_activity (
  ts INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  tod INTEGER NOT NULL,
  steps INTEGER,
  source TEXT NOT NULL DEFAULT 'zepp'
);
CREATE INDEX IF NOT EXISTS idx_minute_activity_date ON minute_activity (date);

CREATE TABLE IF NOT EXISTS activity_stage (
  start_ts INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  end_ts INTEGER,
  distance_m REAL,
  calories REAL,
  steps INTEGER,
  source TEXT NOT NULL DEFAULT 'zepp'
);
CREATE INDEX IF NOT EXISTS idx_activity_stage_date ON activity_stage (date);

CREATE TABLE IF NOT EXISTS body_measurement (
  ts INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  weight_kg REAL,
  height_cm REAL,
  bmi REAL,
  fat_rate REAL,
  body_water_rate REAL,
  bone_mass_kg REAL,
  metabolism REAL,
  muscle_rate REAL,
  visceral_fat REAL,
  source TEXT NOT NULL DEFAULT 'zepp'
);
CREATE INDEX IF NOT EXISTS idx_body_measurement_date ON body_measurement (date);

CREATE TABLE IF NOT EXISTS body_circumference (
  ts INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  arm_cm REAL,
  calf_cm REAL,
  chest_cm REAL,
  hip_cm REAL,
  thigh_cm REAL,
  waist_cm REAL,
  source TEXT NOT NULL DEFAULT 'zepp'
);

CREATE TABLE IF NOT EXISTS heart_rate (
  ts INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  tod INTEGER NOT NULL,
  bpm INTEGER,
  source TEXT NOT NULL DEFAULT 'zepp'
);
CREATE INDEX IF NOT EXISTS idx_heart_rate_date ON heart_rate (date);

CREATE TABLE IF NOT EXISTS heart_rate_auto (
  ts INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  tod INTEGER NOT NULL,
  bpm INTEGER,
  source TEXT NOT NULL DEFAULT 'zepp'
);
CREATE INDEX IF NOT EXISTS idx_heart_rate_auto_date ON heart_rate_auto (date);

CREATE TABLE IF NOT EXISTS sleep_session (
  date TEXT PRIMARY KEY,
  start_ts INTEGER,
  end_ts INTEGER,
  deep_min INTEGER,
  light_min INTEGER,
  rem_min INTEGER,
  wake_min INTEGER,
  naps INTEGER,
  source TEXT NOT NULL DEFAULT 'zepp'
);

CREATE TABLE IF NOT EXISTS sleep_minute (
  ts INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  tod INTEGER NOT NULL,
  stage TEXT,
  bpm INTEGER,
  respiratory_rate REAL,
  source TEXT NOT NULL DEFAULT 'zepp'
);
CREATE INDEX IF NOT EXISTS idx_sleep_minute_date ON sleep_minute (date);

CREATE TABLE IF NOT EXISTS sport (
  start_ts INTEGER NOT NULL,
  type INTEGER NOT NULL,
  date TEXT NOT NULL,
  duration_s INTEGER,
  distance_m REAL,
  calories REAL,
  avg_pace REAL,
  max_pace REAL,
  min_pace REAL,
  source TEXT NOT NULL DEFAULT 'zepp',
  PRIMARY KEY (start_ts, type)
);
CREATE INDEX IF NOT EXISTS idx_sport_date ON sport (date);
`

/** Tablas de datos que se vacían al borrar el histórico. */
export const DATA_TABLES = [
  'daily_activity',
  'minute_activity',
  'activity_stage',
  'body_measurement',
  'body_circumference',
  'heart_rate',
  'heart_rate_auto',
  'sleep_session',
  'sleep_minute',
  'sport',
  'profile',
] as const

export type DataTable = (typeof DATA_TABLES)[number]

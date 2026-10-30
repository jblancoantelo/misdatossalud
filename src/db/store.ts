import type { Database, QueryExecResult, Statement } from 'sql.js'
import { DATA_TABLES, SCHEMA_SQL, SCHEMA_VERSION } from './schema'
import { addDays, localDateFromTs, timeOfDaySeconds, todayISO } from '../lib/date'

export type SqlValue = string | number | null
export type InsertMode = 'replace' | 'ignore'

export interface CoverageEntry {
  rows: number
  first: string | null
  last: string | null
}

export interface Coverage {
  activity: CoverageEntry
  minutes: CoverageEntry
  stages: CoverageEntry
  heart: CoverageEntry
  sleep: CoverageEntry
  sleepMinutes: CoverageEntry
  sport: CoverageEntry
  body: CoverageEntry
}

export interface DailyActivity {
  date: string
  steps: number | null
  distanceM: number | null
  runDistanceM: number | null
  calories: number | null
}

export interface SleepNight {
  date: string
  startTs: number | null
  endTs: number | null
  deepMin: number | null
  lightMin: number | null
  remMin: number | null
  wakeMin: number | null
  naps: number | null
  totalMin: number | null
}

export interface HeartDay {
  date: string
  min: number
  avg: number
  max: number
  samples: number
}

export interface SportSession {
  startTs: number
  date: string
  type: number
  durationS: number | null
  distanceM: number | null
  calories: number | null
  avgPace: number | null
}

export interface BodyMeasurement {
  ts: number
  date: string
  weightKg: number | null
  bmi: number | null
  fatRate: number | null
  bodyWaterRate: number | null
  muscleRate: number | null
  visceralFat: number | null
  boneMassKg: number | null
  metabolism: number | null
}

export interface PeriodStats {
  from: string
  to: string
  stepsTotal: number
  stepsAvg: number | null
  daysWithSteps: number
  distanceTotal: number
  caloriesTotal: number
  sleepAvgMin: number | null
  nights: number
  heartAvg: number | null
  heartMin: number | null
  sportCount: number
  sportMinutes: number
  sportDistance: number
  weightKg: number | null
}

export interface WeeklySummary {
  current: PeriodStats
  previous: PeriodStats
}

export interface ImportMeta {
  importedAt: string
  source: string
  files: Record<string, number>
  rows: number
  warnings: string[]
}

const stmtCache = new WeakMap<Database, Map<string, Statement>>()

function statementCache(db: Database): Map<string, Statement> {
  let cache = stmtCache.get(db)
  if (!cache) {
    cache = new Map()
    stmtCache.set(db, cache)
  }
  return cache
}

function rowsToObjects<T>(result: QueryExecResult[]): T[] {
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map((row) => {
    const obj: Record<string, SqlValue> = {}
    columns.forEach((column, index) => {
      obj[column] = (row[index] ?? null) as SqlValue
    })
    return obj as unknown as T
  })
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Etiquetas de los códigos de deporte de Zepp que aparecen en los exports. */
export const SPORT_LABELS: Record<number, string> = {
  1: 'Carrera',
  2: 'Cinta',
  3: 'Caminata',
  4: 'Bicicleta',
  5: 'Bicicleta estática',
  6: 'Caminata',
  7: 'Remo',
  8: 'Natación',
  9: 'Carrera',
  10: 'Yoga',
  11: 'Escalada',
  12: 'Entrenamiento',
  13: 'Senderismo',
  14: 'Caminata',
  15: 'Esquí',
  16: 'Entrenamiento',
  17: 'Fuerza',
  18: 'Caminata',
  24: 'Entrenamiento',
  40: 'Caminata',
  47: 'Carrera',
  51: 'Entrenamiento',
  85: 'Entrenamiento',
  132: 'Bicicleta',
}

export function sportLabel(type: number): string {
  return SPORT_LABELS[type] ?? `Deporte ${type}`
}

export class HealthStore {
  readonly db: Database
  private dirty = false

  constructor(db: Database) {
    this.db = db
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(SCHEMA_SQL)
    const current = Number(this.getMeta('schema_version') ?? 0)
    if (current !== SCHEMA_VERSION) {
      this.setMeta('schema_version', String(SCHEMA_VERSION))
    }
  }

  // --- metadatos ---------------------------------------------------------

  getMeta(key: string): string | null {
    const rows = this.all<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])
    return rows.length ? rows[0].value : null
  }

  setMeta(key: string, value: string): void {
    this.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value])
    this.markDirty()
  }

  getImportMeta(): ImportMeta | null {
    const raw = this.getMeta('last_import')
    if (!raw) return null
    try {
      return JSON.parse(raw) as ImportMeta
    } catch {
      return null
    }
  }

  setImportMeta(meta: ImportMeta): void {
    this.setMeta('last_import', JSON.stringify(meta))
  }

  isDirty(): boolean {
    return this.dirty
  }

  markClean(): void {
    this.dirty = false
  }

  private markDirty(): void {
    this.dirty = true
  }

  // --- utilidades SQL ----------------------------------------------------

  private all<T>(sql: string, params: SqlValue[] = []): T[] {
    return rowsToObjects<T>(this.db.exec(sql, params))
  }

  private one<T>(sql: string, params: SqlValue[] = []): T | null {
    const rows = this.all<T>(sql, params)
    return rows.length ? rows[0] : null
  }

  private run(sql: string, params: SqlValue[] = []): void {
    this.db.run(sql, params)
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      this.markDirty()
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * Inserta filas por lotes con una única sentencia multi-fila preparada.
   * `replace` da prioridad al dato nuevo (Zepp); `ignore` solo rellena huecos.
   */
  insertBatch(
    table: string,
    columns: string[],
    rows: SqlValue[][],
    mode: InsertMode = 'replace',
  ): void {
    if (!rows.length) return
    const cache = statementCache(this.db)
    const perStatement = Math.max(1, Math.min(200, Math.floor(900 / columns.length)))
    const verb = mode === 'replace' ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE'

    for (let offset = 0; offset < rows.length; offset += perStatement) {
      const chunk = rows.slice(offset, offset + perStatement)
      const key = `${verb}|${table}|${columns.join(',')}|${chunk.length}`
      let stmt = cache.get(key)
      if (!stmt) {
        const tuple = `(${columns.map(() => '?').join(',')})`
        const sql = `${verb} INTO ${table} (${columns.join(',')}) VALUES ${Array.from(
          { length: chunk.length },
          () => tuple,
        ).join(',')}`
        stmt = this.db.prepare(sql)
        cache.set(key, stmt)
      }
      const flat: SqlValue[] = []
      for (const row of chunk) {
        for (let i = 0; i < columns.length; i += 1) flat.push(row[i] ?? null)
      }
      stmt.run(flat)
    }
  }

  // --- cobertura y perfiles ---------------------------------------------

  private coverageOf(table: string, column: string): CoverageEntry {
    const row = this.one<{ n: number; first: SqlValue; last: SqlValue }>(
      `SELECT COUNT(*) AS n, MIN(${column}) AS first, MAX(${column}) AS last FROM ${table}`,
    )
    return {
      rows: row?.n ?? 0,
      first: asText(row?.first),
      last: asText(row?.last),
    }
  }

  getCoverage(): Coverage {
    return {
      activity: this.coverageOf('daily_activity', 'date'),
      minutes: this.coverageOf('minute_activity', 'date'),
      stages: this.coverageOf('activity_stage', 'date'),
      heart: this.coverageOf('heart_rate_auto', 'date'),
      sleep: this.coverageOf('sleep_session', 'date'),
      sleepMinutes: this.coverageOf('sleep_minute', 'date'),
      sport: this.coverageOf('sport', 'date'),
      body: this.coverageOf('body_measurement', 'date'),
    }
  }

  getTotalRows(): number {
    const coverage = this.getCoverage()
    return Object.values(coverage).reduce((sum, entry) => sum + entry.rows, 0)
  }

  getProfile(): Record<string, SqlValue> | null {
    return this.one<Record<string, SqlValue>>('SELECT * FROM profile WHERE id = 1')
  }

  saveProfile(profile: {
    userId?: string | null
    gender?: number | null
    heightCm?: number | null
    weightKg?: number | null
    nickname?: string | null
    birthday?: string | null
  }): void {
    this.run(
      `INSERT OR REPLACE INTO profile
        (id, user_id, gender, height_cm, weight_kg, nickname, birthday, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        profile.userId ?? null,
        profile.gender ?? null,
        profile.heightCm ?? null,
        profile.weightKg ?? null,
        profile.nickname ?? null,
        profile.birthday ?? null,
        new Date().toISOString(),
      ],
    )
    this.markDirty()
  }

  // --- consultas ---------------------------------------------------------

  getDailyActivity(from: string, to: string): DailyActivity[] {
    return this.all<{
      date: string
      steps: number | null
      distance_m: number | null
      run_distance_m: number | null
      calories: number | null
    }>(
      `SELECT date, steps, distance_m, run_distance_m, calories
         FROM daily_activity
        WHERE date BETWEEN ? AND ?
        ORDER BY date`,
      [from, to],
    ).map((row) => ({
      date: row.date,
      steps: asNumber(row.steps),
      distanceM: asNumber(row.distance_m),
      runDistanceM: asNumber(row.run_distance_m),
      calories: asNumber(row.calories),
    }))
  }

  getSleepNights(from: string, to: string): SleepNight[] {
    return this.all<{
      date: string
      start_ts: number | null
      end_ts: number | null
      deep_min: number | null
      light_min: number | null
      rem_min: number | null
      wake_min: number | null
      naps: number | null
      total_min: number | null
    }>(
      `SELECT date, start_ts, end_ts, deep_min, light_min, rem_min, wake_min, naps,
              (COALESCE(deep_min, 0) + COALESCE(light_min, 0) + COALESCE(rem_min, 0)) AS total_min
         FROM sleep_session
        WHERE date BETWEEN ? AND ?
        ORDER BY date`,
      [from, to],
    ).map((row) => ({
      date: row.date,
      startTs: asNumber(row.start_ts),
      endTs: asNumber(row.end_ts),
      deepMin: asNumber(row.deep_min),
      lightMin: asNumber(row.light_min),
      remMin: asNumber(row.rem_min),
      wakeMin: asNumber(row.wake_min),
      naps: asNumber(row.naps),
      totalMin: asNumber(row.total_min),
    }))
  }

  getHeartDays(from: string, to: string): HeartDay[] {
    return this.all<{ date: string; mn: number; av: number; mx: number; n: number }>(
      `SELECT date, MIN(bpm) AS mn, AVG(bpm) AS av, MAX(bpm) AS mx, COUNT(*) AS n
         FROM (
           SELECT date, bpm FROM heart_rate WHERE date BETWEEN ? AND ?
           UNION ALL
           SELECT date, bpm FROM heart_rate_auto WHERE date BETWEEN ? AND ?
         )
        WHERE bpm IS NOT NULL AND bpm > 20
        GROUP BY date
        ORDER BY date`,
      [from, to, from, to],
    ).map((row) => ({
      date: row.date,
      min: Math.round(row.mn),
      avg: Math.round(row.av),
      max: Math.round(row.mx),
      samples: row.n,
    }))
  }

  getHeartSeries(fromTs: number, toTs: number, maxPoints = 2000): { ts: number; bpm: number }[] {
    const rows = this.all<{ ts: number; bpm: number }>(
      `SELECT ts, bpm FROM heart_rate_auto
        WHERE ts BETWEEN ? AND ? AND bpm > 20
        ORDER BY ts`,
      [fromTs, toTs],
    )
    if (rows.length <= maxPoints) return rows
    const step = rows.length / maxPoints
    const out: { ts: number; bpm: number }[] = []
    for (let i = 0; i < maxPoints; i += 1) {
      const row = rows[Math.floor(i * step)]
      out.push({ ts: row.ts, bpm: row.bpm })
    }
    return out
  }

  getHourlyHeart(from: string, to: string): { hour: number; avg: number; samples: number }[] {
    return this.all<{ hour: number; av: number; n: number }>(
      `SELECT CAST(tod / 3600 AS INTEGER) AS hour, AVG(bpm) AS av, COUNT(*) AS n
         FROM heart_rate_auto
        WHERE date BETWEEN ? AND ? AND bpm > 20
        GROUP BY hour
        ORDER BY hour`,
      [from, to],
    ).map((row) => ({ hour: row.hour, avg: Math.round(row.av), samples: row.n }))
  }

  getSports(limit = 200, from?: string, to?: string): SportSession[] {
    const params: SqlValue[] = []
    let where = ''
    if (from && to) {
      where = 'WHERE date BETWEEN ? AND ?'
      params.push(from, to)
    }
    params.push(limit)
    return this.all<{
      start_ts: number
      date: string
      type: number
      duration_s: number | null
      distance_m: number | null
      calories: number | null
      avg_pace: number | null
    }>(
      `SELECT start_ts, date, type, duration_s, distance_m, calories, avg_pace
         FROM sport
         ${where}
        ORDER BY start_ts DESC
        LIMIT ?`,
      params,
    ).map((row) => ({
      startTs: row.start_ts,
      date: row.date,
      type: row.type,
      durationS: asNumber(row.duration_s),
      distanceM: asNumber(row.distance_m),
      calories: asNumber(row.calories),
      avgPace: asNumber(row.avg_pace),
    }))
  }

  getBodyMeasurements(limit = 400): BodyMeasurement[] {
    return this.all<{
      ts: number
      date: string
      weight_kg: number | null
      bmi: number | null
      fat_rate: number | null
      body_water_rate: number | null
      muscle_rate: number | null
      visceral_fat: number | null
      bone_mass_kg: number | null
      metabolism: number | null
    }>(
      `SELECT ts, date, weight_kg, bmi, fat_rate, body_water_rate, muscle_rate,
              visceral_fat, bone_mass_kg, metabolism
         FROM body_measurement
        ORDER BY ts DESC
        LIMIT ?`,
      [limit],
    )
      .map((row) => ({
        ts: row.ts,
        date: row.date,
        weightKg: asNumber(row.weight_kg),
        bmi: asNumber(row.bmi),
        fatRate: asNumber(row.fat_rate),
        bodyWaterRate: asNumber(row.body_water_rate),
        muscleRate: asNumber(row.muscle_rate),
        visceralFat: asNumber(row.visceral_fat),
        boneMassKg: asNumber(row.bone_mass_kg),
        metabolism: asNumber(row.metabolism),
      }))
      .reverse()
  }

  getHypnogram(date: string): { ts: number; tod: number; stage: string | null; bpm: number | null }[] {
    return this.all<{ ts: number; tod: number; stage: string | null; bpm: number | null }>(
      `SELECT ts, tod, stage, bpm FROM sleep_minute WHERE date = ? ORDER BY ts`,
      [date],
    )
  }

  getLatestSleepDate(): string | null {
    const row = this.one<{ date: string }>('SELECT MAX(date) AS date FROM sleep_session')
    return asText(row?.date)
  }

  // --- resumen semanal ---------------------------------------------------

  private periodStats(from: string, to: string): PeriodStats {
    const activity = this.one<{
      n: number
      total: number | null
      avg: number | null
      dist: number | null
      kcal: number | null
    }>(
      `SELECT COUNT(*) AS n, SUM(steps) AS total, AVG(steps) AS avg,
              SUM(distance_m) AS dist, SUM(calories) AS kcal
         FROM daily_activity
        WHERE date BETWEEN ? AND ? AND steps IS NOT NULL`,
      [from, to],
    )

    const sleep = this.one<{ n: number; avg: number | null }>(
      `SELECT COUNT(*) AS n,
              AVG(COALESCE(deep_min, 0) + COALESCE(light_min, 0) + COALESCE(rem_min, 0)) AS avg
         FROM sleep_session
        WHERE date BETWEEN ? AND ?
          AND (deep_min IS NOT NULL OR light_min IS NOT NULL OR rem_min IS NOT NULL)`,
      [from, to],
    )

    const heart = this.one<{ avg: number | null; mn: number | null }>(
      `SELECT AVG(bpm) AS avg, MIN(bpm) AS mn
         FROM heart_rate_auto
        WHERE date BETWEEN ? AND ? AND bpm > 20`,
      [from, to],
    )

    const sport = this.one<{ n: number; dur: number | null; dist: number | null }>(
      `SELECT COUNT(*) AS n, SUM(duration_s) AS dur, SUM(distance_m) AS dist
         FROM sport
        WHERE date BETWEEN ? AND ?`,
      [from, to],
    )

    const weight = this.one<{ weight_kg: number | null }>(
      `SELECT weight_kg FROM body_measurement
        WHERE date <= ? AND weight_kg IS NOT NULL
        ORDER BY ts DESC LIMIT 1`,
      [to],
    )

    return {
      from,
      to,
      stepsTotal: asNumber(activity?.total) ?? 0,
      stepsAvg: asNumber(activity?.avg),
      daysWithSteps: activity?.n ?? 0,
      distanceTotal: asNumber(activity?.dist) ?? 0,
      caloriesTotal: asNumber(activity?.kcal) ?? 0,
      sleepAvgMin: asNumber(sleep?.avg),
      nights: sleep?.n ?? 0,
      heartAvg: asNumber(heart?.avg),
      heartMin: asNumber(heart?.mn),
      sportCount: sport?.n ?? 0,
      sportMinutes: (asNumber(sport?.dur) ?? 0) / 60,
      sportDistance: asNumber(sport?.dist) ?? 0,
      weightKg: asNumber(weight?.weight_kg),
    }
  }

  getWeeklySummary(endISO = todayISO()): WeeklySummary {
    const currentFrom = addDays(endISO, -6)
    const previousTo = addDays(endISO, -7)
    const previousFrom = addDays(previousTo, -6)
    return {
      current: this.periodStats(currentFrom, endISO),
      previous: this.periodStats(previousFrom, previousTo),
    }
  }

  getOverallRange(): { first: string | null; last: string | null } {
    const row = this.one<{ first: string | null; last: string | null }>(
      `SELECT MIN(d) AS first, MAX(d) AS last FROM (
         SELECT date AS d FROM daily_activity
         UNION ALL SELECT date FROM sleep_session
         UNION ALL SELECT date FROM heart_rate_auto
       )`,
    )
    return { first: asText(row?.first), last: asText(row?.last) }
  }

  // --- exportación / borrado --------------------------------------------

  exportBinary(): Uint8Array {
    return this.db.export()
  }

  clearAllData(): void {
    this.transaction(() => {
      for (const table of DATA_TABLES) this.db.exec(`DELETE FROM ${table}`)
      this.db.exec(`DELETE FROM meta WHERE key IN ('last_import', 'profile')`)
    })
    this.markDirty()
  }

  close(): void {
    const cache = stmtCache.get(this.db)
    if (cache) {
      for (const stmt of cache.values()) stmt.free()
      cache.clear()
    }
    this.db.close()
  }

  /** Utilidad de depuración: fechas locales a partir de un instante. */
  static localDate(ts: number): string {
    return localDateFromTs(ts)
  }

  static timeOfDay(ts: number): number {
    return timeOfDaySeconds(ts)
  }
}

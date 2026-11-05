/**
 * Sincronización con Google Health.
 *
 * Escribe solo huecos: todas las inserciones usan `INSERT OR IGNORE`, así que
 * los datos de Zepp (fuente principal) nunca se sobrescriben. En `daily_activity`
 * las columnas vacías de una fila ya sincronizada desde Google se rellenan con
 * `COALESCE`, pero nunca se tocan filas de Zepp.
 *
 * Tipos soportados: pasos, distancia, calorías activas, minutos activos, peso,
 * altura, grasa corporal, frecuencia cardiaca, sueño, entrenamientos, pisos,
 * oxígeno en sangre y VO2 máximo.
 */

import type { HealthStore } from '../db/store'
import { addDays, daysBetween, localDateFromTs, timeOfDaySeconds } from '../lib/date'

const API_BASE = 'https://health.googleapis.com/v4'

/** La API limita los rollups a 90 días; se pide en tramos más pequeños. */
const ROLLUP_WINDOW_DAYS = 30

/** `sleep`/`exercise` tienen un máximo de 25 puntos por página. */
const SESSION_PAGE_SIZE = 25
const SAMPLE_PAGE_SIZE = 1000
const MAX_PAGES = 200

export interface SyncRange {
  from: string
  to: string
}

export interface SyncCategoryResult {
  key: string
  label: string
  /** Días o medidas que devolvió la API. */
  received: number
  /** Días o medidas que se añadieron a la base. */
  added: number
}

export interface SyncResult {
  categories: SyncCategoryResult[]
  warnings: string[]
}

export type SyncPhase = 'steps' | 'body' | 'heart' | 'sleep' | 'exercise' | 'extras'

export interface SyncProgress {
  phase: SyncPhase
  label: string
}

interface CivilDate {
  year?: number
  month?: number
  day?: number
}

interface CivilTime {
  hours?: number
  minutes?: number
  seconds?: number
}

interface SampleTime {
  physicalTime?: string
  civilTime?: { date?: CivilDate; time?: CivilTime }
}

interface Interval {
  startTime?: string
  endTime?: string
  civilStartTime?: { date?: CivilDate }
  civilEndTime?: { date?: CivilDate }
}

export interface RollupPoint {
  civilStartTime?: { date?: CivilDate }
  civilEndTime?: { date?: CivilDate }
  steps?: { countSum?: string | number }
  distance?: { millimetersSum?: string | number }
  activeEnergyBurned?: { kcalSum?: string | number }
  activeMinutes?: {
    activeMinutesRollupByActivityLevel?: {
      activityLevel?: string
      activeMinutesSum?: string | number
    }[]
  }
}

export interface SleepPoint {
  sleep?: {
    type?: string
    interval?: Interval
    stages?: { startTime?: string; endTime?: string; type?: string }[]
    summary?: {
      minutesAsleep?: string | number
      minutesAwake?: string | number
      stagesSummary?: { type?: string; minutes?: string | number }[]
    }
  }
}

export interface SamplePoint {
  weight?: { sampleTime?: SampleTime; weightGrams?: number }
  height?: { sampleTime?: SampleTime; heightMillimeters?: string | number }
  bodyFat?: { sampleTime?: SampleTime; percentage?: number }
  heartRate?: { sampleTime?: SampleTime; beatsPerMinute?: string | number }
  oxygenSaturation?: { sampleTime?: SampleTime; percentage?: number }
  vo2Max?: { sampleTime?: SampleTime; vo2Max?: number }
}

export interface IntervalPoint {
  floors?: { interval?: Interval; count?: string | number }
}

export interface ExercisePoint {
  exercise?: {
    interval?: Interval
    exerciseType?: string
    displayName?: string
    activeDuration?: string
    metricsSummary?: {
      caloriesKcal?: number
      distanceMillimeters?: number
      averagePaceSecondsPerMeter?: number
    }
  }
}

export interface StepRow {
  date: string
  steps: number
}

export interface DailyValueRow {
  date: string
  value: number
}

export interface DailyActivityRow {
  date: string
  steps: number | null
  distanceM: number | null
  calories: number | null
}

export interface BodyRow {
  ts: number
  date: string
  weightKg?: number | null
  heightCm?: number | null
  fatRate?: number | null
}

export interface HeartRow {
  ts: number
  date: string
  tod: number
  bpm: number
}

export interface MetricRow {
  date: string
  metric: string
  value: number
}

export interface SportRow {
  startTs: number
  date: string
  type: number
  durationS: number | null
  distanceM: number | null
  calories: number | null
  avgPace: number | null
  label: string | null
}

export interface SleepRow {
  date: string
  startTs: number | null
  endTs: number | null
  deepMin: number | null
  lightMin: number | null
  remMin: number | null
  wakeMin: number | null
  naps: number
}

/** Códigos de deporte de Zepp para los tipos equivalentes de Google Health. */
const EXERCISE_TYPE_CODES: Record<string, number> = {
  BIKING: 4,
  OUTDOOR_BIKE: 4,
  INDOOR_BIKE: 5,
  ELLIPTICAL: 12,
  HIKING: 13,
  ROWING: 7,
  RUNNING: 1,
  STRENGTH_TRAINING: 17,
  FREE_WEIGHTS: 17,
  SWIMMING: 8,
  WALKING: 3,
  YOGA: 10,
}

function civilDate(iso: string) {
  const [year, month, day] = iso.split('-').map(Number)
  return { date: { year, month, day }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } }
}

function isoFromCivil(value: CivilDate | undefined): string | null {
  const year = value?.year
  const month = value?.month
  const day = value?.day
  if (!year || !month || !day) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toEpochSeconds(value: string | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null
}

function parseDurationSeconds(value: string | undefined): number | null {
  if (!value) return null
  const match = /^(-?\d+(?:\.\d+)?)s$/.exec(value.trim())
  return match ? Math.round(Number(match[1])) : null
}

function sampleInfo(sample: SampleTime | undefined): {
  ts: number | null
  date: string | null
  tod: number | null
} {
  const ts = toEpochSeconds(sample?.physicalTime)
  const date =
    isoFromCivil(sample?.civilTime?.date) ?? (ts != null ? localDateFromTs(ts) : null)
  const time = sample?.civilTime?.time
  const tod =
    time?.hours != null
      ? (time.hours ?? 0) * 3600 + (time.minutes ?? 0) * 60 + (time.seconds ?? 0)
      : ts != null
        ? timeOfDaySeconds(ts)
        : null
  return { ts, date, tod }
}

function intervalDate(interval: Interval | undefined): string | null {
  return (
    isoFromCivil(interval?.civilStartTime?.date) ??
    isoFromCivil(interval?.civilEndTime?.date) ??
    (() => {
      const ts = toEpochSeconds(interval?.startTime)
      return ts == null ? null : localDateFromTs(ts)
    })()
  )
}

function sortByDate<T extends { date: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** Suma los valores de un rollup diario agrupados por fecha civil. */
export function mapDailyRollup(
  points: RollupPoint[],
  pick: (point: RollupPoint) => number | null,
): DailyValueRow[] {
  const byDate = new Map<string, number>()
  for (const point of points) {
    const date = isoFromCivil(point.civilStartTime?.date) ?? isoFromCivil(point.civilEndTime?.date)
    const value = pick(point)
    if (!date || value == null) continue
    byDate.set(date, (byDate.get(date) ?? 0) + value)
  }
  return sortByDate([...byDate.entries()].map(([date, value]) => ({ date, value })))
}

/** Convierte un `dailyRollUp` de pasos en filas de `daily_activity`. */
export function mapStepsRollup(points: RollupPoint[]): StepRow[] {
  return mapDailyRollup(points, (point) => toNumber(point.steps?.countSum)).map((row) => ({
    date: row.date,
    steps: Math.round(row.value),
  }))
}

/** Convierte un `dailyRollUp` de distancia (milímetros) en metros. */
export function mapDistanceRollup(points: RollupPoint[]): DailyValueRow[] {
  return mapDailyRollup(points, (point) => toNumber(point.distance?.millimetersSum)).map(
    (row) => ({ date: row.date, value: row.value / 1000 }),
  )
}

/** Convierte un `dailyRollUp` de energía activa en kcal. */
export function mapEnergyRollup(points: RollupPoint[]): DailyValueRow[] {
  return mapDailyRollup(points, (point) => toNumber(point.activeEnergyBurned?.kcalSum))
}

/** Minutos activos por nivel (ligero, moderado, vigoroso). */
export function mapActiveMinutesRollup(points: RollupPoint[]): MetricRow[] {
  const byKey = new Map<string, MetricRow>()
  for (const point of points) {
    const date = isoFromCivil(point.civilStartTime?.date) ?? isoFromCivil(point.civilEndTime?.date)
    if (!date) continue
    for (const level of point.activeMinutes?.activeMinutesRollupByActivityLevel ?? []) {
      const minutes = toNumber(level.activeMinutesSum)
      const name = level.activityLevel?.toLowerCase()
      if (minutes == null || !name) continue
      const metric = `active_minutes_${name}`
      const key = `${date}|${metric}`
      const previous = byKey.get(key)
      byKey.set(key, { date, metric, value: (previous?.value ?? 0) + minutes })
    }
  }
  return [...byKey.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.metric < b.metric ? -1 : 1,
  )
}

/** Convierte puntos de peso en filas de `body_measurement`. */
export function mapWeightPoints(points: SamplePoint[]): BodyRow[] {
  const byTs = new Map<number, BodyRow>()
  for (const point of points) {
    const info = sampleInfo(point.weight?.sampleTime)
    const grams = toNumber(point.weight?.weightGrams)
    if (info.ts == null || !info.date || grams == null) continue
    byTs.set(info.ts, { ts: info.ts, date: info.date, weightKg: grams / 1000 })
  }
  return [...byTs.values()].sort((a, b) => a.ts - b.ts)
}

/** Convierte puntos de altura (milímetros) en centímetros. */
export function mapHeightPoints(points: SamplePoint[]): BodyRow[] {
  const byTs = new Map<number, BodyRow>()
  for (const point of points) {
    const info = sampleInfo(point.height?.sampleTime)
    const millimeters = toNumber(point.height?.heightMillimeters)
    if (info.ts == null || !info.date || millimeters == null) continue
    byTs.set(info.ts, { ts: info.ts, date: info.date, heightCm: millimeters / 10 })
  }
  return [...byTs.values()].sort((a, b) => a.ts - b.ts)
}

/** Convierte puntos de grasa corporal en porcentaje. */
export function mapBodyFatPoints(points: SamplePoint[]): BodyRow[] {
  const byTs = new Map<number, BodyRow>()
  for (const point of points) {
    const info = sampleInfo(point.bodyFat?.sampleTime)
    const percentage = toNumber(point.bodyFat?.percentage)
    if (info.ts == null || !info.date || percentage == null) continue
    byTs.set(info.ts, { ts: info.ts, date: info.date, fatRate: percentage })
  }
  return [...byTs.values()].sort((a, b) => a.ts - b.ts)
}

/** Convierte muestras de frecuencia cardiaca en filas de `heart_rate_auto`. */
export function mapHeartRatePoints(points: SamplePoint[]): HeartRow[] {
  const byTs = new Map<number, HeartRow>()
  for (const point of points) {
    const info = sampleInfo(point.heartRate?.sampleTime)
    const bpm = toNumber(point.heartRate?.beatsPerMinute)
    if (info.ts == null || !info.date || info.tod == null || bpm == null) continue
    if (bpm < 1 || bpm > 300) continue
    byTs.set(info.ts, { ts: info.ts, date: info.date, tod: info.tod, bpm: Math.round(bpm) })
  }
  return [...byTs.values()].sort((a, b) => a.ts - b.ts)
}

/** Suma los pisos subidos por día. */
export function mapFloorsPoints(points: IntervalPoint[]): DailyValueRow[] {
  const byDate = new Map<string, number>()
  for (const point of points) {
    const date = intervalDate(point.floors?.interval)
    const count = toNumber(point.floors?.count)
    if (!date || count == null) continue
    byDate.set(date, (byDate.get(date) ?? 0) + count)
  }
  return sortByDate([...byDate.entries()].map(([date, value]) => ({ date, value })))
}

/** Media diaria de oxígeno en sangre. */
export function mapOxygenPoints(points: SamplePoint[]): DailyValueRow[] {
  const sums = new Map<string, { total: number; count: number }>()
  for (const point of points) {
    const info = sampleInfo(point.oxygenSaturation?.sampleTime)
    const percentage = toNumber(point.oxygenSaturation?.percentage)
    if (!info.date || percentage == null) continue
    const bucket = sums.get(info.date) ?? { total: 0, count: 0 }
    bucket.total += percentage
    bucket.count += 1
    sums.set(info.date, bucket)
  }
  return sortByDate(
    [...sums.entries()].map(([date, bucket]) => ({ date, value: bucket.total / bucket.count })),
  )
}

/** Último VO2 máximo de cada día. */
export function mapVo2MaxPoints(points: SamplePoint[]): DailyValueRow[] {
  const byDate = new Map<string, { ts: number; value: number }>()
  for (const point of points) {
    const info = sampleInfo(point.vo2Max?.sampleTime)
    const value = toNumber(point.vo2Max?.vo2Max)
    if (info.ts == null || !info.date || value == null) continue
    const previous = byDate.get(info.date)
    if (!previous || info.ts >= previous.ts) byDate.set(info.date, { ts: info.ts, value })
  }
  return sortByDate([...byDate.entries()].map(([date, entry]) => ({ date, value: entry.value })))
}

/** Convierte sesiones de ejercicio en filas de `sport`. */
export function mapExercisePoints(points: ExercisePoint[]): SportRow[] {
  const byKey = new Map<string, SportRow>()
  for (const point of points) {
    const exercise = point.exercise
    if (!exercise) continue
    const startTs = toEpochSeconds(exercise.interval?.startTime)
    const date = intervalDate(exercise.interval)
    if (startTs == null || !date) continue
    const type = EXERCISE_TYPE_CODES[exercise.exerciseType ?? ''] ?? 999
    const duration =
      parseDurationSeconds(exercise.activeDuration) ??
      (() => {
        const end = toEpochSeconds(exercise.interval?.endTime)
        return end == null ? null : Math.max(0, end - startTs)
      })()
    const distance = toNumber(exercise.metricsSummary?.distanceMillimeters)
    const row: SportRow = {
      startTs,
      date,
      type,
      durationS: duration,
      distanceM: distance == null ? null : distance / 1000,
      calories: toNumber(exercise.metricsSummary?.caloriesKcal),
      avgPace: toNumber(exercise.metricsSummary?.averagePaceSecondsPerMeter),
      label: exercise.displayName?.trim() || exercise.exerciseType || null,
    }
    byKey.set(`${row.startTs}-${row.type}`, row)
  }
  return [...byKey.values()].sort((a, b) => a.startTs - b.startTs)
}

/** Convierte puntos de sueño en filas de `sleep_session`, una por noche. */
export function mapSleepPoints(points: SleepPoint[]): SleepRow[] {
  const byDate = new Map<string, SleepRow>()
  for (const point of points) {
    const sleep = point.sleep
    if (!sleep) continue
    // La fecha de la noche es la del despertar, igual que en el export de Zepp.
    // Algunas respuestas no traen hora civil: se usa la hora física convertida.
    const endTs = toEpochSeconds(sleep.interval?.endTime)
    const startTs = toEpochSeconds(sleep.interval?.startTime)
    const date =
      isoFromCivil(sleep.interval?.civilEndTime?.date) ??
      isoFromCivil(sleep.interval?.civilStartTime?.date) ??
      (endTs != null ? localDateFromTs(endTs) : startTs != null ? localDateFromTs(startTs) : null)
    if (!date) continue

    let deep: number | null = null
    let light: number | null = null
    let rem: number | null = null
    let wake: number | null = null

    for (const stage of sleep.summary?.stagesSummary ?? []) {
      const minutes = toNumber(stage.minutes)
      if (minutes == null) continue
      switch (stage.type) {
        case 'DEEP':
          deep = (deep ?? 0) + minutes
          break
        case 'LIGHT':
        case 'ASLEEP':
          light = (light ?? 0) + minutes
          break
        case 'REM':
          rem = (rem ?? 0) + minutes
          break
        case 'AWAKE':
        case 'RESTLESS':
          wake = (wake ?? 0) + minutes
          break
        default:
          break
      }
    }

    // Sin resumen por fases: se calculan las duraciones desde los tramos.
    if (deep == null && light == null && rem == null && sleep.stages?.length) {
      for (const stage of sleep.stages) {
        const start = toEpochSeconds(stage.startTime)
        const end = toEpochSeconds(stage.endTime)
        if (start == null || end == null || end <= start) continue
        const minutes = (end - start) / 60
        if (stage.type === 'DEEP') deep = (deep ?? 0) + minutes
        else if (stage.type === 'REM') rem = (rem ?? 0) + minutes
        else if (stage.type === 'AWAKE' || stage.type === 'RESTLESS') wake = (wake ?? 0) + minutes
        else light = (light ?? 0) + minutes
      }
    }

    if (deep == null && light == null && rem == null) {
      const asleep = toNumber(sleep.summary?.minutesAsleep)
      if (asleep != null) light = asleep
      wake = toNumber(sleep.summary?.minutesAwake) ?? wake
    }

    const candidate: SleepRow = {
      date,
      startTs,
      endTs,
      deepMin: deep == null ? null : Math.round(deep),
      lightMin: light == null ? null : Math.round(light),
      remMin: rem == null ? null : Math.round(rem),
      wakeMin: wake == null ? null : Math.round(wake),
      naps: 0,
    }

    // Si hay varias sesiones el mismo día, se queda la más larga (sueño principal).
    const previous = byDate.get(date)
    if (!previous || duration(candidate) > duration(previous)) byDate.set(date, candidate)
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

function duration(row: { startTs: number | null; endTs: number | null }): number {
  if (row.startTs == null || row.endTs == null) return 0
  return row.endTs - row.startTs
}

async function request(
  token: string,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  const text = await response.text()
  let data: Record<string, unknown> = {}
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    data = { raw: text }
  }
  if (!response.ok) {
    const error = data.error as { message?: string; status?: string } | undefined
    throw new Error(error?.message ?? `Google Health respondió HTTP ${response.status}`)
  }
  return data
}

async function fetchDailyRollup(
  token: string,
  dataType: string,
  range: SyncRange,
  phase: SyncPhase,
  label: string,
  onProgress?: (progress: SyncProgress) => void,
): Promise<RollupPoint[]> {
  const total = daysBetween(range.from, range.to) + 1
  const points: RollupPoint[] = []

  for (let offset = 0; offset < total; offset += ROLLUP_WINDOW_DAYS) {
    const windowFrom = addDays(range.from, offset)
    const windowTo = addDays(windowFrom, Math.min(ROLLUP_WINDOW_DAYS, total - offset) - 1)
    onProgress?.({ phase, label: `${label} ${windowFrom} → ${windowTo}` })
    const data = await request(token, `/users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`, {
      method: 'POST',
      body: {
        range: { start: civilDate(windowFrom), end: civilDate(addDays(windowTo, 1)) },
        windowSizeDays: 1,
      },
    })
    points.push(...((data.rollupDataPoints as RollupPoint[] | undefined) ?? []))
  }

  return points
}

/** Filtro por hora física (RFC 3339) con un día de margen a cada lado. */
function physicalFilter(field: string, range: SyncRange): string {
  const from = addDays(range.from, -1)
  const to = addDays(range.to, 2)
  return `${field} >= "${from}T00:00:00Z" AND ${field} < "${to}T00:00:00Z"`
}

/** Filtro por fecha civil. */
function civilFilter(field: string, range: SyncRange): string {
  return `${field} >= "${range.from}" AND ${field} < "${addDays(range.to, 1)}"`
}

async function fetchListPoints<T>(
  token: string,
  dataType: string,
  filter: string,
  phase: SyncPhase,
  label: string,
  onProgress?: (progress: SyncProgress) => void,
): Promise<T[]> {
  onProgress?.({ phase, label })
  const collected: T[] = []
  let pageToken: string | undefined

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ pageSize: String(SAMPLE_PAGE_SIZE), filter })
    if (pageToken) query.set('pageToken', pageToken)
    const data = await request(
      token,
      `/users/me/dataTypes/${dataType}/dataPoints?${query.toString()}`,
      { method: 'GET' },
    )
    const points = (data.dataPoints as T[] | undefined) ?? []
    collected.push(...points)
    pageToken = typeof data.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : undefined
    if (!pageToken || !points.length) break
  }

  return collected
}

async function fetchReconcilePoints<T>(
  token: string,
  dataType: string,
  filter: string,
  phase: SyncPhase,
  label: string,
  onProgress?: (progress: SyncProgress) => void,
): Promise<T[]> {
  onProgress?.({ phase, label })
  const collected: T[] = []
  let pageToken: string | undefined

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ pageSize: String(SESSION_PAGE_SIZE), filter })
    if (pageToken) query.set('pageToken', pageToken)
    const data = await request(
      token,
      `/users/me/dataTypes/${dataType}/dataPoints:reconcile?${query.toString()}`,
      { method: 'GET' },
    )
    const points = (data.dataPoints as T[] | undefined) ?? []
    collected.push(...points)
    pageToken = typeof data.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : undefined
    if (!pageToken || !points.length) break
  }

  return collected
}

async function attempt<T>(
  label: string,
  warnings: string[],
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    warnings.push(`No se pudo sincronizar ${label}: ${message}`)
    return null
  }
}

function inRange(date: string, range: SyncRange): boolean {
  return date >= range.from && date <= range.to
}

/**
 * Sincroniza todos los tipos soportados en el rango indicado. Solo rellena
 * huecos: lo que ya existe (normalmente de Zepp) no se toca.
 */
export async function syncGoogleHealth(
  store: HealthStore,
  token: string,
  range: SyncRange,
  onProgress?: (progress: SyncProgress) => void,
): Promise<SyncResult> {
  const warnings: string[] = []

  // 1. Red: rollups diarios de actividad.
  const stepPoints =
    (await attempt('los pasos', warnings, () =>
      fetchDailyRollup(token, 'steps', range, 'steps', 'Pasos', onProgress),
    )) ?? []
  const distancePoints =
    (await attempt('la distancia', warnings, () =>
      fetchDailyRollup(token, 'distance', range, 'steps', 'Distancia', onProgress),
    )) ?? []
  const energyPoints =
    (await attempt('las calorías activas', warnings, () =>
      fetchDailyRollup(token, 'active-energy-burned', range, 'steps', 'Calorías', onProgress),
    )) ?? []
  const activeMinutesPoints =
    (await attempt('los minutos activos', warnings, () =>
      fetchDailyRollup(token, 'active-minutes', range, 'extras', 'Minutos activos', onProgress),
    )) ?? []

  // 2. Red: medidas corporales y frecuencia cardiaca.
  const weightPoints =
    (await attempt('el peso', warnings, () =>
      fetchListPoints<SamplePoint>(
        token,
        'weight',
        physicalFilter('weight.sample_time.physical_time', range),
        'body',
        'Peso',
        onProgress,
      ),
    )) ?? []
  const heightPoints =
    (await attempt('la altura', warnings, () =>
      fetchListPoints<SamplePoint>(
        token,
        'height',
        physicalFilter('height.sample_time.physical_time', range),
        'body',
        'Altura',
        onProgress,
      ),
    )) ?? []
  const bodyFatPoints =
    (await attempt('la grasa corporal', warnings, () =>
      fetchListPoints<SamplePoint>(
        token,
        'body-fat',
        physicalFilter('body_fat.sample_time.physical_time', range),
        'body',
        'Grasa corporal',
        onProgress,
      ),
    )) ?? []
  const heartPoints =
    (await attempt('la frecuencia cardiaca', warnings, () =>
      fetchListPoints<SamplePoint>(
        token,
        'heart-rate',
        physicalFilter('heart_rate.sample_time.physical_time', range),
        'heart',
        'Frecuencia cardiaca',
        onProgress,
      ),
    )) ?? []

  // 3. Red: sueño y entrenamientos.
  const sleepPoints =
    (await attempt('el sueño', warnings, () =>
      fetchReconcilePoints<SleepPoint>(
        token,
        'sleep',
        civilFilter('sleep.interval.civil_end_time', range),
        'sleep',
        `Sueño desde ${range.from}`,
        onProgress,
      ),
    )) ?? []
  const exercisePoints =
    (await attempt('los entrenamientos', warnings, () =>
      fetchReconcilePoints<ExercisePoint>(
        token,
        'exercise',
        civilFilter('exercise.interval.civil_start_time', range),
        'exercise',
        'Entrenamientos',
        onProgress,
      ),
    )) ?? []

  // 4. Red: métricas que no tienen columna propia.
  const floorsPoints =
    (await attempt('los pisos', warnings, () =>
      fetchReconcilePoints<IntervalPoint>(
        token,
        'floors',
        civilFilter('floors.interval.civil_start_time', range),
        'extras',
        'Pisos',
        onProgress,
      ),
    )) ?? []
  const oxygenPoints =
    (await attempt('el oxígeno en sangre', warnings, () =>
      fetchListPoints<SamplePoint>(
        token,
        'oxygen-saturation',
        physicalFilter('oxygen_saturation.sample_time.physical_time', range),
        'extras',
        'Oxígeno en sangre',
        onProgress,
      ),
    )) ?? []
  const vo2Points =
    (await attempt('el VO2 máximo', warnings, () =>
      fetchListPoints<SamplePoint>(
        token,
        'vo2-max',
        physicalFilter('vo2_max.sample_time.physical_time', range),
        'extras',
        'VO2 máximo',
        onProgress,
      ),
    )) ?? []

  // 5. Normalización y filtro por el rango civil elegido.
  const stepRows = mapStepsRollup(stepPoints).filter((row) => inRange(row.date, range))
  const distanceRows = mapDistanceRollup(distancePoints).filter((row) => inRange(row.date, range))
  const energyRows = mapEnergyRollup(energyPoints).filter((row) => inRange(row.date, range))
  const activeMinutesRows = mapActiveMinutesRollup(activeMinutesPoints).filter((row) =>
    inRange(row.date, range),
  )
  const weightRows = mapWeightPoints(weightPoints).filter((row) => inRange(row.date, range))
  const heightRows = mapHeightPoints(heightPoints).filter((row) => inRange(row.date, range))
  const bodyFatRows = mapBodyFatPoints(bodyFatPoints).filter((row) => inRange(row.date, range))
  const heartRows = mapHeartRatePoints(heartPoints).filter((row) => inRange(row.date, range))
  const sleepRows = mapSleepPoints(
    sleepPoints.filter((point) => {
      const date =
        isoFromCivil(point.sleep?.interval?.civilEndTime?.date) ??
        isoFromCivil(point.sleep?.interval?.civilStartTime?.date)
      return date != null && inRange(date, range)
    }),
  )
  const exerciseRows = mapExercisePoints(exercisePoints).filter((row) => inRange(row.date, range))
  const floorsRows = mapFloorsPoints(floorsPoints).filter((row) => inRange(row.date, range))
  const oxygenRows = mapOxygenPoints(oxygenPoints).filter((row) => inRange(row.date, range))
  const vo2Rows = mapVo2MaxPoints(vo2Points).filter((row) => inRange(row.date, range))

  // 6. Actividad diaria: mezcla pasos, distancia y calorías por fecha.
  const activityByDate = new Map<string, DailyActivityRow>()
  const activityRow = (date: string) => {
    let row = activityByDate.get(date)
    if (!row) {
      row = { date, steps: null, distanceM: null, calories: null }
      activityByDate.set(date, row)
    }
    return row
  }
  for (const row of stepRows) activityRow(row.date).steps = row.steps
  for (const row of distanceRows) activityRow(row.date).distanceM = row.value
  for (const row of energyRows) activityRow(row.date).calories = row.value
  const activityRows = sortByDate([...activityByDate.values()])

  const existingActivity = new Map(
    store.getDailyActivity(range.from, range.to).map((row) => [row.date, row]),
  )
  const activityInserts: DailyActivityRow[] = []
  const activityUpdates: DailyActivityRow[] = []
  let stepsAdded = 0
  let distanceAdded = 0
  let caloriesAdded = 0

  for (const row of activityRows) {
    const existing = existingActivity.get(row.date)
    if (!existing) {
      activityInserts.push(row)
      if (row.steps != null) stepsAdded += 1
      if (row.distanceM != null) distanceAdded += 1
      if (row.calories != null) caloriesAdded += 1
      continue
    }
    // Zepp manda: una fila de Zepp no se completa con datos de Google.
    if (existing.source !== 'google') continue
    if (existing.steps == null && row.steps != null) stepsAdded += 1
    if (existing.distanceM == null && row.distanceM != null) distanceAdded += 1
    if (existing.calories == null && row.calories != null) caloriesAdded += 1
    if (
      (existing.steps == null && row.steps != null) ||
      (existing.distanceM == null && row.distanceM != null) ||
      (existing.calories == null && row.calories != null)
    ) {
      activityUpdates.push(row)
    }
  }

  // 7. Medidas corporales: se respeta cada métrica por separado y por fecha.
  const existingBody = store.getBodyMeasurements(100_000, range.from, range.to)
  const existingWeightDates = new Set(
    existingBody.filter((row) => row.weightKg != null).map((row) => row.date),
  )
  const existingHeightDates = new Set(
    existingBody.filter((row) => row.heightCm != null).map((row) => row.date),
  )
  const existingFatDates = new Set(
    existingBody.filter((row) => row.fatRate != null).map((row) => row.date),
  )
  const freshWeight = weightRows.filter((row) => !existingWeightDates.has(row.date))
  const freshHeight = heightRows.filter((row) => !existingHeightDates.has(row.date))
  const freshFat = bodyFatRows.filter((row) => !existingFatDates.has(row.date))
  const bodyByTs = new Map<number, BodyRow>()
  for (const row of [...freshWeight, ...freshHeight, ...freshFat]) {
    const previous = bodyByTs.get(row.ts)
    bodyByTs.set(row.ts, {
      ts: row.ts,
      date: row.date,
      weightKg: row.weightKg ?? previous?.weightKg ?? null,
      heightCm: row.heightCm ?? previous?.heightCm ?? null,
      fatRate: row.fatRate ?? previous?.fatRate ?? null,
    })
  }
  const bodyRows = [...bodyByTs.values()].sort((a, b) => a.ts - b.ts)

  // 8. Métricas diarias extra.
  const metricRows: MetricRow[] = [
    ...activeMinutesRows,
    ...floorsRows.map((row) => ({ date: row.date, metric: 'floors', value: row.value })),
    ...oxygenRows.map((row) => ({ date: row.date, metric: 'oxygen_saturation', value: row.value })),
    ...vo2Rows.map((row) => ({ date: row.date, metric: 'vo2_max', value: row.value })),
  ]
  const existingMetrics = new Set(
    store.getDailyMetrics(range.from, range.to).map((row) => `${row.date}|${row.metric}`),
  )
  const freshMetrics = metricRows.filter((row) => !existingMetrics.has(`${row.date}|${row.metric}`))

  // 9. Sueño y entrenamientos: solo fechas/sesiones nuevas.
  const existingSleep = new Set(store.getSleepNights(range.from, range.to).map((row) => row.date))
  const freshSleep = sleepRows.filter((row) => !existingSleep.has(row.date))

  // 10. Escritura en una única transacción.
  let heartAdded = 0
  let sleepAdded = 0
  let exerciseAdded = 0

  store.transaction(() => {
    if (activityInserts.length) {
      store.insertBatch(
        'daily_activity',
        ['date', 'steps', 'distance_m', 'calories', 'source'],
        activityInserts.map((row) => [row.date, row.steps, row.distanceM, row.calories, 'google']),
        'ignore',
      )
    }
    for (const row of activityUpdates) {
      store.fillGoogleDailyActivity(row.date, {
        steps: row.steps,
        distanceM: row.distanceM,
        calories: row.calories,
      })
    }
    if (bodyRows.length) {
      store.insertBatch(
        'body_measurement',
        ['ts', 'date', 'weight_kg', 'height_cm', 'fat_rate', 'source'],
        bodyRows.map((row) => [
          row.ts,
          row.date,
          row.weightKg ?? null,
          row.heightCm ?? null,
          row.fatRate ?? null,
          'google',
        ]),
        'ignore',
      )
    }
    if (heartRows.length) {
      heartAdded = store.insertBatch(
        'heart_rate_auto',
        ['ts', 'date', 'tod', 'bpm', 'source'],
        heartRows.map((row) => [row.ts, row.date, row.tod, row.bpm, 'google']),
        'ignore',
      )
    }
    if (freshSleep.length) {
      sleepAdded = store.insertBatch(
        'sleep_session',
        ['date', 'start_ts', 'end_ts', 'deep_min', 'light_min', 'rem_min', 'wake_min', 'naps', 'source'],
        freshSleep.map((row) => [
          row.date,
          row.startTs,
          row.endTs,
          row.deepMin,
          row.lightMin,
          row.remMin,
          row.wakeMin,
          row.naps,
          'google',
        ]),
        'ignore',
      )
    }
    if (exerciseRows.length) {
      exerciseAdded = store.insertBatch(
        'sport',
        [
          'start_ts',
          'type',
          'date',
          'duration_s',
          'distance_m',
          'calories',
          'avg_pace',
          'label',
          'source',
        ],
        exerciseRows.map((row) => [
          row.startTs,
          row.type,
          row.date,
          row.durationS,
          row.distanceM,
          row.calories,
          row.avgPace,
          row.label,
          'google',
        ]),
        'ignore',
      )
    }
    if (freshMetrics.length) {
      store.insertBatch(
        'daily_metric',
        ['date', 'metric', 'value', 'source'],
        freshMetrics.map((row) => [row.date, row.metric, row.value, 'google']),
        'ignore',
      )
    }
  })

  const activeMinutesDates = new Set(activeMinutesRows.map((row) => row.date))
  const addedActiveMinutesDates = new Set(
    freshMetrics.filter((row) => row.metric.startsWith('active_minutes_')).map((row) => row.date),
  )
  const freshFloors = floorsRows.filter((row) => !existingMetrics.has(`${row.date}|floors`)).length
  const freshOxygen = oxygenRows.filter(
    (row) => !existingMetrics.has(`${row.date}|oxygen_saturation`),
  ).length
  const freshVo2 = vo2Rows.filter((row) => !existingMetrics.has(`${row.date}|vo2_max`)).length

  const categories: SyncCategoryResult[] = [
    { key: 'steps', label: 'pasos', received: stepRows.length, added: stepsAdded },
    { key: 'distance', label: 'distancia', received: distanceRows.length, added: distanceAdded },
    { key: 'calories', label: 'calorías activas', received: energyRows.length, added: caloriesAdded },
    { key: 'weight', label: 'peso', received: weightRows.length, added: freshWeight.length },
    { key: 'height', label: 'altura', received: heightRows.length, added: freshHeight.length },
    { key: 'body-fat', label: 'grasa corporal', received: bodyFatRows.length, added: freshFat.length },
    { key: 'heart-rate', label: 'frecuencia cardiaca', received: heartRows.length, added: heartAdded },
    { key: 'sleep', label: 'sueño', received: sleepRows.length, added: sleepAdded },
    { key: 'exercise', label: 'entrenamientos', received: exerciseRows.length, added: exerciseAdded },
    {
      key: 'active-minutes',
      label: 'minutos activos',
      received: activeMinutesDates.size,
      added: addedActiveMinutesDates.size,
    },
    { key: 'floors', label: 'pisos', received: floorsRows.length, added: freshFloors },
    { key: 'oxygen', label: 'oxígeno en sangre', received: oxygenRows.length, added: freshOxygen },
    { key: 'vo2-max', label: 'VO2 máximo', received: vo2Rows.length, added: freshVo2 },
  ]

  const result: SyncResult = { categories, warnings }
  const totalAdded = categories.reduce((total, row) => total + row.added, 0)
  if (totalAdded === 0) {
    result.warnings.push('No había huecos que rellenar: los datos de Zepp tienen prioridad.')
  }
  return result
}

/**
 * Sincronización con Google Health.
 *
 * Escribe solo huecos: todas las inserciones usan `INSERT OR IGNORE`, así que
 * los datos de Zepp (fuente principal) nunca se sobrescriben.
 *
 * Tipos soportados hoy: pasos diarios y sesiones de sueño. Ambos endpoints están
 * validados contra la API real. El resto de tipos se añadirá cuando se confirme
 * su forma de respuesta.
 */

import type { HealthStore, SqlValue } from '../db/store'
import { addDays, daysBetween } from '../lib/date'

const API_BASE = 'https://health.googleapis.com/v4'

/** La API limita los rollups a 90 días; se pide en tramos más pequeños. */
const STEP_WINDOW_DAYS = 30

/** `sleep`/`exercise` tienen un máximo de 25 puntos por página. */
const SLEEP_PAGE_SIZE = 25
const SLEEP_MAX_PAGES = 60

export interface SyncRange {
  from: string
  to: string
}

export interface SyncResult {
  /** Días con pasos devueltos por la API. */
  stepDays: number
  /** Días de pasos añadidos a la base (los que ya existían se respetan). */
  stepsAdded: number
  /** Noches devueltas por la API. */
  sleepNights: number
  /** Noches añadidas a la base. */
  sleepAdded: number
  warnings: string[]
}

export interface SyncProgress {
  phase: 'steps' | 'sleep'
  label: string
}

interface CivilDate {
  year?: number
  month?: number
  day?: number
}

export interface RollupPoint {
  civilStartTime?: { date?: CivilDate }
  civilEndTime?: { date?: CivilDate }
  steps?: { countSum?: string | number }
}

export interface SleepPoint {
  sleep?: {
    type?: string
    interval?: {
      startTime?: string
      endTime?: string
      civilStartTime?: { date?: CivilDate }
      civilEndTime?: { date?: CivilDate }
    }
    stages?: { startTime?: string; endTime?: string; type?: string }[]
    summary?: {
      minutesAsleep?: string | number
      minutesAwake?: string | number
      stagesSummary?: { type?: string; minutes?: string | number }[]
    }
  }
}

export interface StepRow {
  date: string
  steps: number
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

/** Convierte un `dailyRollUp` de pasos en filas de `daily_activity`. */
export function mapStepsRollup(points: RollupPoint[]): StepRow[] {
  const byDate = new Map<string, number>()
  for (const point of points) {
    const date = isoFromCivil(point.civilStartTime?.date) ?? isoFromCivil(point.civilEndTime?.date)
    const steps = toNumber(point.steps?.countSum)
    if (!date || steps == null) continue
    byDate.set(date, (byDate.get(date) ?? 0) + Math.round(steps))
  }
  return [...byDate.entries()]
    .map(([date, steps]) => ({ date, steps }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
}

/** Convierte puntos de sueño en filas de `sleep_session`, una por noche. */
export function mapSleepPoints(points: SleepPoint[]): SleepRow[] {
  const byDate = new Map<string, SleepRow>()
  for (const point of points) {
    const sleep = point.sleep
    if (!sleep) continue
    // La fecha de la noche es la del despertar, igual que en el export de Zepp.
    const date =
      isoFromCivil(sleep.interval?.civilEndTime?.date) ?? isoFromCivil(sleep.interval?.civilStartTime?.date)
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
      startTs: toEpochSeconds(sleep.interval?.startTime),
      endTs: toEpochSeconds(sleep.interval?.endTime),
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

async function fetchSteps(
  token: string,
  range: SyncRange,
  onProgress?: (progress: SyncProgress) => void,
): Promise<StepRow[]> {
  const total = daysBetween(range.from, range.to) + 1
  const rows: StepRow[] = []

  for (let offset = 0; offset < total; offset += STEP_WINDOW_DAYS) {
    const windowFrom = addDays(range.from, offset)
    const windowTo = addDays(windowFrom, Math.min(STEP_WINDOW_DAYS, total - offset) - 1)
    onProgress?.({ phase: 'steps', label: `Pasos ${windowFrom} → ${windowTo}` })
    const data = await request(token, '/users/me/dataTypes/steps/dataPoints:dailyRollUp', {
      method: 'POST',
      body: {
        range: { start: civilDate(windowFrom), end: civilDate(addDays(windowTo, 1)) },
        windowSizeDays: 1,
      },
    })
    rows.push(...mapStepsRollup((data.rollupDataPoints as RollupPoint[] | undefined) ?? []))
  }

  return rows
}

async function fetchSleep(
  token: string,
  range: SyncRange,
  onProgress?: (progress: SyncProgress) => void,
): Promise<SleepPoint[]> {
  onProgress?.({ phase: 'sleep', label: `Sueño desde ${range.from}` })
  // `URLSearchParams` ya codifica: el filtro va en crudo.
  const filter = `sleep.interval.civil_end_time >= "${range.from}"`
  const collected: SleepPoint[] = []
  let pageToken: string | undefined

  for (let page = 0; page < SLEEP_MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ pageSize: String(SLEEP_PAGE_SIZE), filter })
    if (pageToken) query.set('pageToken', pageToken)
    const data = await request(
      token,
      `/users/me/dataTypes/sleep/dataPoints:reconcile?${query.toString()}`,
      { method: 'GET' },
    )
    const points = (data.dataPoints as SleepPoint[] | undefined) ?? []
    collected.push(...points)
    pageToken = typeof data.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : undefined
    if (!pageToken || !points.length) break
  }

  return collected
}

/**
 * Sincroniza pasos y sueño en el rango indicado. Solo rellena huecos: lo que ya
 * existe (normalmente de Zepp) no se toca.
 */
export async function syncGoogleHealth(
  store: HealthStore,
  token: string,
  range: SyncRange,
  onProgress?: (progress: SyncProgress) => void,
): Promise<SyncResult> {
  // Primero la red (sin bloquear la base) y después una única transacción.
  const stepRows = await fetchSteps(token, range, onProgress)
  const sleepPoints = await fetchSleep(token, range, onProgress)

  const sleepRows = mapSleepPoints(
    sleepPoints.filter((point) => {
      const date =
        isoFromCivil(point.sleep?.interval?.civilEndTime?.date) ??
        isoFromCivil(point.sleep?.interval?.civilStartTime?.date)
      return date != null && date >= range.from && date <= range.to
    }),
  )

  const existingSteps = new Set(store.getDailyActivity(range.from, range.to).map((row) => row.date))
  const existingSleep = new Set(store.getSleepNights(range.from, range.to).map((row) => row.date))
  const freshSteps = stepRows.filter((row) => !existingSteps.has(row.date))
  const freshSleep = sleepRows.filter((row) => !existingSleep.has(row.date))

  if (freshSteps.length || freshSleep.length) {
    store.transaction(() => {
      if (freshSteps.length) {
        const values: SqlValue[][] = freshSteps.map((row) => [row.date, row.steps, 'google'])
        store.insertBatch('daily_activity', ['date', 'steps', 'source'], values, 'ignore')
      }
      if (freshSleep.length) {
        const values: SqlValue[][] = freshSleep.map((row) => [
          row.date,
          row.startTs,
          row.endTs,
          row.deepMin,
          row.lightMin,
          row.remMin,
          row.wakeMin,
          row.naps,
          'google',
        ])
        store.insertBatch(
          'sleep_session',
          ['date', 'start_ts', 'end_ts', 'deep_min', 'light_min', 'rem_min', 'wake_min', 'naps', 'source'],
          values,
          'ignore',
        )
      }
    })
  }

  const result: SyncResult = {
    stepDays: stepRows.length,
    stepsAdded: freshSteps.length,
    sleepNights: sleepRows.length,
    sleepAdded: freshSleep.length,
    warnings: [],
  }
  if (!freshSteps.length && !freshSleep.length) {
    result.warnings.push('No había huecos que rellenar: los datos de Zepp tienen prioridad.')
  }
  return result
}

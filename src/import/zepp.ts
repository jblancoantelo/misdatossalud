import JSZip from 'jszip'
import Papa from 'papaparse'
import type { HealthStore, SqlValue } from '../db/store'
import { localDateFromTs, timeOfDaySeconds } from '../lib/date'

export interface ImportProgress {
  phase: 'open' | 'read' | 'insert' | 'done'
  file?: string
  fileIndex?: number
  fileCount?: number
  rows: number
}

export interface ImportResult {
  files: Record<string, number>
  rows: Record<string, number>
  totalRows: number
  warnings: string[]
  importedAt: string
}

type Row = Record<string, string>

const TABLE_BY_FOLDER: Record<string, string> = {
  ACTIVITY: 'daily_activity',
  ACTIVITY_MINUTE: 'minute_activity',
  ACTIVITY_STAGE: 'activity_stage',
  BODY: 'body_measurement',
  HEALTH_DATA: 'body_circumference',
  HEARTRATE: 'heart_rate',
  HEARTRATE_AUTO: 'heart_rate_auto',
  SLEEP: 'sleep_session',
  SLEEP_MINUTE: 'sleep_minute',
  SPORT: 'sport',
  USER: 'profile',
}

/** Convierte los números del CSV; devuelve null para vacíos, "null" y NaN. */
export function toNumber(value: string | undefined | null): number | null {
  if (value == null) return null
  const text = value.trim()
  if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'nan') return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

export function toInt(value: string | undefined | null): number | null {
  const parsed = toNumber(value)
  return parsed == null ? null : Math.round(parsed)
}

export function toText(value: string | undefined | null): string | null {
  if (value == null) return null
  const text = value.trim()
  return text && text.toLowerCase() !== 'null' ? text : null
}

const ZEPP_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\s*([+-])(\d{2}):?(\d{2}))?$/

/**
 * Convierte `2020-01-01 01:39:00+0000` a epoch en segundos.
 * Zepp exporta estos instantes en UTC; si falta el desfase se asume UTC.
 */
export function parseZeppTimestamp(value: string | undefined | null): number | null {
  if (!value) return null
  const match = ZEPP_TIMESTAMP.exec(value.trim())
  if (!match) return null
  const [, y, mo, d, h, mi, s, sign, offH, offM] = match
  const utc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0),
  )
  if (!sign) return Math.floor(utc / 1000)
  const offsetMinutes = Number(offH) * 60 + Number(offM)
  const offsetMs = (sign === '-' ? -offsetMinutes : offsetMinutes) * 60_000
  return Math.floor((utc - offsetMs) / 1000)
}

/** Convierte una fecha y hora locales de Zepp (`date` + `time`) a epoch. */
export function parseLocalDateTime(date: string, time: string): number | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  const timeMatch = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(time.trim())
  if (!dateMatch || !timeMatch) return null
  const [, y, mo, d] = dateMatch
  const [, h, mi, s] = timeMatch
  // Date normaliza horas >= 24 (algunos exports traen 25:54 en vez de 01:54 del día siguiente).
  const local = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0),
  )
  if (Number.isNaN(local.getTime())) return null
  return Math.floor(local.getTime() / 1000)
}

function pick(row: Row, ...names: string[]): string | undefined {
  for (const name of names) {
    if (name in row) return row[name]
  }
  return undefined
}

function isBlank(row: Row): boolean {
  for (const key of Object.keys(row)) {
    const value = row[key]
    if (value != null && String(value).trim() !== '') return false
  }
  return true
}

interface ParsedFile {
  table: string
  rows: SqlValue[][]
  profile?: Row
  skipped: number
}

function parseFile(table: string, text: string, warnings: string[]): ParsedFile {
  const rows: SqlValue[][] = []
  let skipped = 0
  let seen = 0

  const parsed = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
    step: (results) => {
      const row = results.data
      if (!row || isBlank(row)) return
      seen += 1
      const mapped = mapRow(table, row)
      if (mapped === null) {
        skipped += 1
        return
      }
      if (mapped === 'profile') return
      rows.push(mapped)
    },
  })

  if (seen === 0 && parsed.errors.length) {
    warnings.push(`${table}: ${parsed.errors[0]?.message ?? 'CSV ilegible'}`)
  }
  if (skipped > 0) {
    warnings.push(`${table}: ${skipped} filas descartadas por datos inválidos`)
  }
  return { table, rows, skipped }
}

/** Devuelve la fila lista para insertar, null si no es válida o 'profile'. */
function mapRow(table: string, row: Row): SqlValue[] | null | 'profile' {
  switch (table) {
    case 'daily_activity': {
      const date = toText(pick(row, 'date'))
      if (!date) return null
      return [
        date,
        toInt(pick(row, 'steps')),
        toNumber(pick(row, 'distance')),
        toNumber(pick(row, 'runDistance')),
        toNumber(pick(row, 'calories')),
      ]
    }
    case 'minute_activity': {
      const date = toText(pick(row, 'date'))
      const time = toText(pick(row, 'time'))
      if (!date || !time) return null
      const ts = parseLocalDateTime(date, time)
      if (ts == null) return null
      return [ts, localDateFromTs(ts), timeOfDaySeconds(ts), toInt(pick(row, 'steps'))]
    }
    case 'activity_stage': {
      const date = toText(pick(row, 'date'))
      const start = toText(pick(row, 'start'))
      if (!date || !start) return null
      const startTs = parseLocalDateTime(date, start)
      if (startTs == null) return null
      const stop = toText(pick(row, 'stop'))
      let endTs = stop ? parseLocalDateTime(date, stop) : null
      // Un tramo que termina después de medianoche viene con una hora menor.
      if (endTs != null && endTs < startTs) endTs += 86_400
      return [
        startTs,
        localDateFromTs(startTs),
        endTs,
        toNumber(pick(row, 'distance')),
        toNumber(pick(row, 'calories')),
        toInt(pick(row, 'steps')),
      ]
    }
    case 'body_measurement': {
      const ts = parseZeppTimestamp(toText(pick(row, 'time')))
      if (ts == null) return null
      return [
        ts,
        localDateFromTs(ts),
        toNumber(pick(row, 'weight')),
        toNumber(pick(row, 'height')),
        toNumber(pick(row, 'bmi')),
        toNumber(pick(row, 'fatRate')),
        toNumber(pick(row, 'bodyWaterRate')),
        toNumber(pick(row, 'boneMass')),
        toNumber(pick(row, 'metabolism')),
        toNumber(pick(row, 'muscleRate')),
        toNumber(pick(row, 'visceralFat')),
      ]
    }
    case 'body_circumference': {
      const date = toText(pick(row, 'date'))
      const time = toText(pick(row, 'time')) ?? '00:00'
      if (!date) return null
      const ts = parseLocalDateTime(date, time)
      if (ts == null) return null
      return [
        ts,
        localDateFromTs(ts),
        toNumber(pick(row, 'arm')),
        toNumber(pick(row, 'calf')),
        toNumber(pick(row, 'chest')),
        toNumber(pick(row, 'hip')),
        toNumber(pick(row, 'thigh')),
        toNumber(pick(row, 'waist')),
      ]
    }
    case 'heart_rate':
    case 'heart_rate_auto': {
      const bpm = toInt(pick(row, 'heartRate', 'bpm'))
      if (bpm == null || bpm <= 0) return null
      const date = toText(pick(row, 'date'))
      const time = toText(pick(row, 'time'))
      let ts: number | null
      if (date && time) {
        ts = parseLocalDateTime(date, time)
      } else {
        ts = parseZeppTimestamp(time ?? date)
      }
      if (ts == null) return null
      return [ts, localDateFromTs(ts), timeOfDaySeconds(ts), bpm]
    }
    case 'sleep_session': {
      const date = toText(pick(row, 'date'))
      if (!date) return null
      const startTs = parseZeppTimestamp(toText(pick(row, 'start')))
      const endTs = parseZeppTimestamp(toText(pick(row, 'stop')))
      return [
        date,
        startTs,
        endTs,
        toInt(pick(row, 'deepSleepTime')),
        toInt(pick(row, 'shallowSleepTime')),
        toInt(pick(row, 'REMTime', 'remTime')),
        toInt(pick(row, 'wakeTime')),
        toInt(pick(row, 'naps')),
      ]
    }
    case 'sleep_minute': {
      const date = toText(pick(row, 'date'))
      const time = toText(pick(row, 'time'))
      if (!date || !time) return null
      const ts = parseLocalDateTime(date, time)
      if (ts == null) return null
      const stage = toText(pick(row, 'stage'))
      const bpm = toInt(pick(row, 'hr'))
      const respiratory = toNumber(pick(row, 'respiratory_rate', 'respiratoryRate'))
      if (!stage && bpm == null && respiratory == null) return null
      return [ts, localDateFromTs(ts), timeOfDaySeconds(ts), stage, bpm, respiratory]
    }
    case 'sport': {
      const startTs = parseZeppTimestamp(toText(pick(row, 'startTime')))
      const type = toInt(pick(row, 'type'))
      if (startTs == null || type == null) return null
      return [
        startTs,
        type,
        localDateFromTs(startTs),
        toInt(pick(row, 'sportTime(s)', 'sportTime')),
        toNumber(pick(row, 'distance(m)', 'distance')),
        toNumber(pick(row, 'calories(kcal)', 'calories')),
        toNumber(pick(row, 'avgPace(/meter)', 'avgPace')),
        toNumber(pick(row, 'maxPace(/meter)', 'maxPace')),
        toNumber(pick(row, 'minPace(/meter)', 'minPace')),
      ]
    }
    case 'profile':
      return 'profile'
    default:
      return null
  }
}

const COLUMNS: Record<string, string[]> = {
  daily_activity: ['date', 'steps', 'distance_m', 'run_distance_m', 'calories'],
  minute_activity: ['ts', 'date', 'tod', 'steps'],
  activity_stage: ['start_ts', 'date', 'end_ts', 'distance_m', 'calories', 'steps'],
  body_measurement: [
    'ts',
    'date',
    'weight_kg',
    'height_cm',
    'bmi',
    'fat_rate',
    'body_water_rate',
    'bone_mass_kg',
    'metabolism',
    'muscle_rate',
    'visceral_fat',
  ],
  body_circumference: ['ts', 'date', 'arm_cm', 'calf_cm', 'chest_cm', 'hip_cm', 'thigh_cm', 'waist_cm'],
  heart_rate: ['ts', 'date', 'tod', 'bpm'],
  heart_rate_auto: ['ts', 'date', 'tod', 'bpm'],
  sleep_session: ['date', 'start_ts', 'end_ts', 'deep_min', 'light_min', 'rem_min', 'wake_min', 'naps'],
  sleep_minute: ['ts', 'date', 'tod', 'stage', 'bpm', 'respiratory_rate'],
  sport: [
    'start_ts',
    'type',
    'date',
    'duration_s',
    'distance_m',
    'calories',
    'avg_pace',
    'max_pace',
    'min_pace',
  ],
}

function folderOf(path: string): string | null {
  // Algunos compresores de Windows guardan las rutas con barra invertida.
  const normalized = path.replace(/\\/g, '/')
  const base = normalized.split('/').pop() ?? normalized
  const match = /^([A-Za-z_]+?)_\d+\.csv$/i.exec(base)
  if (match) return match[1].toUpperCase()
  const parts = normalized.split('/')
  if (parts.length >= 2) return parts[parts.length - 2].toUpperCase()
  return null
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Importa un ZIP de exportación de Zepp en el store.
 *
 * Todo va en una transacción: si algo falla, la base queda como estaba.
 * Las filas se insertan con `INSERT OR REPLACE`, así que reimportar es seguro.
 */
export async function importZeppArchive(
  store: HealthStore,
  file: Blob,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportResult> {
  onProgress?.({ phase: 'open', rows: 0 })

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    throw new Error(
      'No se pudo abrir el ZIP. Si Zepp te pidió contraseña al exportar, vuelve a exportar sin cifrar.',
    )
  }

  const entries = Object.values(zip.files).filter(
    (entry) => !entry.dir && entry.name.toLowerCase().endsWith('.csv'),
  )
  if (!entries.length) {
    throw new Error('El ZIP no contiene CSV. ¿Es el export de datos de Zepp?')
  }

  const files: Record<string, number> = {}
  const rowsByTable: Record<string, number> = {}
  const warnings: string[] = []
  let totalRows = 0

  store.db.exec('BEGIN')
  try {
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]
      const folder = folderOf(entry.name)
      const table = folder ? TABLE_BY_FOLDER[folder] : undefined
      if (!table) continue

      onProgress?.({
        phase: 'read',
        file: entry.name,
        fileIndex: index + 1,
        fileCount: entries.length,
        rows: totalRows,
      })
      await tick()

      const text = await entry.async('string')

      if (table === 'profile') {
        const raw = Papa.parse<Row>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header) => header.trim(),
        }).data[0]
        if (raw) {
          store.saveProfile({
            userId: toText(pick(raw, 'userId')),
            gender: toInt(pick(raw, 'gender')),
            heightCm: toNumber(pick(raw, 'height')),
            weightKg: toNumber(pick(raw, 'weight')),
            nickname: toText(pick(raw, 'nickName')),
            birthday: toText(pick(raw, 'birthday')),
          })
        }
        files[table] = (files[table] ?? 0) + 1
        continue
      }

      const parsed = parseFile(table, text, warnings)
      const columns = COLUMNS[table]
      if (!columns) continue

      store.insertBatch(table, columns, parsed.rows, 'replace')
      rowsByTable[table] = (rowsByTable[table] ?? 0) + parsed.rows.length
      totalRows += parsed.rows.length
      files[table] = (files[table] ?? 0) + 1

      onProgress?.({
        phase: 'insert',
        file: entry.name,
        fileIndex: index + 1,
        fileCount: entries.length,
        rows: totalRows,
      })
    }

    if (totalRows === 0) {
      throw new Error(
        'No se reconoció ninguna tabla de Zepp en el ZIP. Revisa que sea el export de datos de Zepp.',
      )
    }

    store.db.exec('COMMIT')
  } catch (error) {
    store.db.exec('ROLLBACK')
    throw error
  }

  const importedAt = new Date().toISOString()
  const result: ImportResult = { files, rows: rowsByTable, totalRows, warnings, importedAt }
  store.setImportMeta({
    importedAt,
    source: 'zepp',
    files,
    rows: totalRows,
    warnings,
  })
  onProgress?.({ phase: 'done', rows: totalRows })
  return result
}

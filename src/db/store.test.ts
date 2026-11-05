import { describe, expect, it } from 'vitest'
import { createTestStore } from '../test/helpers'
import { sportLabel } from './store'

describe('HealthStore', () => {
  it('da prioridad a Zepp frente a Google Health', async () => {
    const store = await createTestStore()

    // Google llega primero: rellena el hueco.
    store.insertBatch(
      'daily_activity',
      ['date', 'steps', 'distance_m', 'run_distance_m', 'calories'],
      [['2026-01-01', 111, 1, 0, 1], ['2026-01-02', 222, 2, 0, 2]],
      'ignore',
    )
    // Zepp sobrescribe donde tiene dato y añade el día que falta.
    store.insertBatch(
      'daily_activity',
      ['date', 'steps', 'distance_m', 'run_distance_m', 'calories'],
      [['2026-01-01', 999, 9, 0, 9]],
      'replace',
    )

    const rows = store.getDailyActivity('2026-01-01', '2026-01-02')
    expect(rows[0].steps).toBe(999)
    expect(rows[1].steps).toBe(222)
  })

  it('inserta lotes grandes sin superar el límite de parámetros', async () => {
    const store = await createTestStore()
    const rows = Array.from({ length: 500 }, (_, index) => [
      `2026-02-${String((index % 28) + 1).padStart(2, '0')}`,
      index,
      null,
      null,
      null,
    ])
    store.insertBatch('daily_activity', ['date', 'steps', 'distance_m', 'run_distance_m', 'calories'], rows)
    expect(store.getCoverage().activity.rows).toBe(28)
  })

  it('calcula el resumen semanal y la semana anterior', async () => {
    const store = await createTestStore()
    store.insertBatch(
      'daily_activity',
      ['date', 'steps', 'distance_m', 'run_distance_m', 'calories'],
      [
        ['2026-01-01', 1000, 0, 0, 10],
        ['2026-01-02', 3000, 0, 0, 20],
        ['2026-01-08', 5000, 0, 0, 30],
        ['2026-01-09', 7000, 0, 0, 40],
      ],
    )
    store.insertBatch(
      'sleep_session',
      ['date', 'start_ts', 'end_ts', 'deep_min', 'light_min', 'rem_min', 'wake_min', 'naps'],
      [['2026-01-08', null, null, 60, 240, 60, 10, null]],
    )
    store.insertBatch(
      'sport',
      ['start_ts', 'type', 'date', 'duration_s', 'distance_m', 'calories', 'avg_pace', 'max_pace', 'min_pace'],
      [[Date.UTC(2026, 0, 8) / 1000, 14, '2026-01-08', 1800, 3000, 200, 1.5, 0, 0]],
    )

    const summary = store.getWeeklySummary('2026-01-10')
    expect(summary.current.from).toBe('2026-01-04')
    expect(summary.current.to).toBe('2026-01-10')
    expect(summary.current.stepsTotal).toBe(12000)
    expect(summary.current.stepsAvg).toBe(6000)
    expect(summary.current.sleepAvgMin).toBe(360)
    expect(summary.current.sportCount).toBe(1)
    expect(summary.current.sportMinutes).toBe(30)

    expect(summary.previous.stepsTotal).toBe(4000)
    expect(summary.previous.stepsAvg).toBe(2000)
  })

  it('vacía los datos sin tocar el esquema', async () => {
    const store = await createTestStore()
    store.insertBatch(
      'daily_activity',
      ['date', 'steps', 'distance_m', 'run_distance_m', 'calories'],
      [['2026-01-01', 1000, 0, 0, 10]],
    )
    store.setImportMeta({
      importedAt: '2026-01-02T00:00:00.000Z',
      source: 'zepp',
      files: {},
      rows: 1,
      warnings: [],
    })

    store.clearAllData()
    expect(store.getCoverage().activity.rows).toBe(0)
    expect(store.getImportMeta()).toBeNull()
    // La base sigue operativa.
    store.insertBatch(
      'daily_activity',
      ['date', 'steps', 'distance_m', 'run_distance_m', 'calories'],
      [['2026-01-03', 5, 0, 0, 0]],
    )
    expect(store.getCoverage().activity.rows).toBe(1)
  })

  it('etiqueta los deportes conocidos y deja los desconocidos como código', () => {
    expect(sportLabel(14)).toBe('Caminata')
    expect(sportLabel(47)).toBe('Carrera')
    expect(sportLabel(999)).toBe('Deporte 999')
  })
})

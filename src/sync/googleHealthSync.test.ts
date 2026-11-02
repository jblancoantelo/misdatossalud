import { describe, expect, it } from 'vitest'
import { mapSleepPoints, mapStepsRollup } from './googleHealthSync'

describe('mapStepsRollup', () => {
  it('convierte los puntos del rollup en días con pasos', () => {
    const rows = mapStepsRollup([
      {
        civilStartTime: { date: { year: 2026, month: 10, day: 31 } },
        steps: { countSum: '11074' },
      },
    ])
    expect(rows).toEqual([{ date: '2026-10-31', steps: 11074 }])
  })

  it('suma varios puntos del mismo día y ordena por fecha', () => {
    const rows = mapStepsRollup([
      { civilStartTime: { date: { year: 2026, month: 11, day: 1 } }, steps: { countSum: 300 } },
      { civilStartTime: { date: { year: 2026, month: 10, day: 31 } }, steps: { countSum: '1000' } },
      { civilStartTime: { date: { year: 2026, month: 10, day: 31 } }, steps: { countSum: '74' } },
    ])
    expect(rows).toEqual([
      { date: '2026-10-31', steps: 1074 },
      { date: '2026-11-01', steps: 300 },
    ])
  })

  it('ignora puntos sin fecha o sin pasos', () => {
    const rows = mapStepsRollup([
      { steps: { countSum: '100' } },
      { civilStartTime: { date: { year: 2026, month: 10, day: 31 } } },
    ])
    expect(rows).toEqual([])
  })
})

describe('mapSleepPoints', () => {
  it('usa el resumen por fases y la fecha del despertar', () => {
    const rows = mapSleepPoints([
      {
        sleep: {
          type: 'STAGES',
          interval: {
            startTime: '2026-10-30T22:30:00Z',
            endTime: '2026-10-31T06:30:00Z',
            civilEndTime: { date: { year: 2026, month: 10, day: 31 } },
          },
          summary: {
            minutesAsleep: '420',
            minutesAwake: '30',
            stagesSummary: [
              { type: 'DEEP', minutes: '90' },
              { type: 'LIGHT', minutes: '240' },
              { type: 'REM', minutes: '90' },
              { type: 'AWAKE', minutes: '30' },
            ],
          },
        },
      },
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      date: '2026-10-31',
      deepMin: 90,
      lightMin: 240,
      remMin: 90,
      wakeMin: 30,
      naps: 0,
    })
    expect(rows[0].startTs).toBe(Math.round(Date.parse('2026-10-30T22:30:00Z') / 1000))
  })

  it('calcula las fases desde los tramos si no hay resumen', () => {
    const rows = mapSleepPoints([
      {
        sleep: {
          interval: { civilEndTime: { date: { year: 2026, month: 10, day: 31 } } },
          stages: [
            { type: 'DEEP', startTime: '2026-10-30T23:00:00Z', endTime: '2026-10-30T23:30:00Z' },
            { type: 'LIGHT', startTime: '2026-10-30T23:30:00Z', endTime: '2026-10-31T01:00:00Z' },
            { type: 'AWAKE', startTime: '2026-10-31T01:00:00Z', endTime: '2026-10-31T01:10:00Z' },
          ],
        },
      },
    ])

    expect(rows[0]).toMatchObject({ deepMin: 30, lightMin: 90, wakeMin: 10, remMin: null })
  })

  it('si solo hay minutos dormidos, los cuenta como sueño ligero', () => {
    const rows = mapSleepPoints([
      {
        sleep: {
          interval: { civilEndTime: { date: { year: 2026, month: 10, day: 31 } } },
          summary: { minutesAsleep: '400', minutesAwake: '20' },
        },
      },
    ])

    expect(rows[0]).toMatchObject({ lightMin: 400, wakeMin: 20, deepMin: null, remMin: null })
  })

  it('se queda con la sesión más larga cuando hay varias el mismo día', () => {
    const rows = mapSleepPoints([
      {
        sleep: {
          interval: {
            startTime: '2026-10-31T13:00:00Z',
            endTime: '2026-10-31T13:30:00Z',
            civilEndTime: { date: { year: 2026, month: 10, day: 31 } },
          },
          summary: { minutesAsleep: '30' },
        },
      },
      {
        sleep: {
          interval: {
            startTime: '2026-10-30T23:00:00Z',
            endTime: '2026-10-31T07:00:00Z',
            civilEndTime: { date: { year: 2026, month: 10, day: 31 } },
          },
          summary: { minutesAsleep: '480' },
        },
      },
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].lightMin).toBe(480)
  })
})

import { describe, expect, it } from 'vitest'
import {
  mapActiveMinutesRollup,
  mapBodyFatPoints,
  mapDistanceRollup,
  mapEnergyRollup,
  mapExercisePoints,
  mapFloorsPoints,
  mapHeartRatePoints,
  mapHeightPoints,
  mapOxygenPoints,
  mapSleepPoints,
  mapStepsRollup,
  mapVo2MaxPoints,
  mapWeightPoints,
} from './googleHealthSync'

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

describe('mapDistanceRollup', () => {
  it('convierte milímetros en metros y suma el mismo día', () => {
    const rows = mapDistanceRollup([
      { civilStartTime: { date: { year: 2026, month: 10, day: 31 } }, distance: { millimetersSum: '1500000' } },
      { civilStartTime: { date: { year: 2026, month: 10, day: 31 } }, distance: { millimetersSum: '500000' } },
    ])
    expect(rows).toEqual([{ date: '2026-10-31', value: 2000 }])
  })
})

describe('mapEnergyRollup', () => {
  it('lee las kcal activas', () => {
    const rows = mapEnergyRollup([
      {
        civilStartTime: { date: { year: 2026, month: 10, day: 31 } },
        activeEnergyBurned: { kcalSum: 780.5 },
      },
    ])
    expect(rows).toEqual([{ date: '2026-10-31', value: 780.5 }])
  })
})

describe('mapActiveMinutesRollup', () => {
  it('separa los minutos por nivel de actividad', () => {
    const rows = mapActiveMinutesRollup([
      {
        civilStartTime: { date: { year: 2026, month: 10, day: 31 } },
        activeMinutes: {
          activeMinutesRollupByActivityLevel: [
            { activityLevel: 'LIGHT', activeMinutesSum: '148' },
            { activityLevel: 'MODERATE', activeMinutesSum: '24' },
            { activityLevel: 'VIGOROUS', activeMinutesSum: '63' },
          ],
        },
      },
    ])
    expect(rows).toEqual([
      { date: '2026-10-31', metric: 'active_minutes_light', value: 148 },
      { date: '2026-10-31', metric: 'active_minutes_moderate', value: 24 },
      { date: '2026-10-31', metric: 'active_minutes_vigorous', value: 63 },
    ])
  })
})

describe('mapWeightPoints', () => {
  it('convierte gramos en kilos y usa la fecha civil', () => {
    const rows = mapWeightPoints([
      {
        weight: {
          sampleTime: {
            physicalTime: '2026-10-31T10:34:19Z',
            civilTime: {
              date: { year: 2026, month: 10, day: 31 },
              time: { hours: 11, minutes: 34, seconds: 19 },
            },
          },
          weightGrams: 76000,
        },
      },
    ])
    expect(rows).toEqual([
      { ts: Math.round(Date.parse('2026-10-31T10:34:19Z') / 1000), date: '2026-10-31', weightKg: 76 },
    ])
  })
})

describe('mapHeightPoints', () => {
  it('convierte milímetros en centímetros', () => {
    const rows = mapHeightPoints([
      {
        height: {
          sampleTime: {
            physicalTime: '2026-10-31T10:34:19Z',
            civilTime: { date: { year: 2026, month: 10, day: 31 } },
          },
          heightMillimeters: '1750',
        },
      },
    ])
    expect(rows[0]).toMatchObject({ date: '2026-10-31', heightCm: 175 })
  })
})

describe('mapBodyFatPoints', () => {
  it('lee el porcentaje de grasa corporal', () => {
    const rows = mapBodyFatPoints([
      {
        bodyFat: {
          sampleTime: {
            physicalTime: '2026-10-31T10:34:19Z',
            civilTime: { date: { year: 2026, month: 10, day: 31 } },
          },
          percentage: 18.4,
        },
      },
    ])
    expect(rows[0]).toMatchObject({ date: '2026-10-31', fatRate: 18.4 })
  })
})

describe('mapHeartRatePoints', () => {
  it('guarda la muestra con fecha y hora del día', () => {
    const rows = mapHeartRatePoints([
      {
        heartRate: {
          sampleTime: {
            physicalTime: '2024-12-21T10:23:59Z',
            civilTime: {
              date: { year: 2024, month: 12, day: 21 },
              time: { hours: 11, minutes: 23, seconds: 59 },
            },
          },
          beatsPerMinute: '171',
        },
      },
    ])
    expect(rows).toEqual([
      {
        ts: Math.round(Date.parse('2024-12-21T10:23:59Z') / 1000),
        date: '2024-12-21',
        tod: 11 * 3600 + 23 * 60 + 59,
        bpm: 171,
      },
    ])
  })
})

describe('mapFloorsPoints', () => {
  it('suma los pisos del día', () => {
    const rows = mapFloorsPoints([
      {
        floors: {
          interval: {
            civilStartTime: { date: { year: 2026, month: 10, day: 31 } },
            civilEndTime: { date: { year: 2026, month: 10, day: 31 } },
          },
          count: '4',
        },
      },
      {
        floors: {
          interval: { civilStartTime: { date: { year: 2026, month: 10, day: 31 } } },
          count: 2,
        },
      },
    ])
    expect(rows).toEqual([{ date: '2026-10-31', value: 6 }])
  })
})

describe('mapOxygenPoints', () => {
  it('calcula la media diaria', () => {
    const point = (percentage: number) => ({
      oxygenSaturation: {
        sampleTime: {
          physicalTime: '2026-10-31T10:00:00Z',
          civilTime: { date: { year: 2026, month: 10, day: 31 } },
        },
        percentage,
      },
    })
    const rows = mapOxygenPoints([point(96), point(98)])
    expect(rows).toEqual([{ date: '2026-10-31', value: 97 }])
  })
})

describe('mapVo2MaxPoints', () => {
  it('se queda con el último valor del día', () => {
    const rows = mapVo2MaxPoints([
      {
        vo2Max: {
          sampleTime: {
            physicalTime: '2026-10-31T08:00:00Z',
            civilTime: { date: { year: 2026, month: 10, day: 31 } },
          },
          vo2Max: 44,
        },
      },
      {
        vo2Max: {
          sampleTime: {
            physicalTime: '2026-10-31T18:00:00Z',
            civilTime: { date: { year: 2026, month: 10, day: 31 } },
          },
          vo2Max: 45.5,
        },
      },
    ])
    expect(rows).toEqual([{ date: '2026-10-31', value: 45.5 }])
  })
})

describe('mapExercisePoints', () => {
  it('convierte una sesión de ejercicio en una fila de deporte', () => {
    const rows = mapExercisePoints([
      {
        exercise: {
          interval: {
            startTime: '2026-10-31T08:00:00Z',
            endTime: '2026-10-31T08:30:00Z',
            civilStartTime: { date: { year: 2026, month: 10, day: 31 } },
          },
          exerciseType: 'RUNNING',
          displayName: 'Carrera',
          activeDuration: '1500s',
          metricsSummary: {
            caloriesKcal: 320,
            distanceMillimeters: 5_000_000,
            averagePaceSecondsPerMeter: 0.3,
          },
        },
      },
    ])
    expect(rows).toEqual([
      {
        startTs: Math.round(Date.parse('2026-10-31T08:00:00Z') / 1000),
        date: '2026-10-31',
        type: 1,
        durationS: 1500,
        distanceM: 5000,
        calories: 320,
        avgPace: 0.3,
        label: 'Carrera',
      },
    ])
  })
})

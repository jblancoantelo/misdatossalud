import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { importZeppArchive } from './zepp'
import { createTestStore } from '../test/helpers'

function csv(header: string, rows: string[]): string {
  return `${header}\n${rows.join('\n')}\n`
}

async function buildZip(): Promise<Blob> {
  const zip = new JSZip()
  zip.file(
    'ACTIVITY/ACTIVITY_1.csv',
    csv('date,steps,distance,runDistance,calories', [
      '2026-01-01,10000,7000,1000,300',
      '2026-01-02,5000,3000,0,200',
      '2026-01-03,8000,5000,500,250',
    ]),
  )
  zip.file(
    'ACTIVITY_MINUTE/ACTIVITY_MINUTE_1.csv',
    csv('date,time,steps', ['2026-01-01,00:15,34', '2026-01-01,00:16,1']),
  )
  zip.file(
    'SLEEP/SLEEP_1.csv',
    csv('date,deepSleepTime,shallowSleepTime,wakeTime,start,stop,REMTime,naps', [
      '2026-01-01,102,273,7,2026-01-01 01:39:00+0000,2026-01-01 08:01:00+0000,,',
      '2026-01-02,80,200,5,2026-01-01 23:18:00+0000,2026-01-02 06:43:00+0000,60,',
    ]),
  )
  zip.file(
    'SLEEP_MINUTE/SLEEP_MINUTE_1.csv',
    csv('date,time,stage,hr,respiratory_rate', [
      '2026-01-02,00:25,LIGHT,68,',
      '2026-01-02,00:26,DEEP,60,14.2',
    ]),
  )
  zip.file(
    'HEARTRATE_AUTO/HEARTRATE_AUTO_1.csv',
    csv('date,time,heartRate', ['2026-01-01,00:00,82', '2026-01-01,00:05,69']),
  )
  zip.file('HEARTRATE/HEARTRATE_1.csv', csv('time,heartRate', ['2026-01-01 10:00:00+0000,60']))
  zip.file(
    'SPORT/SPORT_1.csv',
    csv('type,startTime,sportTime(s),maxPace(/meter),minPace(/meter),distance(m),avgPace(/meter),calories(kcal)', [
      '14,2026-01-02 19:20:09+0000,1390,1.3,0.0,775.0,1.793,266.0',
    ]),
  )
  zip.file(
    'BODY/BODY_1.csv',
    csv('time,weight,height,bmi,fatRate,bodyWaterRate,boneMass,metabolism,muscleRate,visceralFat', [
      '2024-05-12 19:22:43+0000,80.0,175.0,26.12,20.24,58.39,4.327,1746.0,59.476,null',
    ]),
  )
  zip.file(
    'USER/USER_1.csv',
    csv('userId,gender,height,weight,nickName,avatar,birthday', [
      '123,1,175.0,74.0,Pocholo,https://example.com/a.jpg,1983-07',
    ]),
  )
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  return new Blob([bytes as unknown as BlobPart], { type: 'application/zip' })
}

describe('importZeppArchive', () => {
  it('importa todas las tablas del export', async () => {
    const store = await createTestStore()
    const result = await importZeppArchive(store, await buildZip())

    expect(result.rows.daily_activity).toBe(3)
    expect(result.rows.minute_activity).toBe(2)
    expect(result.rows.sleep_session).toBe(2)
    expect(result.rows.sleep_minute).toBe(2)
    expect(result.rows.heart_rate_auto).toBe(2)
    expect(result.rows.heart_rate).toBe(1)
    expect(result.rows.sport).toBe(1)
    expect(result.rows.body_measurement).toBe(1)

    const activity = store.getDailyActivity('2026-01-01', '2026-01-03')
    expect(activity).toHaveLength(3)
    expect(activity[0].steps).toBe(10000)
    expect(activity[0].distanceM).toBe(7000)

    const sleep = store.getSleepNights('2026-01-01', '2026-01-02')
    expect(sleep[0].deepMin).toBe(102)
    expect(sleep[0].totalMin).toBe(375)
    expect(sleep[1].remMin).toBe(60)
    expect(sleep[1].startTs).toBe(Date.UTC(2026, 0, 1, 23, 18, 0) / 1000)

    const sports = store.getSports(10)
    expect(sports).toHaveLength(1)
    expect(sports[0].type).toBe(14)
    expect(sports[0].distanceM).toBe(775)

    const body = store.getBodyMeasurements()
    expect(body).toHaveLength(1)
    expect(body[0].weightKg).toBe(80)
    expect(body[0].visceralFat).toBeNull()

    const profile = store.getProfile()
    expect(profile?.nickname).toBe('Pocholo')

    const heart = store.getHeartDays('2026-01-01', '2026-01-02')
    expect(heart[0].min).toBe(60)
    expect(heart[0].max).toBe(82)
  })

  it('es idempotente: reimportar no duplica', async () => {
    const store = await createTestStore()
    const zip = await buildZip()
    await importZeppArchive(store, zip)
    await importZeppArchive(store, zip)
    expect(store.getDailyActivity('2026-01-01', '2026-01-03')).toHaveLength(3)
    expect(store.getSports(10)).toHaveLength(1)
  })

  it('descarta filas con clave inválida y lo avisa', async () => {
    const zip = new JSZip()
    zip.file('ACTIVITY/ACTIVITY_1.csv', csv('date,steps', ['2026-01-01,10', ',20', '2026-01-02,abc']))
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const store = await createTestStore()
    const result = await importZeppArchive(store, new Blob([bytes as unknown as BlobPart]))
    expect(result.rows.daily_activity).toBe(2)
    expect(result.warnings.join(' ')).toContain('descartadas')
    expect(store.getDailyActivity('2026-01-01', '2026-01-02')[1].steps).toBeNull()
  })

  it('acepta rutas con barra invertida (compresores de Windows)', async () => {
    const zip = new JSZip()
    zip.file('ACTIVITY\\ACTIVITY_1.csv', csv('date,steps', ['2026-01-01,123']))
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const store = await createTestStore()
    const result = await importZeppArchive(store, new Blob([bytes as unknown as BlobPart]))
    expect(result.rows.daily_activity).toBe(1)
    expect(store.getDailyActivity('2026-01-01', '2026-01-01')[0].steps).toBe(123)
  })

  it('falla si el ZIP no contiene ninguna tabla reconocible', async () => {
    const zip = new JSZip()
    zip.file('OTRA_COSA/datos.csv', 'a,b\n1,2')
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const store = await createTestStore()
    await expect(importZeppArchive(store, new Blob([bytes as unknown as BlobPart]))).rejects.toThrow(
      /no se reconoció/i,
    )
    expect(store.getCoverage().activity.rows).toBe(0)
  })

  it('falla con un ZIP que no es de Zepp', async () => {
    const zip = new JSZip()
    zip.file('leeme.txt', 'hola')
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const store = await createTestStore()
    await expect(importZeppArchive(store, new Blob([bytes as unknown as BlobPart]))).rejects.toThrow(
      /no contiene CSV/i,
    )
  })
})

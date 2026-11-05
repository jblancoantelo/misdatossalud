import { describe, expect, it } from 'vitest'
import { parseLocalDateTime, parseZeppTimestamp, toInt, toNumber, toText } from './zepp'

describe('parseZeppTimestamp', () => {
  it('interpreta el desfase +0000 como UTC', () => {
    const ts = parseZeppTimestamp('2020-01-01 01:39:00+0000')
    expect(ts).toBe(Date.UTC(2020, 0, 1, 1, 39, 0) / 1000)
  })

  it('resta el desfase cuando es positivo', () => {
    const ts = parseZeppTimestamp('2024-05-12 19:22:43+0200')
    expect(ts).toBe(Date.UTC(2024, 4, 12, 17, 22, 43) / 1000)
  })

  it('suma el desfase cuando es negativo', () => {
    const ts = parseZeppTimestamp('2024-05-12 19:22:43-0300')
    expect(ts).toBe(Date.UTC(2024, 4, 12, 22, 22, 43) / 1000)
  })

  it('acepta el separador T', () => {
    expect(parseZeppTimestamp('2026-03-04T07:05:00+0000')).toBe(Date.UTC(2026, 2, 4, 7, 5, 0) / 1000)
  })

  it('devuelve null para valores vacíos o inválidos', () => {
    expect(parseZeppTimestamp('')).toBeNull()
    expect(parseZeppTimestamp('null')).toBeNull()
    expect(parseZeppTimestamp('ayer')).toBeNull()
  })
})

describe('parseLocalDateTime', () => {
  it('usa la zona horaria local', () => {
    const ts = parseLocalDateTime('2025-01-10', '00:25')
    expect(ts).toBe(Math.floor(new Date(2025, 0, 10, 0, 25, 0).getTime() / 1000))
  })

  it('normaliza horas mayores de 24', () => {
    const ts = parseLocalDateTime('2022-06-25', '25:54')
    expect(ts).toBe(Math.floor(new Date(2022, 5, 26, 1, 54, 0).getTime() / 1000))
  })

  it('devuelve null si el formato no encaja', () => {
    expect(parseLocalDateTime('2025-01-10', '')).toBeNull()
    expect(parseLocalDateTime('10/01/2025', '00:25')).toBeNull()
  })
})

describe('conversión de valores', () => {
  it('trata null, vacío y NaN como ausencia de dato', () => {
    expect(toNumber('')).toBeNull()
    expect(toNumber('null')).toBeNull()
    expect(toNumber('NaN')).toBeNull()
    expect(toNumber('12.5')).toBe(12.5)
  })

  it('redondea enteros', () => {
    expect(toInt('42.6')).toBe(43)
    expect(toInt('')).toBeNull()
  })

  it('limpia textos', () => {
    expect(toText('  hola ')).toBe('hola')
    expect(toText('null')).toBeNull()
    expect(toText('')).toBeNull()
  })
})

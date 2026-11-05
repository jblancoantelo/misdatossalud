import { addDays, daysBetween } from './date'

/** Lista de fechas ISO entre dos extremos, ambos incluidos. */
export function eachDate(from: string, to: string): string[] {
  const total = daysBetween(from, to)
  if (total < 0) return []
  const out: string[] = []
  for (let i = 0; i <= total; i += 1) out.push(addDays(from, i))
  return out
}

/** Alinea filas con fecha a un rango continuo, dejando null donde no hay dato. */
export function fillByDate<T extends { date: string }>(
  from: string,
  to: string,
  rows: T[],
): { date: string; row: T | null }[] {
  const map = new Map(rows.map((row) => [row.date, row]))
  return eachDate(from, to).map((date) => ({ date, row: map.get(date) ?? null }))
}

export function movingAverage(values: (number | null)[], window = 7): (number | null)[] {
  const out: (number | null)[] = []
  for (let i = 0; i < values.length; i += 1) {
    const slice = values
      .slice(Math.max(0, i - window + 1), i + 1)
      .filter((value): value is number => value != null)
    out.push(slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null)
  }
  return out
}

export function sum(values: (number | null)[]): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0)
}

export function average(values: (number | null)[]): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (!valid.length) return null
  return valid.reduce((a, b) => a + b, 0) / valid.length
}

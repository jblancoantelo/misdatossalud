/** Formateo numérico en español. */

const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 })

export function num(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (digits === 0) return nf0.format(value)
  if (digits === 1) return nf1.format(value)
  return nf2.format(value)
}

export function signedNum(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const text = num(value, digits)
  return value > 0 ? `+${text}` : text
}

export function km(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return '—'
  if (meters < 1000) return `${num(meters)} m`
  return `${num(meters / 1000, meters < 10_000 ? 2 : 1)} km`
}

/** Ritmo en s/m → "5:42 /km". */
export function pace(secondsPerMeter: number | null | undefined): string {
  if (!secondsPerMeter || !Number.isFinite(secondsPerMeter) || secondsPerMeter <= 0) return '—'
  const secondsPerKm = secondsPerMeter * 1000
  const m = Math.floor(secondsPerKm / 60)
  const s = Math.round(secondsPerKm % 60)
  return `${m}:${String(s).padStart(2, '0')} /km`
}

export function speedKmh(metersPerSecond: number | null | undefined): string {
  if (metersPerSecond == null || !Number.isFinite(metersPerSecond) || metersPerSecond <= 0) return '—'
  return `${num(metersPerSecond * 3.6, 1)} km/h`
}

export function bytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${num(size / 1024, 1)} KB`
  return `${num(size / (1024 * 1024), 1)} MB`
}

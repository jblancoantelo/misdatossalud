/** Utilidades de fecha y hora en horario local del dispositivo. */

const MS_PER_DAY = 86_400_000

export function toISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Convierte 'YYYY-MM-DD' en la medianoche local de ese día. */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function todayISO(): string {
  return toISODate(new Date())
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

/** Fecha de inicio de un rango de `days` días que termina en `endISO`. */
export function startOfRange(endISO: string, days: number): string {
  return addDays(endISO, -(days - 1))
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((parseISODate(toISO).getTime() - parseISODate(fromISO).getTime()) / MS_PER_DAY)
}

export function localDateFromTs(tsSeconds: number): string {
  return toISODate(new Date(tsSeconds * 1000))
}

/** Segundos transcurridos desde la medianoche local del día del instante. */
export function timeOfDaySeconds(tsSeconds: number): number {
  const d = new Date(tsSeconds * 1000)
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
}

const SHORT_MONTHS = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
]

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

export function formatShortDate(iso: string): string {
  const d = parseISODate(iso)
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`
}

export function formatLongDate(iso: string): string {
  const d = parseISODate(iso)
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export function formatWeekday(iso: string): string {
  return WEEKDAYS[parseISODate(iso).getDay()]
}

export function formatTimeOfDay(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function formatDateTime(tsSeconds: number): string {
  return `${formatShortDate(localDateFromTs(tsSeconds))} ${formatTimeOfDay(tsSeconds)}`
}

/** Minutos a "7 h 42 min" / "42 min". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—'
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} min`
  return `${h} h ${String(m).padStart(2, '0')} min`
}

/** Minutos a "7,7" (horas decimales con coma). */
export function toHours(minutes: number | null | undefined): number | null {
  if (minutes == null || !Number.isFinite(minutes)) return null
  return Math.round((minutes / 60) * 10) / 10
}

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { addDays, daysBetween, todayISO } from '../lib/date'

export function Card({
  label,
  value,
  unit,
  hint,
  delta,
  goodWhenUp = true,
}: {
  label: string
  value: string
  unit?: string
  hint?: string
  delta?: number | null
  goodWhenUp?: boolean
}) {
  const hasDelta = delta != null && Number.isFinite(delta) && Math.abs(delta) > 0.0001
  const good = delta != null && (goodWhenUp ? delta > 0 : delta < 0)
  return (
    <div className="card stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value}
        {unit ? <span className="stat-unit">{unit}</span> : null}
      </span>
      <span className="stat-foot">
        {hasDelta ? (
          <span className={good ? 'delta up' : 'delta down'}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toLocaleString('es-ES', { maximumFractionDigits: 1 })}
            {hint ? ` ${hint}` : ''}
          </span>
        ) : (
          <span className="muted">{hint ?? '\u00a0'}</span>
        )}
      </span>
    </div>
  )
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="stat-grid">{children}</div>
}

export function Section({
  title,
  actions,
  children,
  id,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
  id?: string
}) {
  return (
    <section className="section" id={id}>
      <header className="section-head">
        <h2>{title}</h2>
        {actions ? <div className="section-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  )
}

export function RangePicker<T extends string | number>({
  value,
  options,
  onChange,
  label = 'Periodo',
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label?: string
}) {
  return (
    <div className="range" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={option.value === value ? 'range-btn active' : 'range-btn'}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export interface DateRange {
  from: string
  to: string
}

const PRESETS = [
  { days: 7, label: '7 días' },
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
  { days: 365, label: '1 año' },
]

export function DateRangePicker({
  from,
  to,
  min,
  max,
  onChange,
}: {
  from: string
  to: string
  min?: string | null
  max?: string | null
  onChange: (range: DateRange) => void
}) {
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)

  useEffect(() => {
    setDraftFrom(from)
    setDraftTo(to)
  }, [from, to])

  function apply(nextFrom: string, nextTo: string) {
    if (!nextFrom || !nextTo) return
    const ordered = nextFrom <= nextTo ? [nextFrom, nextTo] : [nextTo, nextFrom]
    setDraftFrom(ordered[0])
    setDraftTo(ordered[1])
    onChange({ from: ordered[0], to: ordered[1] })
  }

  const today = todayISO()
  const isPreset = (days: number) => to === today && from === addDays(today, -(days - 1))
  const isAll = Boolean(min) && from === min && to === (max ?? today)
  const days = daysBetween(from, to) + 1

  return (
    <div className="date-range" role="group" aria-label="Periodo de fechas">
      <div className="range">
        {PRESETS.map((preset) => (
          <button
            key={preset.days}
            type="button"
            className={isPreset(preset.days) ? 'range-btn active' : 'range-btn'}
            aria-pressed={isPreset(preset.days)}
            onClick={() => apply(addDays(today, -(preset.days - 1)), today)}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          className={isAll ? 'range-btn active' : 'range-btn'}
          aria-pressed={isAll}
          disabled={!min}
          onClick={() => apply(min ?? '2000-01-01', max ?? today)}
        >
          Todo
        </button>
      </div>
      <div className="date-fields">
        <label className="date-field">
          <span>Desde</span>
          <input
            type="date"
            value={draftFrom}
            min={min ?? undefined}
            max={draftTo}
            onChange={(event) => apply(event.target.value, draftTo)}
          />
        </label>
        <label className="date-field">
          <span>Hasta</span>
          <input
            type="date"
            value={draftTo}
            min={draftFrom}
            max={today}
            onChange={(event) => apply(draftFrom, event.target.value)}
          />
        </label>
        <span className="date-count muted small">
          {days === 1 ? '1 día' : `${days} días`}
        </span>
      </div>
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children ? <p className="muted">{children}</p> : null}
    </div>
  )
}

export interface Column<T> {
  key: string
  label: string
  align?: 'left' | 'right'
  render: (row: T) => ReactNode
}

export function DataTable<T>({
  columns,
  rows,
  getKey,
  max,
}: {
  columns: Column<T>[]
  rows: T[]
  getKey: (row: T) => string | number
  max?: number
}) {
  const visible = max ? rows.slice(0, max) : rows
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.align === 'right' ? 'right' : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={getKey(row)}>
              {columns.map((column) => (
                <td key={column.key} className={column.align === 'right' ? 'right' : undefined}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Callout({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'danger'
  children: ReactNode
}) {
  return <div className={`callout ${tone}`}>{children}</div>
}

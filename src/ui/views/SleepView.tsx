import { useMemo } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import type { HealthStore } from '../../db/store'
import { formatLongDate, formatMinutes, formatShortDate, formatTimeOfDay, toHours } from '../../lib/date'
import { num } from '../../lib/format'
import { average, fillByDate } from '../../lib/series'
import { AXIS_LABEL, AXIS_LINE, Chart, PALETTE, SPLIT_LINE, TOOLTIP } from '../Chart'
import { Card, Empty, Section, StatGrid, type DateRange } from '../components'

interface ViewProps {
  store: HealthStore
  version: number
  range: DateRange
}

const STAGE_Y: Record<string, number> = { DEEP: 0, LIGHT: 1, REM: 2, WAKE: 3, AWAKE: 3 }

export function SleepView({ store, version, range }: ViewProps) {
  const { from, to } = range

  const data = useMemo(() => {
    const nights = store.getSleepNights(from, to)
    const last = nights.length ? nights[nights.length - 1] : null
    const hypnogram = last ? store.getHypnogram(last.date) : []
    return { to, from, nights, last, hypnogram, aligned: fillByDate(from, to, nights) }
  }, [store, version, from, to])

  const totals = data.aligned.map((entry) => entry.row?.totalMin ?? null)
  const avgMin = average(totals)

  const deepAvg = average(data.nights.map((night) => night.deepMin))
  const remAvg = average(data.nights.map((night) => night.remMin))
  const best = data.nights.reduce<{ date: string; totalMin: number } | null>((acc, night) => {
    if (night.totalMin == null) return acc
    if (!acc || night.totalMin > acc.totalMin) return { date: night.date, totalMin: night.totalMin }
    return acc
  }, null)
  const worst = data.nights.reduce<{ date: string; totalMin: number } | null>((acc, night) => {
    if (night.totalMin == null) return acc
    if (!acc || night.totalMin < acc.totalMin) return { date: night.date, totalMin: night.totalMin }
    return acc
  }, null)

  const stagesOption = useMemo<EChartsCoreOption>(() => {
    const labels = data.aligned.map((entry) => formatShortDate(entry.date))
    const series = [
      { name: 'Profundo', key: 'deepMin' as const, color: '#1d4ed8' },
      { name: 'Ligero', key: 'lightMin' as const, color: '#0ea5e9' },
      { name: 'REM', key: 'remMin' as const, color: '#8b5cf6' },
      { name: 'Despierto', key: 'wakeMin' as const, color: '#f59e0b' },
    ]
    return {
      grid: { left: 42, right: 16, top: 26, bottom: 30 },
      legend: { top: 0, textStyle: { color: '#94a3b8', fontSize: 11 }, icon: 'roundRect' },
      tooltip: {
        ...TOOLTIP,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (value: unknown) =>
          typeof value === 'number' ? `${num(value, 1)} h` : 'sin datos',
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { ...AXIS_LABEL, hideOverlap: true },
        axisLine: AXIS_LINE,
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { ...AXIS_LABEL, formatter: '{value} h' },
        splitLine: SPLIT_LINE,
        axisLine: { show: false },
      },
      series: series.map((stage) => ({
        name: stage.name,
        type: 'bar',
        stack: 'sueno',
        barMaxWidth: 20,
        data: data.aligned.map((entry) => {
          const value = entry.row?.[stage.key]
          return value == null ? null : Math.round((value / 60) * 10) / 10
        }),
        itemStyle: { color: stage.color },
      })),
    }
  }, [data.aligned])

  const hypnogramOption = useMemo<EChartsCoreOption>(() => {
    if (!data.hypnogram.length) return {}
    const firstTs = data.hypnogram[0].ts
    const points = data.hypnogram.map((row) => {
      const stage = row.stage ? STAGE_Y[row.stage.toUpperCase()] : undefined
      return [Math.round((row.ts - firstTs) / 60), stage ?? null]
    })
    return {
      grid: { left: 84, right: 20, top: 16, bottom: 34 },
      tooltip: {
        ...TOOLTIP,
        trigger: 'axis',
        formatter: (params: unknown) => {
          const list = params as { value: [number, number | null] }[]
          const point = list[0]?.value
          if (!point) return ''
          const names = ['Profundo', 'Ligero', 'REM', 'Despierto']
          const time = formatTimeOfDay(firstTs + point[0] * 60)
          const stage = point[1] == null ? 'sin dato' : names[point[1]]
          return `${time} · ${stage}`
        },
      },
      xAxis: {
        type: 'value',
        min: 0,
        axisLabel: {
          ...AXIS_LABEL,
          formatter: (value: number) => formatTimeOfDay(firstTs + value * 60),
        },
        splitLine: { show: false },
        axisLine: AXIS_LINE,
      },
      yAxis: {
        type: 'value',
        min: -0.5,
        max: 3.5,
        interval: 1,
        axisLabel: {
          ...AXIS_LABEL,
          formatter: (value: number) => ['Prof.', 'Lig.', 'REM', 'Desp.'][value] ?? '',
        },
        splitLine: SPLIT_LINE,
        axisLine: { show: false },
      },
      series: [
        {
          type: 'line',
          step: 'end',
          data: points,
          symbol: 'none',
          lineStyle: { color: PALETTE[2], width: 2 },
          areaStyle: { color: 'rgba(139, 92, 246, 0.12)' },
        },
      ],
    }
  }, [data.hypnogram])

  if (!data.nights.length) {
    return (
      <Empty title="Sin datos de sueño en este periodo">
        Importa el export de Zepp desde Ajustes o cambia el periodo.
      </Empty>
    )
  }

  return (
    <>
      <StatGrid>
        <Card label="Media por noche" value={toHours(avgMin)?.toLocaleString('es-ES') ?? '—'} unit=" h" hint={`${data.nights.length} noches`} />
        <Card label="Sueño profundo" value={formatMinutes(deepAvg)} hint="media por noche" />
        <Card label="REM" value={formatMinutes(remAvg)} hint="media por noche" />
        <Card
          label="Mejor noche"
          value={best ? formatMinutes(best.totalMin) : '—'}
          hint={best ? formatShortDate(best.date) : undefined}
        />
      </StatGrid>

      <Section title="Fases del sueño">
        <Chart option={stagesOption} height={300} ariaLabel="Fases del sueño por noche" />
      </Section>

      {data.last ? (
        <Section title={`Hipnograma · ${formatLongDate(data.last.date)}`}>
          {data.hypnogram.length ? (
            <Chart option={hypnogramOption} height={240} ariaLabel="Hipnograma de la última noche" />
          ) : (
            <Empty title="Sin detalle por minuto">
              El export no incluye SLEEP_MINUTE para esta noche.
            </Empty>
          )}
          {worst ? (
            <p className="muted small">
              Noche más corta del periodo: {formatLongDate(worst.date)} con {formatMinutes(worst.totalMin)}.
            </p>
          ) : null}
        </Section>
      ) : null}
    </>
  )
}

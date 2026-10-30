import { useMemo, useState } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import type { HealthStore } from '../../db/store'
import { addDays, formatShortDate, todayISO } from '../../lib/date'
import { km, num } from '../../lib/format'
import { average, fillByDate, movingAverage, sum } from '../../lib/series'
import { AXIS_LABEL, AXIS_LINE, Chart, PALETTE, SPLIT_LINE, TOOLTIP } from '../Chart'
import { Card, Empty, RangePicker, Section, StatGrid } from '../components'

interface ViewProps {
  store: HealthStore
  version: number
}

const RANGES = [
  { value: 30, label: '30 días' },
  { value: 90, label: '90 días' },
  { value: 365, label: '1 año' },
]

export function ActivityView({ store, version }: ViewProps) {
  const [range, setRange] = useState(90)

  const data = useMemo(() => {
    const to = todayISO()
    const from = addDays(to, -(range - 1))
    const rows = store.getDailyActivity(from, to)
    return { to, from, rows, aligned: fillByDate(from, to, rows) }
  }, [store, version, range])

  const steps = data.aligned.map((entry) => entry.row?.steps ?? null)
  const distance = data.aligned.map((entry) => entry.row?.distanceM ?? null)
  const calories = data.aligned.map((entry) => entry.row?.calories ?? null)
  const labels = data.aligned.map((entry) => formatShortDate(entry.date))

  const totalSteps = sum(steps)
  const avgSteps = average(steps)
  const totalDistance = sum(distance)
  const avgCalories = average(calories)

  const stepsOption = useMemo<EChartsCoreOption>(() => {
    const trend = movingAverage(steps, 7)
    return {
      grid: { left: 50, right: 16, top: 24, bottom: 30 },
      legend: { top: 0, textStyle: { color: '#94a3b8', fontSize: 11 }, icon: 'roundRect' },
      tooltip: { ...TOOLTIP, trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { ...AXIS_LABEL, hideOverlap: true },
        axisLine: AXIS_LINE,
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: AXIS_LABEL,
        splitLine: SPLIT_LINE,
        axisLine: { show: false },
      },
      series: [
        {
          name: 'Pasos',
          type: 'bar',
          data: steps,
          barMaxWidth: 18,
          itemStyle: { color: 'rgba(13, 148, 136, 0.55)', borderRadius: [3, 3, 0, 0] },
        },
        {
          name: 'Media 7 días',
          type: 'line',
          data: trend,
          smooth: true,
          showSymbol: false,
          lineStyle: { color: PALETTE[3], width: 2 },
          itemStyle: { color: PALETTE[3] },
        },
      ],
    }
  }, [steps, labels])

  const distanceOption = useMemo<EChartsCoreOption>(() => {
    return {
      grid: { left: 50, right: 50, top: 24, bottom: 30 },
      legend: { top: 0, textStyle: { color: '#94a3b8', fontSize: 11 }, icon: 'roundRect' },
      tooltip: { ...TOOLTIP, trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { ...AXIS_LABEL, hideOverlap: true },
        axisLine: AXIS_LINE,
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: 'km',
          nameTextStyle: { color: '#94a3b8', fontSize: 10 },
          axisLabel: AXIS_LABEL,
          splitLine: SPLIT_LINE,
          axisLine: { show: false },
        },
        {
          type: 'value',
          name: 'kcal',
          nameTextStyle: { color: '#94a3b8', fontSize: 10 },
          axisLabel: AXIS_LABEL,
          splitLine: { show: false },
          axisLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Distancia',
          type: 'line',
          data: distance.map((value) => (value == null ? null : Math.round((value / 1000) * 100) / 100)),
          smooth: true,
          showSymbol: false,
          lineStyle: { color: PALETTE[1], width: 2 },
          itemStyle: { color: PALETTE[1] },
          areaStyle: { color: 'rgba(14, 165, 233, 0.14)' },
        },
        {
          name: 'Calorías',
          type: 'bar',
          yAxisIndex: 1,
          data: calories,
          barMaxWidth: 14,
          itemStyle: { color: 'rgba(245, 158, 11, 0.45)', borderRadius: [3, 3, 0, 0] },
        },
      ],
    }
  }, [distance, calories, labels])

  if (!data.rows.length) {
    return (
      <Empty title="Sin datos de actividad en este periodo">
        Importa el export de Zepp desde Ajustes o cambia el periodo.
      </Empty>
    )
  }

  return (
    <>
      <div className="view-head">
        <RangePicker value={range} options={RANGES} onChange={setRange} />
      </div>

      <StatGrid>
        <Card label="Pasos totales" value={num(totalSteps)} hint={`${data.rows.length} días con datos`} />
        <Card label="Media diaria" value={num(avgSteps)} unit=" pasos" hint="días con registro" />
        <Card label="Distancia" value={km(totalDistance)} hint="suma del periodo" />
        <Card label="Calorías activas" value={num(avgCalories)} unit=" kcal/día" hint="media diaria" />
      </StatGrid>

      <Section title="Pasos y tendencia">
        <Chart option={stepsOption} height={280} ariaLabel="Pasos diarios y media móvil" />
      </Section>

      <Section title="Distancia y calorías">
        <Chart option={distanceOption} height={280} ariaLabel="Distancia y calorías diarias" />
      </Section>
    </>
  )
}

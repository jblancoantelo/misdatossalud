import { useMemo } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import type { HealthStore } from '../../db/store'
import { formatShortDate } from '../../lib/date'
import { km, num } from '../../lib/format'
import { average, fillByDate, movingAverage, sum } from '../../lib/series'
import { AXIS_LABEL, AXIS_LINE, Chart, PALETTE, SPLIT_LINE, TOOLTIP } from '../Chart'
import { Card, DataTable, Empty, Section, StatGrid, type DateRange } from '../components'

interface ViewProps {
  store: HealthStore
  version: number
  range: DateRange
}

export function ActivityView({ store, version, range }: ViewProps) {
  const { from, to } = range

  const data = useMemo(() => {
    const rows = store.getDailyActivity(from, to)
    const metrics = store.getDailyMetrics(from, to)
    const metricsByDate = new Map<string, Record<string, number>>()
    for (const metric of metrics) {
      const bucket = metricsByDate.get(metric.date) ?? {}
      bucket[metric.metric] = metric.value
      metricsByDate.set(metric.date, bucket)
    }
    const metricDates = [...metricsByDate.keys()].sort()
    const latestMetric = (key: string) => {
      for (let index = metricDates.length - 1; index >= 0; index -= 1) {
        const value = metricsByDate.get(metricDates[index])?.[key]
        if (value != null) return value
      }
      return null
    }
    const latestActiveMinutes = (() => {
      for (let index = metricDates.length - 1; index >= 0; index -= 1) {
        const bucket = metricsByDate.get(metricDates[index])
        if (!bucket) continue
        const total = ['light', 'moderate', 'vigorous'].reduce(
          (sum, level) => sum + (bucket[`active_minutes_${level}`] ?? 0),
          0,
        )
        if (total > 0) return total
      }
      return null
    })()
    const recentMetrics = metricDates
      .slice(-14)
      .reverse()
      .map((date) => {
        const bucket = metricsByDate.get(date) ?? {}
        return {
          date,
          floors: bucket.floors ?? null,
          activeMinutes: ['light', 'moderate', 'vigorous'].reduce(
            (sum, level) => sum + (bucket[`active_minutes_${level}`] ?? 0),
            0,
          ),
          oxygen: bucket.oxygen_saturation ?? null,
          vo2: bucket.vo2_max ?? null,
        }
      })
    return {
      to,
      from,
      rows,
      aligned: fillByDate(from, to, rows),
      metrics: {
        count: metrics.length,
        floors: latestMetric('floors'),
        activeMinutes: latestActiveMinutes,
        oxygen: latestMetric('oxygen_saturation'),
        vo2: latestMetric('vo2_max'),
        recent: recentMetrics,
      },
    }
  }, [store, version, from, to])

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

      {data.metrics.count ? (
        <Section title="Otras métricas (Google Health)">
          <StatGrid>
            <Card label="Pisos" value={num(data.metrics.floors, 0)} hint="último día" />
            <Card
              label="Minutos activos"
              value={num(data.metrics.activeMinutes, 0)}
              unit=" min"
              hint="último día"
            />
            <Card label="Oxígeno" value={num(data.metrics.oxygen, 0)} unit=" %" hint="media diaria" />
            <Card label="VO2 máximo" value={num(data.metrics.vo2, 1)} hint="último registro" />
          </StatGrid>

          <DataTable
            rows={data.metrics.recent}
            getKey={(row) => row.date}
            max={14}
            columns={[
              { key: 'date', label: 'Fecha', render: (row) => formatShortDate(row.date) },
              { key: 'floors', label: 'Pisos', align: 'right', render: (row) => num(row.floors) },
              {
                key: 'active',
                label: 'Min. activos',
                align: 'right',
                render: (row) => num(row.activeMinutes),
              },
              {
                key: 'oxygen',
                label: 'Oxígeno',
                align: 'right',
                render: (row) => `${num(row.oxygen, 0)} %`,
              },
              { key: 'vo2', label: 'VO2 máx', align: 'right', render: (row) => num(row.vo2, 1) },
            ]}
          />
        </Section>
      ) : null}
    </>
  )
}

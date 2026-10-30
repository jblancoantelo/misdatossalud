import { useMemo, useState } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import type { HealthStore } from '../../db/store'
import { sportLabel } from '../../db/store'
import { addDays, formatDateTime, formatMinutes, todayISO } from '../../lib/date'
import { km, num, pace } from '../../lib/format'
import { AXIS_LABEL, AXIS_LINE, Chart, PALETTE, SPLIT_LINE, TOOLTIP } from '../Chart'
import { Card, DataTable, Empty, RangePicker, Section, StatGrid } from '../components'

interface ViewProps {
  store: HealthStore
  version: number
}

const RANGES = [
  { value: 90, label: '90 días' },
  { value: 365, label: '1 año' },
  { value: 0, label: 'Todo' },
]

export function SportView({ store, version }: ViewProps) {
  const [range, setRange] = useState(90)

  const data = useMemo(() => {
    const to = todayISO()
    const from = range > 0 ? addDays(to, -(range - 1)) : undefined
    const sessions = store.getSports(1000, from, to)
    return { sessions, to }
  }, [store, version, range])

  const totalMinutes = data.sessions.reduce((total, session) => total + (session.durationS ?? 0) / 60, 0)
  const totalDistance = data.sessions.reduce((total, session) => total + (session.distanceM ?? 0), 0)
  const totalCalories = data.sessions.reduce((total, session) => total + (session.calories ?? 0), 0)

  const monthlyOption = useMemo<EChartsCoreOption>(() => {
    const buckets = new Map<string, { minutes: number; distance: number }>()
    for (const session of data.sessions) {
      const month = session.date.slice(0, 7)
      const bucket = buckets.get(month) ?? { minutes: 0, distance: 0 }
      bucket.minutes += (session.durationS ?? 0) / 60
      bucket.distance += (session.distanceM ?? 0) / 1000
      buckets.set(month, bucket)
    }
    const months = [...buckets.keys()].sort()
    return {
      grid: { left: 46, right: 50, top: 24, bottom: 30 },
      legend: { top: 0, textStyle: { color: '#94a3b8', fontSize: 11 }, icon: 'roundRect' },
      tooltip: { ...TOOLTIP, trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: months,
        axisLabel: { ...AXIS_LABEL, hideOverlap: true },
        axisLine: AXIS_LINE,
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: 'h',
          nameTextStyle: { color: '#94a3b8', fontSize: 10 },
          axisLabel: AXIS_LABEL,
          splitLine: SPLIT_LINE,
          axisLine: { show: false },
        },
        {
          type: 'value',
          name: 'km',
          nameTextStyle: { color: '#94a3b8', fontSize: 10 },
          axisLabel: AXIS_LABEL,
          splitLine: { show: false },
          axisLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Horas',
          type: 'bar',
          data: months.map((month) => Math.round((buckets.get(month)?.minutes ?? 0) / 6) / 10),
          barMaxWidth: 26,
          itemStyle: { color: PALETTE[0], borderRadius: [4, 4, 0, 0] },
        },
        {
          name: 'Distancia',
          type: 'line',
          yAxisIndex: 1,
          data: months.map((month) => Math.round((buckets.get(month)?.distance ?? 0) * 10) / 10),
          smooth: true,
          showSymbol: true,
          symbolSize: 5,
          lineStyle: { color: PALETTE[3], width: 2 },
          itemStyle: { color: PALETTE[3] },
        },
      ],
    }
  }, [data.sessions])

  if (!data.sessions.length) {
    return (
      <Empty title="Sin entrenamientos en este periodo">
        Zepp registra aquí las sesiones de deporte del export.
      </Empty>
    )
  }

  return (
    <>
      <div className="view-head">
        <RangePicker value={range} options={RANGES} onChange={setRange} />
      </div>

      <StatGrid>
        <Card label="Sesiones" value={num(data.sessions.length)} hint={range > 0 ? `últimos ${range} días` : 'histórico completo'} />
        <Card label="Tiempo" value={formatMinutes(totalMinutes)} hint="tiempo total" />
        <Card label="Distancia" value={km(totalDistance)} hint="suma de sesiones" />
        <Card label="Calorías" value={num(totalCalories)} unit=" kcal" hint="suma de sesiones" />
      </StatGrid>

      <Section title="Carga por mes">
        <Chart option={monthlyOption} height={260} ariaLabel="Horas y distancia por mes" />
      </Section>

      <Section title="Sesiones">
        <DataTable
          rows={data.sessions}
          getKey={(row) => `${row.startTs}-${row.type}`}
          max={200}
          columns={[
            { key: 'date', label: 'Fecha', render: (row) => formatDateTime(row.startTs) },
            { key: 'type', label: 'Tipo', render: (row) => sportLabel(row.type) },
            {
              key: 'duration',
              label: 'Duración',
              align: 'right',
              render: (row) => formatMinutes(row.durationS ? row.durationS / 60 : null),
            },
            { key: 'distance', label: 'Distancia', align: 'right', render: (row) => km(row.distanceM) },
            {
              key: 'pace',
              label: 'Ritmo',
              align: 'right',
              render: (row) => (row.avgPace && row.avgPace > 0 ? pace(row.avgPace) : '—'),
            },
            { key: 'kcal', label: 'kcal', align: 'right', render: (row) => num(row.calories) },
          ]}
        />
      </Section>
    </>
  )
}

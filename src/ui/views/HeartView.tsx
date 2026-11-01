import { useMemo } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import type { HealthStore } from '../../db/store'
import { daysBetween, formatShortDate } from '../../lib/date'
import { num } from '../../lib/format'
import { fillByDate } from '../../lib/series'
import { AXIS_LABEL, AXIS_LINE, Chart, PALETTE, SPLIT_LINE, TOOLTIP } from '../Chart'
import { Card, Empty, Section, StatGrid, type DateRange } from '../components'

interface ViewProps {
  store: HealthStore
  version: number
  range: DateRange
}

export function HeartView({ store, version, range }: ViewProps) {
  const { from, to } = range

  const data = useMemo(() => {
    const days = store.getHeartDays(from, to)
    const hourly = store.getHourlyHeart(from, to)
    return { to, from, days, hourly, aligned: fillByDate(from, to, days) }
  }, [store, version, from, to])

  const samples = data.days.reduce((total, day) => total + day.samples, 0)
  const weighted =
    samples > 0 ? data.days.reduce((total, day) => total + day.avg * day.samples, 0) / samples : null
  const min = data.days.length ? Math.min(...data.days.map((day) => day.min)) : null
  const max = data.days.length ? Math.max(...data.days.map((day) => day.max)) : null

  const dailyOption = useMemo<EChartsCoreOption>(() => {
    const labels = data.aligned.map((entry) => formatShortDate(entry.date))
    const pick = (key: 'min' | 'avg' | 'max') =>
      data.aligned.map((entry) => (entry.row ? entry.row[key] : null))
    return {
      grid: { left: 44, right: 16, top: 26, bottom: 30 },
      legend: { top: 0, textStyle: { color: '#94a3b8', fontSize: 11 }, icon: 'roundRect' },
      tooltip: {
        ...TOOLTIP,
        trigger: 'axis',
        valueFormatter: (value: unknown) => (typeof value === 'number' ? `${value} ppm` : 'sin datos'),
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
        min: (value: { min: number }) => Math.max(30, Math.floor(value.min - 8)),
        axisLabel: AXIS_LABEL,
        splitLine: SPLIT_LINE,
        axisLine: { show: false },
      },
      series: [
        {
          name: 'Máxima',
          type: 'line',
          data: pick('max'),
          smooth: true,
          showSymbol: false,
          lineStyle: { color: PALETTE[4], width: 1.5 },
          itemStyle: { color: PALETTE[4] },
        },
        {
          name: 'Media',
          type: 'line',
          data: pick('avg'),
          smooth: true,
          showSymbol: false,
          lineStyle: { color: PALETTE[0], width: 2.5 },
          itemStyle: { color: PALETTE[0] },
          areaStyle: { color: 'rgba(13, 148, 136, 0.12)' },
        },
        {
          name: 'Mínima',
          type: 'line',
          data: pick('min'),
          smooth: true,
          showSymbol: false,
          lineStyle: { color: PALETTE[1], width: 1.5 },
          itemStyle: { color: PALETTE[1] },
        },
      ],
    }
  }, [data.aligned])

  const hourlyOption = useMemo<EChartsCoreOption>(() => {
    const byHour = new Map(data.hourly.map((row) => [row.hour, row.avg]))
    return {
      grid: { left: 44, right: 16, top: 18, bottom: 30 },
      tooltip: {
        ...TOOLTIP,
        trigger: 'axis',
        valueFormatter: (value: unknown) => (typeof value === 'number' ? `${value} ppm` : 'sin datos'),
      },
      xAxis: {
        type: 'category',
        data: Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}h`),
        axisLabel: { ...AXIS_LABEL, interval: 2 },
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
          name: 'Media por hora',
          type: 'bar',
          data: Array.from({ length: 24 }, (_, hour) => byHour.get(hour) ?? null),
          barMaxWidth: 16,
          itemStyle: { color: PALETTE[1], borderRadius: [3, 3, 0, 0] },
        },
      ],
    }
  }, [data.hourly])

  if (!data.days.length) {
    return (
      <Empty title="Sin datos de frecuencia cardiaca">
        Importa el export de Zepp o sincroniza Google Health desde Ajustes.
      </Empty>
    )
  }

  return (
    <>
      <StatGrid>
        <Card label="Media" value={num(weighted)} unit=" ppm" hint={`${num(samples)} muestras`} />
        <Card label="Mínima" value={num(min)} unit=" ppm" hint="valor puntual más bajo" />
        <Card label="Máxima" value={num(max)} unit=" ppm" hint="valor puntual más alto" />
        <Card label="Días con registro" value={num(data.days.length)} hint={`de ${daysBetween(from, to) + 1} días`} />
      </StatGrid>

      <Section title="Mínima, media y máxima por día">
        <Chart option={dailyOption} height={300} ariaLabel="Frecuencia cardiaca diaria" />
      </Section>

      <Section title="Perfil horario">
        <Chart option={hourlyOption} height={260} ariaLabel="Frecuencia cardiaca media por hora" />
      </Section>
    </>
  )
}

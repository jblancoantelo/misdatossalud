import { useMemo } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import type { HealthStore } from '../../db/store'
import { formatShortDate } from '../../lib/date'
import { num } from '../../lib/format'
import { AXIS_LABEL, AXIS_LINE, Chart, PALETTE, SPLIT_LINE, TOOLTIP } from '../Chart'
import { Card, DataTable, Empty, Section, StatGrid } from '../components'

interface ViewProps {
  store: HealthStore
  version: number
}

export function BodyView({ store, version }: ViewProps) {
  const rows = useMemo(() => store.getBodyMeasurements(500), [store, version])
  const latest = rows.length ? rows[rows.length - 1] : null

  const option = useMemo<EChartsCoreOption>(() => {
    const withWeight = rows.filter((row) => row.weightKg != null)
    return {
      grid: { left: 46, right: 50, top: 26, bottom: 30 },
      legend: { top: 0, textStyle: { color: '#94a3b8', fontSize: 11 }, icon: 'roundRect' },
      tooltip: { ...TOOLTIP, trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: withWeight.map((row) => formatShortDate(row.date)),
        axisLabel: { ...AXIS_LABEL, hideOverlap: true },
        axisLine: AXIS_LINE,
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: 'kg',
          nameTextStyle: { color: '#94a3b8', fontSize: 10 },
          scale: true,
          axisLabel: AXIS_LABEL,
          splitLine: SPLIT_LINE,
          axisLine: { show: false },
        },
        {
          type: 'value',
          name: '%',
          nameTextStyle: { color: '#94a3b8', fontSize: 10 },
          scale: true,
          axisLabel: AXIS_LABEL,
          splitLine: { show: false },
          axisLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Peso',
          type: 'line',
          data: withWeight.map((row) => row.weightKg),
          smooth: true,
          showSymbol: withWeight.length < 40,
          symbolSize: 5,
          lineStyle: { color: PALETTE[0], width: 2.5 },
          itemStyle: { color: PALETTE[0] },
          areaStyle: { color: 'rgba(13, 148, 136, 0.12)' },
        },
        {
          name: 'Grasa',
          type: 'line',
          yAxisIndex: 1,
          data: withWeight.map((row) => (row.fatRate && row.fatRate > 0 ? row.fatRate : null)),
          smooth: true,
          showSymbol: false,
          lineStyle: { color: PALETTE[3], width: 1.8, type: 'dashed' },
          itemStyle: { color: PALETTE[3] },
        },
      ],
    }
  }, [rows])

  if (!rows.length) {
    return (
      <Empty title="Sin medidas corporales">
        El export de Zepp incluye peso y composición corporal si usas báscula o los registras a mano.
      </Empty>
    )
  }

  return (
    <>
      <StatGrid>
        <Card label="Peso" value={num(latest?.weightKg, 1)} unit=" kg" hint={latest ? formatShortDate(latest.date) : undefined} />
        <Card label="IMC" value={num(latest?.bmi, 1)} hint="último registro" />
        <Card label="Grasa corporal" value={num(latest?.fatRate, 1)} unit=" %" hint="último registro" />
        <Card label="Masa muscular" value={num(latest?.muscleRate, 1)} unit=" %" hint="último registro" />
      </StatGrid>

      <Section title="Evolución del peso">
        <Chart option={option} height={300} ariaLabel="Evolución del peso y la grasa corporal" />
      </Section>

      <Section title="Últimas medidas">
        <DataTable
          rows={[...rows].reverse()}
          getKey={(row) => row.ts}
          max={20}
          columns={[
            { key: 'date', label: 'Fecha', render: (row) => formatShortDate(row.date) },
            { key: 'weight', label: 'Peso', align: 'right', render: (row) => `${num(row.weightKg, 1)} kg` },
            { key: 'bmi', label: 'IMC', align: 'right', render: (row) => num(row.bmi, 1) },
            { key: 'fat', label: 'Grasa', align: 'right', render: (row) => `${num(row.fatRate, 1)} %` },
            { key: 'muscle', label: 'Músculo', align: 'right', render: (row) => `${num(row.muscleRate, 1)} %` },
            { key: 'water', label: 'Agua', align: 'right', render: (row) => `${num(row.bodyWaterRate, 1)} %` },
            { key: 'visceral', label: 'Visceral', align: 'right', render: (row) => num(row.visceralFat) },
          ]}
        />
      </Section>
    </>
  )
}

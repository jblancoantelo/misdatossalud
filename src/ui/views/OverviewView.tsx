import { useMemo } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import type { HealthStore } from '../../db/store'
import { sportLabel } from '../../db/store'
import { addDays, daysBetween, formatLongDate, formatMinutes, formatShortDate, formatWeekday, toHours } from '../../lib/date'
import { km, num } from '../../lib/format'
import { eachDate, fillByDate } from '../../lib/series'
import { AXIS_LABEL, AXIS_LINE, Chart, PALETTE, SPLIT_LINE, TOOLTIP } from '../Chart'
import { Card, DataTable, Empty, Section, StatGrid, type DateRange } from '../components'

interface ViewProps {
  store: HealthStore
  version: number
  range: DateRange
}

export function OverviewView({ store, version, range }: ViewProps) {
  const { from, to } = range

  const data = useMemo(() => {
    const days = daysBetween(from, to) + 1
    const previousTo = addDays(from, -1)
    const previousFrom = addDays(previousTo, -(days - 1))
    const current = store.periodStats(from, to)
    const previous = store.periodStats(previousFrom, previousTo)
    const activity = store.getDailyActivity(from, to)
    const sleep = store.getSleepNights(from, to)
    const sports = store.getSports(1000, from, to)
    const lastSleepDate = store.getLatestSleepDate()
    const lastNight = lastSleepDate
      ? (store.getSleepNights(lastSleepDate, lastSleepDate)[0] ?? null)
      : null
    return {
      from,
      to,
      days,
      summary: { current, previous },
      activity,
      sleep,
      sports,
      lastNight,
    }
  }, [store, version, from, to])

  const { summary, activity, sleep, lastNight } = data
  const current = summary.current
  const previous = summary.previous

  const stepsOption = useMemo<EChartsCoreOption>(() => {
    const aligned = fillByDate(data.from, data.to, activity)
    const values = aligned.map((entry) => entry.row?.steps ?? null)
    const valid = values.filter((value): value is number => value != null)
    const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null
    return {
      grid: { left: 46, right: 14, top: 18, bottom: 26 },
      tooltip: {
        ...TOOLTIP,
        trigger: 'axis',
        valueFormatter: (value: unknown) =>
          typeof value === 'number' ? `${num(value)} pasos` : 'sin datos',
      },
      xAxis: {
        type: 'category',
        data: aligned.map((entry) => formatShortDate(entry.date)),
        axisLabel: AXIS_LABEL,
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
          data: values,
          barMaxWidth: 24,
          itemStyle: { color: PALETTE[0], borderRadius: [4, 4, 0, 0] },
          markLine:
            avg == null
              ? undefined
              : {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { color: PALETTE[3], type: 'dashed' },
                  label: {
                    formatter: `media ${num(avg)}`,
                    color: PALETTE[3],
                    fontSize: 10,
                    position: 'insideEndTop',
                  },
                  data: [{ yAxis: Math.round(avg) }],
                },
        },
      ],
    }
  }, [activity, data.from, data.to])

  const sleepOption = useMemo<EChartsCoreOption>(() => {
    const aligned = fillByDate(data.from, data.to, sleep)
    return {
      grid: { left: 40, right: 14, top: 18, bottom: 26 },
      tooltip: {
        ...TOOLTIP,
        trigger: 'axis',
        valueFormatter: (value: unknown) =>
          typeof value === 'number' ? `${num(value, 1)} h` : 'sin datos',
      },
      xAxis: {
        type: 'category',
        data: aligned.map((entry) => formatShortDate(entry.date)),
        axisLabel: AXIS_LABEL,
        axisLine: AXIS_LINE,
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { ...AXIS_LABEL, formatter: '{value} h' },
        splitLine: SPLIT_LINE,
        axisLine: { show: false },
      },
      series: [
        {
          name: 'Sueño',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: aligned.map((entry) => toHours(entry.row?.totalMin ?? null)),
          lineStyle: { color: PALETTE[2], width: 2.5 },
          itemStyle: { color: PALETTE[2] },
          areaStyle: { color: 'rgba(139, 92, 246, 0.16)' },
        },
      ],
    }
  }, [sleep, data.from, data.to])

  const hasData = activity.length > 0 || sleep.length > 0

  if (!hasData) {
    return (
      <Empty title="Sin datos en este periodo">
        Cambia el rango de fechas en la barra superior o importa el export de Zepp desde{' '}
        <strong>Ajustes</strong>.
      </Empty>
    )
  }

  const stageTotal =
    (lastNight?.deepMin ?? 0) + (lastNight?.lightMin ?? 0) + (lastNight?.remMin ?? 0) + (lastNight?.wakeMin ?? 0)

  return (
    <>
      <Section title={data.days === 1 ? 'Resumen del día' : `Resumen de ${data.days} días`}>
        <StatGrid>
          <Card
            label="Pasos al día"
            value={num(current.stepsAvg)}
            delta={current.stepsAvg != null && previous.stepsAvg != null ? current.stepsAvg - previous.stepsAvg : null}
            hint="vs. periodo anterior"
          />
          <Card
            label="Sueño por noche"
            value={toHours(current.sleepAvgMin)?.toLocaleString('es-ES') ?? '—'}
            unit=" h"
            delta={
              current.sleepAvgMin != null && previous.sleepAvgMin != null
                ? Number(((current.sleepAvgMin - previous.sleepAvgMin) / 60).toFixed(1))
                : null
            }
            hint="vs. periodo anterior"
          />
          <Card
            label="Frecuencia cardiaca"
            value={num(current.heartAvg)}
            unit=" ppm"
            delta={current.heartAvg != null && previous.heartAvg != null ? current.heartAvg - previous.heartAvg : null}
            goodWhenUp={false}
            hint="media, vs. periodo anterior"
          />
          <Card
            label="Entrenamientos"
            value={num(current.sportCount)}
            delta={current.sportCount - previous.sportCount}
            hint={`${Math.round(current.sportMinutes)} min en el periodo`}
          />
        </StatGrid>
      </Section>

      <div className="two-col">
        <Section title="Pasos por día">
          <Chart option={stepsOption} height={240} ariaLabel="Gráfico de pasos diarios" />
        </Section>
        <Section title="Sueño por noche">
          <Chart option={sleepOption} height={240} ariaLabel="Gráfico de horas de sueño" />
        </Section>
      </div>

      {lastNight ? (
        <Section title={`Última noche · ${formatLongDate(lastNight.date)}`}>
          <div className="night">
            <div className="night-total">
              <span className="night-hours">{toHours(lastNight.totalMin)?.toLocaleString('es-ES') ?? '—'}</span>
              <span className="muted">horas dormidas</span>
              {lastNight.startTs && lastNight.endTs ? (
                <span className="muted small">
                  {new Date(lastNight.startTs * 1000).toLocaleTimeString('es-ES', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {' → '}
                  {new Date(lastNight.endTs * 1000).toLocaleTimeString('es-ES', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              ) : null}
            </div>
            <div className="stages">
              {[
                { label: 'Profundo', value: lastNight.deepMin, color: '#1d4ed8' },
                { label: 'Ligero', value: lastNight.lightMin, color: '#0ea5e9' },
                { label: 'REM', value: lastNight.remMin, color: '#8b5cf6' },
                { label: 'Despierto', value: lastNight.wakeMin, color: '#f59e0b' },
              ].map((stage) => (
                <div className="stage-row" key={stage.label}>
                  <span className="stage-label">{stage.label}</span>
                  <div className="stage-track">
                    <div
                      className="stage-fill"
                      style={{
                        width: stageTotal ? `${Math.round(((stage.value ?? 0) / stageTotal) * 100)}%` : '0%',
                        background: stage.color,
                      }}
                    />
                  </div>
                  <span className="stage-value">{formatMinutes(stage.value ?? null)}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>
      ) : null}

      <div className="two-col">
        <Section title="Día a día">
          <DataTable
            rows={eachDate(data.from, data.to).reverse().map((date) => ({
              date,
              steps: activity.find((row) => row.date === date)?.steps ?? null,
              sleep: sleep.find((row) => row.date === date)?.totalMin ?? null,
              sport: data.sports.filter((row) => row.date === date).length,
            }))}
            getKey={(row) => row.date}
            max={31}
            columns={[
              {
                key: 'date',
                label: 'Día',
                render: (row) => (
                  <span>
                    <strong>{formatWeekday(row.date)}</strong>{' '}
                    <span className="muted small">{formatShortDate(row.date)}</span>
                  </span>
                ),
              },
              { key: 'steps', label: 'Pasos', align: 'right', render: (row) => num(row.steps) },
              { key: 'sleep', label: 'Sueño', align: 'right', render: (row) => formatMinutes(row.sleep) },
              { key: 'sport', label: 'Dep.', align: 'right', render: (row) => (row.sport ? row.sport : '—') },
            ]}
          />
        </Section>

        <Section title="Entrenamientos del periodo">
          {data.sports.length ? (
            <DataTable
              rows={data.sports}
              getKey={(row) => `${row.startTs}-${row.type}`}
              max={20}
              columns={[
                {
                  key: 'date',
                  label: 'Día',
                  render: (row) => formatShortDate(row.date),
                },
                {
                  key: 'type',
                  label: 'Tipo',
                  render: (row) => sportLabel(row.type),
                },
                {
                  key: 'duration',
                  label: 'Duración',
                  align: 'right',
                  render: (row) => formatMinutes(row.durationS ? row.durationS / 60 : null),
                },
                {
                  key: 'distance',
                  label: 'Distancia',
                  align: 'right',
                  render: (row) => km(row.distanceM),
                },
              ]}
            />
          ) : (
            <Empty title="Sin entrenamientos registrados" />
          )}
        </Section>
      </div>
    </>
  )
}

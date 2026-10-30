import { useMemo } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import type { HealthStore } from '../../db/store'
import { sportLabel } from '../../db/store'
import { addDays, formatLongDate, formatMinutes, formatShortDate, formatWeekday, toHours, todayISO } from '../../lib/date'
import { km, num } from '../../lib/format'
import { eachDate, fillByDate } from '../../lib/series'
import { AXIS_LABEL, AXIS_LINE, Chart, PALETTE, SPLIT_LINE, TOOLTIP } from '../Chart'
import { Card, DataTable, Empty, Section, StatGrid } from '../components'

interface ViewProps {
  store: HealthStore
  version: number
}

export function OverviewView({ store, version }: ViewProps) {
  const data = useMemo(() => {
    const today = todayISO()
    const summary = store.getWeeklySummary(today)
    const from = addDays(today, -13)
    const activity = store.getDailyActivity(from, today)
    const sleep = store.getSleepNights(from, today)
    const sports = store.getSports(4)
    const coverage = store.getCoverage()
    const lastSleepDate = store.getLatestSleepDate()
    const lastNight = lastSleepDate
      ? (store.getSleepNights(lastSleepDate, lastSleepDate)[0] ?? null)
      : null
    const weekFrom = addDays(today, -6)
    const weekActivity = store.getDailyActivity(weekFrom, today)
    const weekSleep = store.getSleepNights(weekFrom, today)
    const weekSports = store.getSports(100, weekFrom, today)
    return {
      today,
      summary,
      activity,
      sleep,
      sports,
      coverage,
      lastNight,
      weekFrom,
      weekActivity,
      weekSleep,
      weekSports,
    }
  }, [store, version])

  const { summary, activity, sleep, lastNight, coverage } = data
  const current = summary.current
  const previous = summary.previous

  const stepsOption = useMemo<EChartsCoreOption>(() => {
    const aligned = fillByDate(addDays(data.today, -13), data.today, activity)
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
  }, [activity, data.today])

  const sleepOption = useMemo<EChartsCoreOption>(() => {
    const aligned = fillByDate(addDays(data.today, -13), data.today, sleep)
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
  }, [sleep, data.today])

  const hasData = coverage.activity.rows > 0 || coverage.sleep.rows > 0

  if (!hasData) {
    return (
      <Empty title="Todavía no hay datos">
        Ve a <strong>Ajustes</strong> e importa el ZIP de exportación de Zepp. También puedes
        sincronizar más adelante con Google Health.
      </Empty>
    )
  }

  const stageTotal =
    (lastNight?.deepMin ?? 0) + (lastNight?.lightMin ?? 0) + (lastNight?.remMin ?? 0) + (lastNight?.wakeMin ?? 0)

  return (
    <>
      <Section title="Últimos 7 días">
        <StatGrid>
          <Card
            label="Pasos al día"
            value={num(current.stepsAvg)}
            delta={current.stepsAvg != null && previous.stepsAvg != null ? current.stepsAvg - previous.stepsAvg : null}
            hint="vs. semana anterior"
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
            hint="vs. semana anterior"
          />
          <Card
            label="Frecuencia cardiaca"
            value={num(current.heartAvg)}
            unit=" ppm"
            delta={current.heartAvg != null && previous.heartAvg != null ? current.heartAvg - previous.heartAvg : null}
            goodWhenUp={false}
            hint="media, vs. semana anterior"
          />
          <Card
            label="Entrenamientos"
            value={num(current.sportCount)}
            delta={current.sportCount - previous.sportCount}
            hint={`${Math.round(current.sportMinutes)} min esta semana`}
          />
        </StatGrid>
      </Section>

      <div className="two-col">
        <Section title="Pasos, últimos 14 días">
          <Chart option={stepsOption} height={240} ariaLabel="Gráfico de pasos diarios" />
        </Section>
        <Section title="Sueño, últimos 14 días">
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
        <Section title="Semana día a día">
          <DataTable
            rows={eachDate(data.weekFrom, data.today).map((date) => ({
              date,
              steps: data.weekActivity.find((row) => row.date === date)?.steps ?? null,
              sleep: data.weekSleep.find((row) => row.date === date)?.totalMin ?? null,
              sport: data.weekSports.filter((row) => row.date === date).length,
            }))}
            getKey={(row) => row.date}
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

        <Section title="Últimos entrenamientos">
          {data.sports.length ? (
            <DataTable
              rows={data.sports}
              getKey={(row) => `${row.startTs}-${row.type}`}
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

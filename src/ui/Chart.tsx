import { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  CanvasRenderer,
])

/** Colores que funcionan igual en tema claro y oscuro. */
export const PALETTE = ['#0d9488', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ef4444', '#22c55e']

export const AXIS_LABEL = { color: '#94a3b8', fontSize: 11 }
export const AXIS_LINE = { lineStyle: { color: 'rgba(148, 163, 184, 0.4)' } }
export const SPLIT_LINE = { lineStyle: { color: 'rgba(148, 163, 184, 0.18)' } }
export const TOOLTIP = {
  backgroundColor: 'rgba(15, 23, 42, 0.94)',
  borderWidth: 0,
  textStyle: { color: '#e2e8f0', fontSize: 12 },
  confine: true,
}

interface ChartProps {
  option: EChartsCoreOption
  height?: number
  ariaLabel?: string
}

export function Chart({ option, height = 260, ariaLabel }: ChartProps) {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<ReturnType<typeof echarts.init> | null>(null)

  useEffect(() => {
    const element = host.current
    if (!element) return
    const chart = echarts.init(element, undefined, { renderer: 'canvas' })
    instance.current = chart
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(element)
    return () => {
      observer.disconnect()
      chart.dispose()
      instance.current = null
    }
  }, [])

  useEffect(() => {
    instance.current?.setOption(option, true)
  }, [option])

  return (
    <div
      ref={host}
      className="chart"
      style={{ height }}
      role="img"
      aria-label={ariaLabel ?? 'gráfico de datos'}
    />
  )
}

/** Detecta el tema del sistema y reacciona a cambios. */
export function useDarkMode(): boolean {
  const [dark, setDark] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (event: MediaQueryListEvent) => setDark(event.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])

  return dark
}

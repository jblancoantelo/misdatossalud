/**
 * Google Health API (spike).
 *
 * No hay backend propio: el token se obtiene con Google Identity Services en
 * el navegador (flujo implícito de token, sin refresh token) y las llamadas van
 * directas a health.googleapis.com.
 *
 * Esto es una sonda de viabilidad: comprueba OAuth, CORS y la forma real de las
 * respuestas antes de escribir la sincronización definitiva.
 */

import { addDays, todayISO } from '../lib/date'

export const GOOGLE_HEALTH_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.location.readonly',
  'https://www.googleapis.com/auth/googlehealth.profile.readonly',
]

const API_BASE = 'https://health.googleapis.com/v4'
const GIS_SRC = 'https://accounts.google.com/gsi/client'

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void
}

interface GoogleIdentity {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string
        scope: string
        callback: (response: TokenResponse) => void
        error_callback?: (error: { message?: string; type?: string }) => void
      }) => TokenClient
    }
  }
}

declare global {
  interface Window {
    google?: GoogleIdentity
  }
}

let gisPromise: Promise<void> | null = null

export function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = GIS_SRC
      script.async = true
      script.defer = true
      script.onload = () => resolve()
      script.onerror = () =>
        reject(new Error('No se pudo cargar Google Identity Services. ¿Estás sin conexión?'))
      document.head.appendChild(script)
    })
  }
  return gisPromise
}

export interface AccessToken {
  token: string
  expiresAt: number
}

export async function requestAccessToken(clientId: string): Promise<AccessToken> {
  await loadGoogleIdentity()
  const google = window.google
  if (!google) throw new Error('Google Identity Services no está disponible.')

  return new Promise<AccessToken>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_HEALTH_SCOPES.join(' '),
      callback: (response) => {
        if (response.access_token) {
          resolve({
            token: response.access_token,
            expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
          })
        } else {
          reject(new Error(response.error_description ?? response.error ?? 'Sin token de acceso.'))
        }
      },
      error_callback: (error) => reject(new Error(error.message ?? 'Ventana de Google cerrada.')),
    })
    client.requestAccessToken({ prompt: 'consent' })
  })
}

export interface ProbeCheck {
  id: string
  label: string
  method: string
  url: string
  ok: boolean
  status: number | null
  ms: number
  detail: string
  raw?: unknown
}

async function apiCall(
  token: string,
  id: string,
  label: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<ProbeCheck & { data?: unknown }> {
  const url = `${API_BASE}${path}`
  const started = performance.now()
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const ms = Math.round(performance.now() - started)
    const text = await response.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    const detail = response.ok
      ? summarise(id, data)
      : errorMessage(data) ?? `HTTP ${response.status}`
    return { id, label, method, url, ok: response.ok, status: response.status, ms, detail, raw: data, data }
  } catch (error) {
    const ms = Math.round(performance.now() - started)
    return {
      id,
      label,
      method,
      url,
      ok: false,
      status: null,
      ms,
      detail:
        'La petición no llegó a completarse. Lo más probable es que health.googleapis.com no envíe cabeceras CORS para este origen, o que no haya red.',
    }
  }
}

function errorMessage(data: unknown): string | null {
  if (data && typeof data === 'object' && 'error' in data) {
    const error = (data as { error?: { message?: string; status?: string } }).error
    if (error?.message) return error.status ? `${error.status}: ${error.message}` : error.message
  }
  return null
}

function summarise(id: string, data: unknown): string {
  const record = data as Record<string, unknown> | null
  if (!record) return 'Respuesta vacía.'
  switch (id) {
    case 'identity': {
      const legacy = record.legacyUserId
      const health = record.healthUserId
      return `Cuenta vinculada. legacyUserId=${String(legacy ?? '—')}, healthUserId=${String(health ?? '—')}`
    }
    case 'devices': {
      const devices = (record.pairedDevices as unknown[] | undefined) ?? []
      return `${devices.length} dispositivo(s) emparejado(s).`
    }
    case 'steps': {
      const points = (record.rollupDataPoints as Record<string, unknown>[] | undefined) ?? []
      let total = 0
      for (const point of points) {
        const steps = point.steps as { countSum?: string } | undefined
        total += Number(steps?.countSum ?? 0)
      }
      return `${points.length} día(s) devueltos, ${total.toLocaleString('es-ES')} pasos en total.`
    }
    case 'sleep': {
      const points = (record.dataPoints as Record<string, unknown>[] | undefined) ?? []
      if (!points.length) return 'Sin sesiones de sueño en el rango.'
      const first = points[0] as {
        sleep?: { summary?: { minutesAsleep?: string }; type?: string }
      }
      return `${points.length} sesión(es). La primera: ${first.sleep?.summary?.minutesAsleep ?? '—'} min dormidos (${first.sleep?.type ?? '—'}).`
    }
    default:
      return 'OK'
  }
}

function isoDay(offsetDays: number): string {
  // Fecha civil local: la API interpreta los rangos en hora civil del usuario.
  return addDays(todayISO(), offsetDays)
}

function civilDate(iso: string) {
  const [year, month, day] = iso.split('-').map(Number)
  return { date: { year, month, day }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } }
}

/** Ejecuta una batería de comprobaciones contra la API real. */
export async function probeGoogleHealth(token: string): Promise<ProbeCheck[]> {
  const checks: ProbeCheck[] = []

  checks.push(await apiCall(token, 'identity', 'Identidad y cuenta vinculada', 'GET', '/users/me/identity'))
  checks.push(await apiCall(token, 'devices', 'Dispositivos emparejados', 'GET', '/users/me/pairedDevices'))

  checks.push(
    await apiCall(token, 'steps', 'Pasos diarios (dailyRollUp)', 'POST', '/users/me/dataTypes/steps/dataPoints:dailyRollUp', {
      range: { start: civilDate(isoDay(-6)), end: civilDate(isoDay(0)) },
      windowSizeDays: 1,
    }),
  )

  const filter = encodeURIComponent(`sleep.interval.civil_end_time >= "${isoDay(-14)}"`)
  checks.push(
    await apiCall(
      token,
      'sleep',
      'Sueño (reconcile)',
      'GET',
      `/users/me/dataTypes/sleep/dataPoints:reconcile?pageSize=5&filter=${filter}`,
    ),
  )

  return checks
}

export function probeReport(checks: ProbeCheck[]): string {
  return checks
    .map((check) => {
      const status = check.status == null ? 'sin respuesta' : `HTTP ${check.status}`
      return `${check.ok ? 'OK  ' : 'FAIL'} ${check.label} — ${status} (${check.ms} ms)\n     ${check.detail}\n     ${check.method} ${check.url}`
    })
    .join('\n\n')
}

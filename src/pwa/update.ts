/**
 * Registro del service worker y comprobación manual de actualizaciones.
 *
 * La app se registra en modo `prompt`: cuando hay una compilación nueva, el
 * service worker queda esperando y aquí se avisa. Nada se actualiza hasta que
 * el usuario pulsa «Descargar la nueva versión».
 */

import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { isNewBuild, type RemoteVersion } from './version'

type Listener = () => void

let needRefresh = false
let offlineReady = false
let registration: ServiceWorkerRegistration | null = null
const listeners = new Set<Listener>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Activa el service worker nuevo y recarga la app. */
export const applyUpdate = registerSW({
  immediate: true,
  onNeedRefresh() {
    needRefresh = true
    emit()
  },
  onOfflineReady() {
    offlineReady = true
    emit()
  },
  onRegisteredSW(_swUrl, reg) {
    registration = reg ?? null
  },
})

/** `true` cuando hay una versión nueva ya descargada y esperando. */
export function usePwaUpdate(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => needRefresh,
    () => false,
  )
}

export function useOfflineReady(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => offlineReady,
    () => false,
  )
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  if (registration) return registration
  registration = (await navigator.serviceWorker.getRegistration()) ?? null
  return registration
}

/** Lee `version.json` de la red (nunca de la caché). */
export async function fetchRemoteVersion(): Promise<RemoteVersion | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, {
      cache: 'no-store',
    })
    if (!response.ok) return null
    const data = (await response.json()) as Partial<RemoteVersion>
    if (typeof data.version !== 'string' || typeof data.buildTime !== 'string') return null
    return { version: data.version, buildTime: data.buildTime }
  } catch {
    return null
  }
}

export type UpdateCheck =
  | { status: 'unsupported' }
  | { status: 'current' }
  | { status: 'update'; remote: RemoteVersion | null }
  | { status: 'error'; message: string }

async function waitForWaitingWorker(reg: ServiceWorkerRegistration, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (reg.waiting || needRefresh) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return Boolean(reg.waiting) || needRefresh
}

/**
 * Fuerza la comprobación: pregunta al navegador por un `sw.js` nuevo y, en
 * paralelo, compara `version.json`. Devuelve si hay algo que descargar.
 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const reg = await getRegistration()
  if (!reg) return { status: 'unsupported' }

  const remote = await fetchRemoteVersion()
  let updateError: string | null = null
  try {
    await reg.update()
  } catch (cause) {
    updateError = cause instanceof Error ? cause.message : 'No se pudo consultar el servidor.'
  }

  await waitForWaitingWorker(reg, 8000)

  if (needRefresh || reg.waiting || isNewBuild(remote)) {
    return { status: 'update', remote }
  }
  if (updateError && !remote) return { status: 'error', message: updateError }
  return { status: 'current' }
}

/**
 * Descarga y activa la versión nueva. Si el service worker aún no está
 * esperando, se le da un margen antes de recargar.
 */
export async function downloadUpdate(): Promise<void> {
  const reg = await getRegistration()
  if (reg) {
    try {
      await reg.update()
    } catch {
      // Sin red se recarga igualmente con lo que haya en caché.
    }
    await waitForWaitingWorker(reg, 10000)
  }
  await applyUpdate(true)
}

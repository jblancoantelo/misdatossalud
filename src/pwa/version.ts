/**
 * Versión instalada y comparación con la publicada.
 *
 * Sin dependencias de React ni del service worker para poder probarlo.
 */

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
export const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : ''

export interface RemoteVersion {
  version: string
  buildTime: string
}

/**
 * Hay versión nueva si la compilación publicada no es la misma que la que está
 * en ejecución. Se compara la fecha de compilación, no solo el número de
 * versión, para detectar también despliegues sin subir la versión.
 */
export function isNewBuild(remote: RemoteVersion | null, localBuildTime = BUILD_TIME): boolean {
  if (!remote || !remote.buildTime) return false
  return remote.buildTime !== localBuildTime
}

/** `20261102-213045` → `02/11/2026 21:30`. */
export function formatBuildTime(value: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(value)
  if (!match) return value
  const [, year, month, day, hours, minutes] = match
  return `${day}/${month}/${year} ${hours}:${minutes}`
}

export function versionLabel(version: string, buildTime: string): string {
  return buildTime ? `v${version} (${formatBuildTime(buildTime)})` : `v${version}`
}

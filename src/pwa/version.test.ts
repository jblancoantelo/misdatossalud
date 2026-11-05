import { describe, expect, it } from 'vitest'
import { formatBuildTime, isNewBuild, versionLabel } from './version'

describe('isNewBuild', () => {
  it('detecta una compilación publicada distinta', () => {
    expect(isNewBuild({ version: '0.1.1', buildTime: '20261103-100000' }, '20261102-213045')).toBe(true)
  })

  it('la misma compilación no es una novedad', () => {
    expect(isNewBuild({ version: '0.1.0', buildTime: '20261102-213045' }, '20261102-213045')).toBe(
      false,
    )
  })

  it('sin respuesta del servidor no anuncia nada', () => {
    expect(isNewBuild(null, '20261102-213045')).toBe(false)
    expect(isNewBuild({ version: '0.1.1', buildTime: '' }, '20261102-213045')).toBe(false)
  })
})

describe('formatBuildTime', () => {
  it('convierte el sello en fecha legible', () => {
    expect(formatBuildTime('20261102-213045')).toBe('02/11/2026 21:30')
  })

  it('deja intacto un valor desconocido', () => {
    expect(formatBuildTime('desconocido')).toBe('desconocido')
  })
})

describe('versionLabel', () => {
  it('incluye la fecha cuando existe', () => {
    expect(versionLabel('0.1.0', '20261102-213045')).toBe('v0.1.0 (02/11/2026 21:30)')
  })

  it('solo muestra la versión si no hay fecha', () => {
    expect(versionLabel('0.1.0', '')).toBe('v0.1.0')
  })
})

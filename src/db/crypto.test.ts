import { describe, expect, it } from 'vitest'
import { decryptSnapshot, encryptSnapshot, InvalidSnapshotError, isSnapshotFile } from './crypto'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

describe('snapshot cifrado', () => {
  it('cifra y descifra con la misma contraseña', async () => {
    const original = encoder.encode('datos de salud de prueba')
    const encrypted = await encryptSnapshot(original, 'contraseña-larga', 1000)

    expect(encrypted).not.toEqual(original)
    expect(isSnapshotFile(encrypted)).toBe(true)

    const decrypted = await decryptSnapshot(encrypted, 'contraseña-larga')
    expect(decoder.decode(decrypted)).toBe('datos de salud de prueba')
  })

  it('falla con otra contraseña', async () => {
    const encrypted = await encryptSnapshot(encoder.encode('x'), 'correcta-1234', 1000)
    await expect(decryptSnapshot(encrypted, 'incorrecta-1234')).rejects.toBeInstanceOf(
      InvalidSnapshotError,
    )
  })

  it('detecta manipulación del contenido', async () => {
    const encrypted = await encryptSnapshot(encoder.encode('contenido'), 'correcta-1234', 1000)
    const tampered = new Uint8Array(encrypted)
    tampered[tampered.length - 1] ^= 0xff
    await expect(decryptSnapshot(tampered, 'correcta-1234')).rejects.toBeInstanceOf(
      InvalidSnapshotError,
    )
  })

  it('detecta manipulación de la cabecera (AAD)', async () => {
    const encrypted = await encryptSnapshot(encoder.encode('contenido'), 'correcta-1234', 1000)
    const newline = encrypted.indexOf(0x0a)
    const header = decoder.decode(encrypted.subarray(0, newline))
    const tamperedHeader = encoder.encode(header.replace('"iter":1000', '"iter":1001'))
    const body = encrypted.subarray(newline + 1)
    const tampered = new Uint8Array(tamperedHeader.length + 1 + body.length)
    tampered.set(tamperedHeader, 0)
    tampered[tamperedHeader.length] = 0x0a
    tampered.set(body, tamperedHeader.length + 1)

    await expect(decryptSnapshot(tampered, 'correcta-1234')).rejects.toBeInstanceOf(
      InvalidSnapshotError,
    )
  })

  it('rechaza archivos que no son snapshots', () => {
    expect(isSnapshotFile(encoder.encode('hola'))).toBe(false)
  })
})

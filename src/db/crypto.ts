/**
 * Cifrado del snapshot local.
 *
 * Formato del fichero `.mdsalud`:
 *
 *   {"v":1,"alg":"AES-GCM-256","kdf":"PBKDF2-SHA256","iter":310000,
 *    "salt":"<base64>","iv":"<base64>"}\n
 *   <ciphertext binario>
 *
 * La cabecera JSON se usa como datos autenticados adicionales (AAD), así que
 * alterar las iteraciones o la sal invalida el descifrado.
 */

export const SNAPSHOT_MAGIC = 'MDSALUD'
export const SNAPSHOT_VERSION = 1
export const DEFAULT_ITERATIONS = 310_000
const SALT_BYTES = 16
const IV_BYTES = 12

interface SnapshotHeader {
  v: number
  alg: string
  kdf: string
  iter: number
  salt: string
  iv: string
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

export async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations = DEFAULT_ITERATIONS,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    toBuffer(new TextEncoder().encode(password)),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toBuffer(salt),
      iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptSnapshot(
  data: Uint8Array,
  password: string,
  iterations = DEFAULT_ITERATIONS,
): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(password, salt, iterations)

  const header: SnapshotHeader = {
    v: SNAPSHOT_VERSION,
    alg: 'AES-GCM-256',
    kdf: 'PBKDF2-SHA256',
    iter: iterations,
    salt: toBase64(salt),
    iv: toBase64(iv),
  }
  const headerText = JSON.stringify(header)
  const headerBytes = new TextEncoder().encode(headerText)

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: toBuffer(iv),
        additionalData: toBuffer(headerBytes),
      },
      key,
      toBuffer(data),
    ),
  )

  const out = new Uint8Array(headerBytes.length + 1 + ciphertext.length)
  out.set(headerBytes, 0)
  out[headerBytes.length] = 0x0a
  out.set(ciphertext, headerBytes.length + 1)
  return out
}

export class InvalidSnapshotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidSnapshotError'
  }
}

function splitSnapshot(bytes: Uint8Array): { header: SnapshotHeader; headerText: string; body: Uint8Array } {
  // La cabecera siempre es corta; buscamos el salto de línea en los primeros 512 bytes.
  const limit = Math.min(bytes.length, 512)
  let newline = -1
  for (let i = 0; i < limit; i += 1) {
    if (bytes[i] === 0x0a) {
      newline = i
      break
    }
  }
  if (newline < 0) throw new InvalidSnapshotError('El archivo no parece una copia de misdatossalud.')

  const headerText = new TextDecoder().decode(bytes.subarray(0, newline))
  let header: SnapshotHeader
  try {
    header = JSON.parse(headerText) as SnapshotHeader
  } catch {
    throw new InvalidSnapshotError('Cabecera del snapshot ilegible.')
  }
  if (header.v !== SNAPSHOT_VERSION || header.alg !== 'AES-GCM-256') {
    throw new InvalidSnapshotError('Versión de snapshot no soportada.')
  }
  return { header, headerText, body: bytes.subarray(newline + 1) }
}

export async function decryptSnapshot(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const { header, headerText, body } = splitSnapshot(bytes)
  const key = await deriveKey(password, fromBase64(header.salt), header.iter)
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toBuffer(fromBase64(header.iv)),
        additionalData: toBuffer(new TextEncoder().encode(headerText)),
      },
      key,
      toBuffer(body),
    )
    return new Uint8Array(plain)
  } catch {
    throw new InvalidSnapshotError('Contraseña incorrecta o archivo dañado.')
  }
}

export function isSnapshotFile(bytes: Uint8Array): boolean {
  try {
    splitSnapshot(bytes)
    return true
  } catch {
    return false
  }
}

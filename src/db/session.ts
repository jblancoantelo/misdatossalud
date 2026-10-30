import { HealthStore } from './store'
import { decryptSnapshot, encryptSnapshot } from './crypto'
import { loadSnapshot, saveSnapshot } from './storage'
import { loadSqlJs } from './sqlLoader'

export async function createEmptyStore(): Promise<HealthStore> {
  const SQL = await loadSqlJs()
  return new HealthStore(new SQL.Database())
}

export async function openSnapshot(bytes: Uint8Array, password: string): Promise<HealthStore> {
  const plain = await decryptSnapshot(bytes, password)
  const SQL = await loadSqlJs()
  return new HealthStore(new SQL.Database(plain))
}

/** Devuelve null si todavía no hay snapshot guardado. */
export async function unlockStoredSnapshot(password: string): Promise<HealthStore | null> {
  const bytes = await loadSnapshot()
  if (!bytes) return null
  return openSnapshot(bytes, password)
}

/** Cifra y guarda el snapshot. Devuelve el tamaño del fichero cifrado. */
export async function saveStore(store: HealthStore, password: string): Promise<number> {
  const snapshot = store.exportBinary()
  const encrypted = await encryptSnapshot(snapshot, password)
  await saveSnapshot(encrypted)
  store.markClean()
  return encrypted.byteLength
}

export function snapshotFileName(date = new Date()): string {
  const iso = date.toISOString().slice(0, 10)
  return `misdatossalud-${iso}.mdsalud`
}

/**
 * Persistencia del snapshot cifrado.
 *
 * Se usa OPFS (Origin Private File System) cuando está disponible y, si no,
 * IndexedDB. En ambos casos solo se guarda el blob cifrado: sin la contraseña
 * no hay nada legible en disco.
 */

const FILE_NAME = 'db.mdsalud'
const IDB_NAME = 'misdatossalud'
const IDB_STORE = 'files'
const IDB_KEY = 'snapshot'

export type StorageBackend = 'opfs' | 'indexeddb' | 'none'

function hasOpfs(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage !== 'undefined' &&
    typeof navigator.storage.getDirectory === 'function'
  )
}

async function opfsDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('misdatossalud', { create: true })
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IDB_STORE)) {
        request.result.createObjectStore(IDB_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir IndexedDB.'))
  })
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Error de IndexedDB.'))
  })
}

async function idbRead(): Promise<Uint8Array | null> {
  const db = await openIdb()
  try {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const value = await idbRequest(tx.objectStore(IDB_STORE).get(IDB_KEY))
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    if (value instanceof Uint8Array) return value
    return null
  } finally {
    db.close()
  }
}

async function idbWrite(bytes: Uint8Array): Promise<void> {
  const db = await openIdb()
  try {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    const copy = new Uint8Array(bytes)
    tx.objectStore(IDB_STORE).put(copy.buffer, IDB_KEY)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo escribir en IndexedDB.'))
      tx.onabort = () => reject(tx.error ?? new Error('Transacción cancelada.'))
    })
  } finally {
    db.close()
  }
}

async function idbDelete(): Promise<void> {
  const db = await openIdb()
  try {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).delete(IDB_KEY)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo borrar el snapshot.'))
    })
  } finally {
    db.close()
  }
}

let cachedBackend: StorageBackend | null = null

export async function storageBackend(): Promise<StorageBackend> {
  if (cachedBackend) return cachedBackend
  if (hasOpfs()) {
    try {
      await opfsDirectory()
      cachedBackend = 'opfs'
      return cachedBackend
    } catch {
      // Sin permisos de OPFS: probamos IndexedDB.
    }
  }
  if (typeof indexedDB !== 'undefined') {
    cachedBackend = 'indexeddb'
    return cachedBackend
  }
  cachedBackend = 'none'
  return cachedBackend
}

export async function saveSnapshot(bytes: Uint8Array): Promise<StorageBackend> {
  const backend = await storageBackend()
  if (backend === 'opfs') {
    const dir = await opfsDirectory()
    const handle = await dir.getFileHandle(FILE_NAME, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(bytes as unknown as BufferSource)
    } finally {
      await writable.close()
    }
    return 'opfs'
  }
  if (backend === 'indexeddb') {
    await idbWrite(bytes)
    return 'indexeddb'
  }
  throw new Error('Este navegador no permite guardar datos locales.')
}

export async function loadSnapshot(): Promise<Uint8Array | null> {
  const backend = await storageBackend()
  if (backend === 'opfs') {
    try {
      const dir = await opfsDirectory()
      const handle = await dir.getFileHandle(FILE_NAME)
      const file = await handle.getFile()
      return new Uint8Array(await file.arrayBuffer())
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return null
      throw error
    }
  }
  if (backend === 'indexeddb') return idbRead()
  return null
}

export async function snapshotExists(): Promise<boolean> {
  const backend = await storageBackend()
  if (backend === 'opfs') {
    try {
      const dir = await opfsDirectory()
      await dir.getFileHandle(FILE_NAME)
      return true
    } catch {
      return false
    }
  }
  if (backend === 'indexeddb') return (await idbRead()) !== null
  return false
}

export async function clearSnapshot(): Promise<void> {
  const backend = await storageBackend()
  if (backend === 'opfs') {
    try {
      const dir = await opfsDirectory()
      await dir.removeEntry(FILE_NAME)
    } catch {
      // Ya no existe.
    }
    return
  }
  if (backend === 'indexeddb') await idbDelete()
}

export async function snapshotSize(): Promise<number | null> {
  const backend = await storageBackend()
  if (backend === 'opfs') {
    try {
      const dir = await opfsDirectory()
      const handle = await dir.getFileHandle(FILE_NAME)
      const file = await handle.getFile()
      return file.size
    } catch {
      return null
    }
  }
  if (backend === 'indexeddb') {
    const bytes = await idbRead()
    return bytes ? bytes.byteLength : null
  }
  return null
}

export async function estimateQuota(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
  const { usage = 0, quota = 0 } = await navigator.storage.estimate()
  return { usage, quota }
}

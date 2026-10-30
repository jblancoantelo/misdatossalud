import { useCallback, useEffect, useRef, useState } from 'react'
import type { HealthStore } from '../db/store'
import { createEmptyStore, openSnapshot, saveStore, snapshotFileName, unlockStoredSnapshot } from '../db/session'
import { snapshotExists } from '../db/storage'
import { encryptSnapshot } from '../db/crypto'

export type SessionStatus = 'loading' | 'setup' | 'locked' | 'unlocked'

export interface SessionApi {
  status: SessionStatus
  store: HealthStore | null
  error: string | null
  notice: string | null
  busy: boolean
  saving: boolean
  lastSavedAt: Date | null
  version: number
  create: (password: string) => Promise<void>
  unlock: (password: string) => Promise<void>
  lock: () => void
  restore: (bytes: Uint8Array, password: string) => Promise<void>
  download: () => Promise<void>
  saveNow: () => Promise<void>
  touch: () => void
  clearNotice: () => void
}

const AUTOSAVE_MS = 4000

export function useSession(): SessionApi {
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [store, setStore] = useState<HealthStore | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [version, setVersion] = useState(0)

  const storeRef = useRef<HealthStore | null>(null)
  const passwordRef = useRef<string | null>(null)
  const savingRef = useRef(false)

  const touch = useCallback(() => setVersion((value) => value + 1), [])

  const activate = useCallback((nextStore: HealthStore, password: string) => {
    storeRef.current = nextStore
    passwordRef.current = password
    setStore(nextStore)
    setStatus('unlocked')
    setError(null)
    setVersion((value) => value + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    snapshotExists()
      .then((exists) => {
        if (cancelled) return
        setStatus(exists ? 'locked' : 'setup')
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : 'No se pudo leer el almacenamiento local.')
        setStatus('setup')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const saveNow = useCallback(async () => {
    const current = storeRef.current
    const password = passwordRef.current
    if (!current || !password || savingRef.current || !current.isDirty()) return
    savingRef.current = true
    setSaving(true)
    try {
      await saveStore(current, password)
      setLastSavedAt(new Date())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la base local.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [])

  // Autoguardado: cifra y escribe cuando hay cambios pendientes.
  useEffect(() => {
    if (status !== 'unlocked') return
    const id = window.setInterval(() => {
      void saveNow()
    }, AUTOSAVE_MS)
    return () => window.clearInterval(id)
  }, [status, saveNow])

  useEffect(() => {
    const onHide = () => {
      void saveNow()
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [saveNow])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (storeRef.current?.isDirty()) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const create = useCallback(
    async (password: string) => {
      setBusy(true)
      setError(null)
      try {
        const nextStore = await createEmptyStore()
        await saveStore(nextStore, password)
        activate(nextStore, password)
        setLastSavedAt(new Date())
        setNotice('Base local creada y cifrada.')
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'No se pudo crear la base local.')
      } finally {
        setBusy(false)
      }
    },
    [activate],
  )

  const unlock = useCallback(
    async (password: string) => {
      setBusy(true)
      setError(null)
      try {
        const nextStore = await unlockStoredSnapshot(password)
        if (!nextStore) {
          setStatus('setup')
          setError('No hay ninguna base guardada. Crea una contraseña para empezar.')
          return
        }
        activate(nextStore, password)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'No se pudo abrir la base local.')
      } finally {
        setBusy(false)
      }
    },
    [activate],
  )

  const lock = useCallback(() => {
    storeRef.current?.close()
    storeRef.current = null
    passwordRef.current = null
    setStore(null)
    setStatus('locked')
    setNotice(null)
    setError(null)
  }, [])

  const restore = useCallback(
    async (bytes: Uint8Array, password: string) => {
      setBusy(true)
      setError(null)
      try {
        const nextStore = await openSnapshot(bytes, password)
        await saveStore(nextStore, password)
        storeRef.current?.close()
        activate(nextStore, password)
        setLastSavedAt(new Date())
        setNotice('Copia restaurada. Esta base sustituye a la anterior en este dispositivo.')
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'No se pudo restaurar la copia.')
      } finally {
        setBusy(false)
      }
    },
    [activate],
  )

  const download = useCallback(async () => {
    const current = storeRef.current
    const password = passwordRef.current
    if (!current || !password) return
    setBusy(true)
    try {
      const snapshot = current.exportBinary()
      const encrypted = await encryptSnapshot(snapshot, password)
      const blob = new Blob([encrypted as unknown as BlobPart], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = snapshotFileName()
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setNotice('Copia cifrada descargada.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo generar la copia.')
    } finally {
      setBusy(false)
    }
  }, [])

  const clearNotice = useCallback(() => setNotice(null), [])

  return {
    status,
    store,
    error,
    notice,
    busy,
    saving,
    lastSavedAt,
    version,
    create,
    unlock,
    lock,
    restore,
    download,
    saveNow,
    touch,
    clearNotice,
  }
}

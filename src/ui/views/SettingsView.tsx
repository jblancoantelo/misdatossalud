import { useEffect, useMemo, useRef, useState } from 'react'
import type { HealthStore } from '../../db/store'
import type { SessionApi } from '../../state/useSession'
import { importZeppArchive, type ImportProgress, type ImportResult } from '../../import/zepp'
import { estimateQuota, snapshotSize, storageBackend, type StorageBackend } from '../../db/storage'
import { bytes, num } from '../../lib/format'
import { formatLongDate } from '../../lib/date'
import { probeGoogleHealth, probeReport, requestAccessToken, type ProbeCheck } from '../../sync/googleHealth'
import { Callout, Field, ProgressBar, Section, StatGrid, Card, DataTable } from '../components'

interface ViewProps {
  store: HealthStore
  version: number
  session: SessionApi
}

const BACKEND_LABEL: Record<StorageBackend, string> = {
  opfs: 'OPFS (sistema de archivos privado del navegador)',
  indexeddb: 'IndexedDB',
  none: 'sin almacenamiento disponible',
}

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

export function SettingsView({ store, version, session }: ViewProps) {
  const [info, setInfo] = useState<{
    backend: StorageBackend
    size: number | null
    quota: { usage: number; quota: number } | null
  } | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restorePassword, setRestorePassword] = useState('')

  const [clientId, setClientId] = useState(() => store.getMeta('google_client_id') ?? '')
  const [probeBusy, setProbeBusy] = useState(false)
  const [checks, setChecks] = useState<ProbeCheck[] | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)

  const [confirmDelete, setConfirmDelete] = useState('')
  const [deleting, setDeleting] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const backend = await storageBackend()
      const size = await snapshotSize()
      const quota = await estimateQuota()
      if (alive) setInfo({ backend, size, quota })
    })()
    return () => {
      alive = false
    }
  }, [version, session.lastSavedAt])

  const coverage = useMemo(() => store.getCoverage(), [store, version])
  const importMeta = useMemo(() => store.getImportMeta(), [store, version])
  const profile = useMemo(() => store.getProfile(), [store, version])
  const totalRows = Object.values(coverage).reduce((total, entry) => total + entry.rows, 0)

  async function runImport() {
    if (!file || importing) return
    setImporting(true)
    setImportError(null)
    setResult(null)
    setProgress({ phase: 'open', rows: 0 })
    // Deja pintar el estado antes de bloquear el hilo con el parseo.
    await new Promise((resolve) => setTimeout(resolve, 60))
    try {
      const imported = await importZeppArchive(store, file, setProgress)
      setResult(imported)
      session.touch()
      await session.saveNow()
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : 'No se pudo importar el ZIP.')
    } finally {
      setImporting(false)
      setProgress(null)
    }
  }

  async function runRestore() {
    if (!restoreFile || !restorePassword) return
    const buffer = await restoreFile.arrayBuffer()
    await session.restore(new Uint8Array(buffer), restorePassword)
    setRestoreFile(null)
    setRestorePassword('')
  }

  async function runProbe() {
    if (!clientId.trim()) {
      setProbeError('Pega primero el ID de cliente OAuth de Google Cloud.')
      return
    }
    setProbeBusy(true)
    setProbeError(null)
    setChecks(null)
    try {
      store.setMeta('google_client_id', clientId.trim())
      const token = await requestAccessToken(clientId.trim())
      const results = await probeGoogleHealth(token.token)
      setChecks(results)
    } catch (cause) {
      setProbeError(cause instanceof Error ? cause.message : 'La prueba falló.')
    } finally {
      setProbeBusy(false)
    }
  }

  async function runDelete() {
    if (confirmDelete !== 'BORRAR') return
    setDeleting(true)
    try {
      store.clearAllData()
      session.touch()
      await session.saveNow()
      setConfirmDelete('')
      setResult(null)
    } finally {
      setDeleting(false)
    }
  }

  const progressLabel = progress
    ? progress.phase === 'read'
      ? `Leyendo ${basename(progress.file ?? '')} (${progress.fileIndex}/${progress.fileCount})…`
      : progress.phase === 'insert'
        ? `${num(progress.rows)} filas importadas…`
        : 'Preparando…'
    : ''

  return (
    <>
      <Section title="Estado del almacenamiento">
        <StatGrid>
          <Card
            label="Datos guardados"
            value={info?.size ? bytes(info.size) : '—'}
            hint="snapshot cifrado en disco"
          />
          <Card label="Filas totales" value={num(totalRows)} hint="todas las tablas" />
          <Card
            label="Almacenamiento"
            value={info ? BACKEND_LABEL[info.backend].split(' ')[0] : '—'}
            hint={info?.quota ? `${bytes(info.quota.usage)} usados` : undefined}
          />
          <Card
            label="Última importación"
            value={importMeta ? formatLongDate(importMeta.importedAt.slice(0, 10)) : '—'}
            hint={importMeta ? `${num(importMeta.rows)} filas` : 'sin importar'}
          />
        </StatGrid>

        {profile ? (
          <p className="muted small">
            Perfil: {String(profile.nickname ?? '—')} · {String(profile.height_cm ?? '—')} cm ·{' '}
            {String(profile.weight_kg ?? '—')} kg
          </p>
        ) : null}

        <DataTable
          rows={[
            { key: 'activity', label: 'Actividad diaria', entry: coverage.activity },
            { key: 'minutes', label: 'Actividad por minuto', entry: coverage.minutes },
            { key: 'stages', label: 'Tramos de actividad', entry: coverage.stages },
            { key: 'heart', label: 'Frecuencia cardiaca', entry: coverage.heart },
            { key: 'sleep', label: 'Sueño por noche', entry: coverage.sleep },
            { key: 'sleepMinutes', label: 'Sueño por minuto', entry: coverage.sleepMinutes },
            { key: 'sport', label: 'Entrenamientos', entry: coverage.sport },
            { key: 'body', label: 'Cuerpo', entry: coverage.body },
          ]}
          getKey={(row) => row.key}
          columns={[
            { key: 'label', label: 'Tabla', render: (row) => row.label },
            { key: 'rows', label: 'Filas', align: 'right', render: (row) => num(row.entry.rows) },
            { key: 'first', label: 'Desde', align: 'right', render: (row) => row.entry.first ?? '—' },
            { key: 'last', label: 'Hasta', align: 'right', render: (row) => row.entry.last ?? '—' },
          ]}
        />
      </Section>

      <Section title="Importar desde Zepp">
        <p className="muted">
          Descarga el ZIP de exportación de datos desde la app Zepp y súbelo aquí. Se acepta tanto el
          export corto como el histórico completo. El archivo no sale de tu dispositivo.
        </p>

        <div className="row">
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null)
              setResult(null)
              setImportError(null)
            }}
          />
          <button type="button" className="btn primary" onClick={runImport} disabled={!file || importing}>
            {importing ? 'Importando…' : 'Importar ZIP'}
          </button>
        </div>

        {importing ? (
          <div className="import-progress">
            <ProgressBar value={progress?.fileIndex ?? 0} max={progress?.fileCount ?? 1} />
            <span className="muted small">{progressLabel}</span>
          </div>
        ) : null}

        {importError ? <Callout tone="danger">{importError}</Callout> : null}

        {result ? (
          <Callout tone="info">
            <strong>Importación completada.</strong> {num(result.totalRows)} filas.
            {result.warnings.length ? (
              <ul className="warnings">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <p className="small muted">
              Reimportar es seguro: las filas se sustituyen por su clave, no se duplican.
            </p>
          </Callout>
        ) : null}

        <Callout tone="warn">
          El histórico completo tiene cientos de miles de filas. En el móvil la importación puede
          tardar varios minutos y consumir bastante memoria. No cierres la pestaña mientras dura.
        </Callout>
      </Section>

      <Section title="Copia de seguridad">
        <p className="muted">
          El snapshot se guarda cifrado con tu contraseña. Puedes descargarlo y abrirlo en otro
          dispositivo con la misma contraseña.
        </p>
        <div className="row">
          <button type="button" className="btn" onClick={() => void session.download()} disabled={session.busy}>
            Descargar copia cifrada
          </button>
        </div>

        <h3>Restaurar una copia</h3>
        <p className="muted small">
          La copia sustituye por completo a la base de este dispositivo. No se mezclan datos entre
          dispositivos.
        </p>
        <div className="row wrap">
          <input
            type="file"
            accept=".mdsalud,application/octet-stream"
            onChange={(event) => setRestoreFile(event.target.files?.[0] ?? null)}
          />
          <input
            type="password"
            placeholder="Contraseña de la copia"
            value={restorePassword}
            onChange={(event) => setRestorePassword(event.target.value)}
            autoComplete="current-password"
          />
          <button
            type="button"
            className="btn"
            onClick={() => void runRestore()}
            disabled={!restoreFile || restorePassword.length < 8 || session.busy}
          >
            Restaurar
          </button>
        </div>
      </Section>

      <Section title="Google Health (prueba de viabilidad)">
        <p className="muted">
          Esta prueba comprueba si la Google Health API responde desde el navegador: OAuth, CORS y la
          forma real de los datos. No guarda nada todavía en la base.
        </p>

        <Callout tone="info">
          Necesitas un ID de cliente OAuth de tipo <em>aplicación web</em> en Google Cloud, con el
          origen <code>{typeof window !== 'undefined' ? window.location.origin : ''}</code> autorizado
          y la Google Health API habilitada. Al ser una app sin verificar, Google mostrará el aviso de
          «Google no ha verificado esta aplicación».
        </Callout>

        <Field label="ID de cliente OAuth" hint="Se guarda solo en esta base local.">
          <input
            type="text"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            placeholder="1234567890-xxxxxxxx.apps.googleusercontent.com"
            spellCheck={false}
          />
        </Field>

        <div className="row">
          <button type="button" className="btn primary" onClick={() => void runProbe()} disabled={probeBusy}>
            {probeBusy ? 'Conectando…' : 'Conectar y probar'}
          </button>
          {checks ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(probeReport(checks))
              }}
            >
              Copiar informe
            </button>
          ) : null}
        </div>

        {probeError ? <Callout tone="danger">{probeError}</Callout> : null}

        {checks ? (
          <div className="probe">
            {checks.map((check) => (
              <details key={check.id} className={check.ok ? 'probe-item ok' : 'probe-item fail'}>
                <summary>
                  <span className={check.ok ? 'badge ok' : 'badge fail'}>
                    {check.ok ? 'OK' : 'FALLO'}
                  </span>
                  <span className="probe-label">{check.label}</span>
                  <span className="muted small">
                    {check.status == null ? 'sin respuesta' : `HTTP ${check.status}`} · {check.ms} ms
                  </span>
                </summary>
                <p className="small">{check.detail}</p>
                <p className="mono small">
                  {check.method} {check.url}
                </p>
                {check.raw ? (
                  <pre className="code">{JSON.stringify(check.raw, null, 2).slice(0, 4000)}</pre>
                ) : null}
              </details>
            ))}
          </div>
        ) : null}
      </Section>

      <Section title="Zona peligrosa">
        <p className="muted">
          Borra todas las filas de la base local. El snapshot cifrado se reescribe vacío; no se puede
          deshacer salvo que tengas una copia descargada.
        </p>
        <div className="row">
          <input
            type="text"
            placeholder="Escribe BORRAR"
            value={confirmDelete}
            onChange={(event) => setConfirmDelete(event.target.value)}
          />
          <button
            type="button"
            className="btn danger"
            onClick={() => void runDelete()}
            disabled={confirmDelete !== 'BORRAR' || deleting}
          >
            {deleting ? 'Borrando…' : 'Borrar todos los datos'}
          </button>
        </div>
      </Section>

      <Section title="Acerca de">
        <p className="muted small">
          misdatossalud · versión 0.1.0 · licencia AGPL-3.0-only. Los datos de salud no salen del
          dispositivo salvo las llamadas a APIs que autorices. No es un producto sanitario.
        </p>
        <p className="muted small">
          Código: <a href="https://github.com/jblancoantelo/misdatossalud">github.com/jblancoantelo/misdatossalud</a>
        </p>
      </Section>
    </>
  )
}

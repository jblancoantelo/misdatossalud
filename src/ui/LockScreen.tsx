import { useRef, useState } from 'react'
import { Callout } from './components'

interface LockScreenProps {
  mode: 'setup' | 'locked'
  busy: boolean
  error: string | null
  onCreate: (password: string) => void
  onUnlock: (password: string) => void
  onRestore: (bytes: Uint8Array, password: string) => void
}

export function LockScreen({ mode, busy, error, onCreate, onUnlock, onRestore }: LockScreenProps) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const isSetup = mode === 'setup'

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setLocalError(null)

    if (password.length < 8) {
      setLocalError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (isSetup && password !== confirm) {
      setLocalError('Las dos contraseñas no coinciden.')
      return
    }

    if (restoring) {
      const file = fileRef.current?.files?.[0]
      if (!file) {
        setLocalError('Selecciona un archivo .mdsalud.')
        return
      }
      void file.arrayBuffer().then((buffer) => onRestore(new Uint8Array(buffer), password))
      return
    }

    if (isSetup) onCreate(password)
    else onUnlock(password)
  }

  return (
    <div className="lock">
      <div className="lock-card">
        <div className="lock-brand">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={44} height={44} />
          <div>
            <h1>mis datos salud</h1>
            <p className="muted">Datos de Zepp y Health Connect, solo en tu dispositivo.</p>
          </div>
        </div>

        <form onSubmit={submit} className="lock-form">
          <label className="field">
            <span className="field-label">Contraseña</span>
            <input
              type="password"
              autoComplete={isSetup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
              required
            />
          </label>

          {isSetup && !restoring ? (
            <label className="field">
              <span className="field-label">Repite la contraseña</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                required
              />
            </label>
          ) : null}

          {restoring ? (
            <label className="field">
              <span className="field-label">Archivo de copia (.mdsalud)</span>
              <input ref={fileRef} type="file" accept=".mdsalud,application/octet-stream" />
            </label>
          ) : null}

          {localError || error ? (
            <Callout tone="danger">{localError ?? error}</Callout>
          ) : null}

          <button type="submit" className="btn primary block" disabled={busy}>
            {busy
              ? 'Trabajando…'
              : restoring
                ? 'Restaurar copia'
                : isSetup
                  ? 'Crear base cifrada'
                  : 'Desbloquear'}
          </button>

          <div className="lock-links">
            <button
              type="button"
              className="link"
              onClick={() => {
                setRestoring((value) => !value)
                setLocalError(null)
              }}
            >
              {restoring ? 'Volver' : 'Restaurar una copia de seguridad'}
            </button>
          </div>
        </form>

        {isSetup ? (
          <Callout tone="warn">
            Guarda la contraseña en un lugar seguro. Si la pierdes, el contenido cifrado no se puede
            recuperar: no hay servidor ni puerta trasera.
          </Callout>
        ) : (
          <p className="muted small">
            La base se descifra en memoria. Al cerrar la pestaña, el archivo vuelve a quedar cifrado.
          </p>
        )}
      </div>
    </div>
  )
}

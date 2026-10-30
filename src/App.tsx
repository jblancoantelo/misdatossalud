import { useState } from 'react'
import { useSession } from './state/useSession'
import { LockScreen } from './ui/LockScreen'
import { Callout } from './ui/components'
import { OverviewView } from './ui/views/OverviewView'
import { ActivityView } from './ui/views/ActivityView'
import { SleepView } from './ui/views/SleepView'
import { HeartView } from './ui/views/HeartView'
import { SportView } from './ui/views/SportView'
import { BodyView } from './ui/views/BodyView'
import { SettingsView } from './ui/views/SettingsView'

const TABS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'actividad', label: 'Actividad' },
  { id: 'sueno', label: 'Sueño' },
  { id: 'corazon', label: 'Corazón' },
  { id: 'deporte', label: 'Deporte' },
  { id: 'cuerpo', label: 'Cuerpo' },
  { id: 'ajustes', label: 'Ajustes' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function App() {
  const session = useSession()
  const [tab, setTab] = useState<TabId>('resumen')

  if (session.status === 'loading') {
    return (
      <div className="splash">
        <span className="spinner" aria-hidden="true" />
        <p className="muted">Abriendo el almacenamiento local…</p>
      </div>
    )
  }

  if (session.status !== 'unlocked' || !session.store) {
    return (
      <LockScreen
        mode={session.status === 'setup' ? 'setup' : 'locked'}
        busy={session.busy}
        error={session.error}
        onCreate={(password) => void session.create(password)}
        onUnlock={(password) => void session.unlock(password)}
        onRestore={(bytes, password) => void session.restore(bytes, password)}
      />
    )
  }

  const store = session.store

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={28} height={28} />
            <span>mis datos salud</span>
          </div>
          <div className="topbar-actions">
            <span className="save-state" aria-live="polite">
              {session.saving ? 'Guardando…' : session.lastSavedAt ? 'Guardado' : ''}
            </span>
            <button type="button" className="btn ghost small" onClick={session.lock}>
              Bloquear
            </button>
          </div>
        </div>
        <nav className="tabs" aria-label="Secciones">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === tab ? 'tab active' : 'tab'}
              aria-current={item.id === tab ? 'page' : undefined}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="content">
        {session.notice ? (
          <div className="notice">
            <span>{session.notice}</span>
            <button type="button" className="notice-close" onClick={session.clearNotice} aria-label="Cerrar aviso">
              ×
            </button>
          </div>
        ) : null}
        {session.error ? <Callout tone="danger">{session.error}</Callout> : null}

        {tab === 'resumen' ? <OverviewView store={store} version={session.version} /> : null}
        {tab === 'actividad' ? <ActivityView store={store} version={session.version} /> : null}
        {tab === 'sueno' ? <SleepView store={store} version={session.version} /> : null}
        {tab === 'corazon' ? <HeartView store={store} version={session.version} /> : null}
        {tab === 'deporte' ? <SportView store={store} version={session.version} /> : null}
        {tab === 'cuerpo' ? <BodyView store={store} version={session.version} /> : null}
        {tab === 'ajustes' ? (
          <SettingsView store={store} version={session.version} session={session} />
        ) : null}
      </main>

      <footer className="foot">
        <span>
          Datos guardados y cifrados en este dispositivo. Sin servidor propio. No es un producto
          sanitario.
        </span>
      </footer>
    </div>
  )
}

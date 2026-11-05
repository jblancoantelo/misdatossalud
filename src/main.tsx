import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Registra el service worker en modo prompt y expone el estado de actualización.
import './pwa/update'
import App from './App'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Falta el elemento #root')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

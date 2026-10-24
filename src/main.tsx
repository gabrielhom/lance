import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import type { Services } from './domain/types'
import { ServicesContext } from './ui/services'
import { listenForInstall } from './ui/install'

listenForInstall()

const services: Services =
  import.meta.env.VITE_MOCK === '1'
    ? (await import('./ui/dev/mockServices')).createMockServices()
    : await (await import('./app/services')).createServices()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServicesContext.Provider value={services}>
      <App />
    </ServicesContext.Provider>
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)

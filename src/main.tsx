import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import type { Services } from './domain/types'
import { ServicesContext } from './ui/services'

const services: Services =
  import.meta.env.VITE_MOCK === '1'
    ? (await import('./ui/dev/mockServices')).createMockServices()
    : (await import('./app/services')).createServices()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServicesContext.Provider value={services}>
      <App />
    </ServicesContext.Provider>
  </StrictMode>,
)

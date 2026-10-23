import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Services, Settings } from '../domain/types'

export const ServicesContext = createContext<Services | null>(null)

export function useServices(): Services {
  const s = useContext(ServicesContext)
  if (!s) throw new Error('ServicesContext sem valor')
  return s
}

const listeners = new Set<() => void>()
let cached: Settings | null = null

/** One settings snapshot for the whole UI. Every save replaces it and wakes every subscriber, so screens never disagree. */
export function useSettings(): [Settings, (s: Settings) => void] {
  const services = useServices()
  const settings = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => (cached ??= services.loadSettings()),
    () => (cached ??= services.loadSettings()),
  )
  const save = (s: Settings) => {
    services.saveSettings(s)
    cached = s
    for (const l of listeners) l()
  }
  return [settings, save]
}

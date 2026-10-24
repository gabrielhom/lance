import { useSyncExternalStore } from 'react'

/** Chrome and Edge only. Not in the DOM typings. */
type InstallPromptEvent = Event & { prompt(): Promise<unknown> }

// The browser fires beforeinstallprompt once, usually before the user opens Configurações, so it is kept here.
let pending: InstallPromptEvent | null = null
const listeners = new Set<() => void>()

function set(e: InstallPromptEvent | null) {
  pending = e
  for (const l of listeners) l()
}

/** Call before the first await in main.tsx so an early event is not missed. */
export function listenForInstall() {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    set(e as InstallPromptEvent)
  })
  addEventListener('appinstalled', () => set(null))
}

/** Opens the browser's install dialog, or null when the browser does not offer one. An event prompts only once. */
export function useInstall(): (() => void) | null {
  const e = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => pending,
    () => null,
  )
  return (
    e &&
    (() => {
      set(null)
      void e.prompt()
    })
  )
}

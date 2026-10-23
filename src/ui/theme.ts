import { useSyncExternalStore } from 'react'

export type Theme = 'system' | 'light' | 'dark'
const THEMES: readonly Theme[] = ['system', 'light', 'dark']
const KEY = 'lance.theme'
const listeners = new Set<() => void>()

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function apply(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

export function setTheme(theme: Theme) {
  try {
    if (theme === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    /* storage may be blocked; the attribute still applies for this page */
  }
  apply(theme)
  for (const l of listeners) l()
}

export function nextTheme(t: Theme): Theme {
  return THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    read,
    () => 'system' as Theme,
  )
}

apply(read())

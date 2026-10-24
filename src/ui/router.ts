import { useSyncExternalStore } from 'react'
import type { GameId } from '../domain/types'

export type Route =
  | { readonly name: 'play' }
  | { readonly name: 'import' }
  | { readonly name: 'review'; readonly id: GameId }
  | { readonly name: 'history' }
  | { readonly name: 'settings' }

function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const m = /^\/revisao\/(.+)$/.exec(path)
  if (m) return { name: 'review', id: decodeURIComponent(m[1]) as GameId }
  if (path === '/revisar') return { name: 'import' }
  if (path === '/historico') return { name: 'history' }
  if (path === '/config') return { name: 'settings' }
  return { name: 'play' }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'play': return '#/'
    case 'import': return '#/revisar'
    case 'review': return `#/revisao/${encodeURIComponent(route.id)}`
    case 'history': return '#/historico'
    case 'settings': return '#/config'
  }
}

export function navigate(route: Route) {
  window.location.hash = href(route)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb)
      return () => window.removeEventListener('hashchange', cb)
    },
    () => window.location.hash,
    () => '',
  )
  return parseRoute(hash)
}

import { useSyncExternalStore } from 'react'
import type { GameId } from '../domain/types'

export type Route =
  | { readonly name: 'play' }
  | { readonly name: 'import' }
  /** `ply` opens the review at that position instead of the start. */
  | { readonly name: 'review'; readonly id: GameId; readonly ply?: number }
  /** `game` trains only that game's items. */
  | { readonly name: 'training'; readonly game: GameId | null }
  | { readonly name: 'history' }
  | { readonly name: 'settings' }

function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const m = /^\/revisao\/([^/]+)(?:\/(\d+))?$/.exec(path)
  if (m) return { name: 'review', id: decodeURIComponent(m[1]) as GameId, ...(m[2] ? { ply: Number(m[2]) } : null) }
  const t = /^\/treino(?:\/([^/]+))?$/.exec(path)
  if (t) return { name: 'training', game: t[1] ? (decodeURIComponent(t[1]) as GameId) : null }
  if (path === '/revisar') return { name: 'import' }
  if (path === '/historico') return { name: 'history' }
  if (path === '/config') return { name: 'settings' }
  return { name: 'play' }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'play': return '#/'
    case 'import': return '#/revisar'
    case 'review': return `#/revisao/${encodeURIComponent(route.id)}${route.ply === undefined ? '' : `/${route.ply}`}`
    case 'training': return route.game ? `#/treino/${encodeURIComponent(route.game)}` : '#/treino'
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

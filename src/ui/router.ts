import { useMemo, useSyncExternalStore } from 'react'
import type { GameId } from '../domain/types'

export type Route =
  | { readonly name: 'play' }
  | { readonly name: 'import' }
  /** `ply` opens the review at that position instead of the start. */
  | { readonly name: 'review'; readonly id: GameId; readonly ply?: number }
  /** `games` trains only those games' items; none trains what is due. */
  | { readonly name: 'training'; readonly games: readonly GameId[] }
  /** A mode of the training screen, next to my own mistakes. */
  | { readonly name: 'puzzles' }
  | { readonly name: 'history' }
  | { readonly name: 'settings' }

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const m = /^\/revisao\/([^/]+)(?:\/(\d+))?$/.exec(path)
  if (m) return { name: 'review', id: decodeURIComponent(m[1]) as GameId, ...(m[2] ? { ply: Number(m[2]) } : null) }
  // Game ids always carry a source prefix ('lichess:', 'pgn:'...), so no game is called 'puzzles'.
  if (path === '/treino/puzzles') return { name: 'puzzles' }
  const t = /^\/treino(?:\/([^/]+))?$/.exec(path)
  if (t) return { name: 'training', games: t[1] ? t[1].split(',').map((g) => decodeURIComponent(g) as GameId) : [] }
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
    case 'training': return route.games.length ? `#/treino/${route.games.map(encodeURIComponent).join(',')}` : '#/treino'
    case 'puzzles': return '#/treino/puzzles'
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
  // Parsed once per hash, so a route's arrays keep their identity across renders.
  return useMemo(() => parseRoute(hash), [hash])
}

import type { Game, PlayablePosition, Position, PositionEval, PositionKey, Result, SearchedEval } from '../domain'

/** Built only by completeEvals, which proves every playable position of one game has an entry. */
export interface CompleteEvals {
  of(p: PlayablePosition): SearchedEval
  at(p: Position): PositionEval
}

export function completeEvals(
  game: Game,
  found: ReadonlyMap<PositionKey, SearchedEval>,
): Result<CompleteEvals, { readonly missing: readonly PlayablePosition[] }> {
  const playable = game.positions.filter((p) => p.kind === 'playable')
  const missing = playable.filter((p) => !found.has(p.key))
  if (missing.length > 0) return { ok: false, error: { missing } }
  const byKey = new Map(playable.map((p) => [p.key, found.get(p.key)] as const))
  const of = (p: PlayablePosition): SearchedEval => {
    const e = byKey.get(p.key)
    if (!e) throw new Error(`position ${p.index} is not from game ${game.id}`)
    return e
  }
  return {
    ok: true,
    value: {
      of,
      at(p) {
        switch (p.kind) {
          case 'playable':
            return { kind: 'searched', ...of(p) }
          case 'checkmate':
            return { kind: 'checkmate', loser: p.turn }
          case 'stalemate':
            return { kind: 'stalemate' }
        }
      },
    },
  }
}

import type { Color, Game, Identity, LibraryRecord } from '../../domain/types'
import { perspective } from '../../domain/identity'
import { OUTCOME_LABEL, formatAccuracy, formatDate, formatTimeControl, joinKnown, opponentOf, outcomeFor, playerLabel, resultLabel, sourceLabel } from '../format'
import { href } from '../router'
import { useSettings } from '../services'

function myColor(identity: Identity, g: Pick<Game, 'players' | 'source'>, highlight?: string): Color | null {
  const p = perspective(identity, g.players, g.source)
  if (p.kind === 'me') return p.color
  if (highlight) {
    const h = highlight.toLowerCase()
    if (g.players.w.name.toLowerCase() === h) return 'w'
    if (g.players.b.name.toLowerCase() === h) return 'b'
  }
  return null
}

function Title({ game, color }: { game: Pick<Game, 'players' | 'result'>; color: Color | null }) {
  return (
    <span className="row-title">
      {color ? `vs ${playerLabel(opponentOf(game.players, color))}` : `${playerLabel(game.players.w)} vs ${playerLabel(game.players.b)}`}
      <span className="outcome">{color ? OUTCOME_LABEL[outcomeFor(game.result, color)] : resultLabel(game.result)}</span>
    </span>
  )
}

export function GameList({ games, onPick, highlight }: { games: readonly Game[]; onPick: (g: Game) => void; highlight?: string }) {
  const [settings] = useSettings()
  return (
    <ul className="rows">
      {games.map((g) => {
        const color = myColor(settings.identity, g, highlight)
        return (
          <li key={g.id}>
            <button type="button" className="row" onClick={() => onPick(g)}>
              <span className="min-w-0">
                <Title game={g} color={color} />
                <span className="row-meta">
                  {joinKnown(color && `de ${color === 'w' ? 'brancas' : 'pretas'}`, formatDate(g.playedAt), formatTimeControl(g.timeControl), `${g.moves.length} lances`)}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function LibraryList({ records, identity }: { records: readonly LibraryRecord[] | null; identity: Identity }) {
  if (records === null) return <p className="caption" aria-busy="true">Carregando…</p>
  if (records.length === 0) {
    return (
      <div className="py-3">
        <p className="font-semibold">Nenhuma partida revisada ainda</p>
        <p className="text-ink-2 mt-1">Cole um PGN ou busque suas partidas recentes para começar.</p>
      </div>
    )
  }
  return (
    <ul className="rows">
      {records.map((r) => {
        const color = myColor(identity, r)
        return (
          <li key={r.id}>
            <a href={href({ name: 'review', id: r.id })} className="row">
              <span className="min-w-0">
                <Title game={r} color={color} />
                <span className="row-meta">{joinKnown(formatDate(r.playedAt), sourceLabel(r.source), r.summary.opening?.name ?? null)}</span>
              </span>
              <span className="text-right">
                <span className="row-acc">{color ? formatAccuracy(r.summary.accuracy[color]) : `${formatAccuracy(r.summary.accuracy.w)} · ${formatAccuracy(r.summary.accuracy.b)}`}</span>
                <span className="block text-sm text-ink-2">{color ? 'sua precisão' : 'brancas · pretas'}</span>
              </span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}

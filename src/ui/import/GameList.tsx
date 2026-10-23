import type { Color, Game, Identity, LibraryRecord } from '../../domain/types'
import { perspective } from '../../domain/identity'
import { OUTCOME_LABEL, formatDate, formatAccuracy, formatTimeControl, joinKnown, opponentOf, outcomeFor, playerLabel, resultLabel, sourceLabel } from '../format'
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

function OutcomePill({ game, color }: { game: Pick<Game, 'result'>; color: Color | null }) {
  const outcome = outcomeFor(game.result, color)
  return (
    <span className="text-[12px] font-semibold tabular text-ink-2">
      {color ? OUTCOME_LABEL[outcome] : resultLabel(game.result)}
    </span>
  )
}

export function GameList({ games, onPick, highlight }: { games: readonly Game[]; onPick: (g: Game) => void; highlight?: string }) {
  const [settings] = useSettings()
  return (
    <ul className="divide-y divide-border">
      {games.map((g) => {
        const color = myColor(settings.identity, g, highlight)
        const opp = opponentOf(g.players, color)
        return (
          <li key={g.id}>
            <button type="button" className="row-btn grid-cols-[1fr_auto] items-center gap-3" style={{ borderTop: 0 }} onClick={() => onPick(g)}>
              <span className="min-w-0">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[14px] truncate">{color ? `vs ${playerLabel(opp)}` : `${playerLabel(g.players.w)} vs ${playerLabel(g.players.b)}`}</span>
                  <OutcomePill game={g} color={color} />
                </span>
                <span className="block text-[13px] text-ink-3 mt-0.5">
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
  if (records === null) {
    return (
      <p className="hint" aria-busy="true">Carregando…</p>
    )
  }
  if (records.length === 0) {
    return (
      <div>
        <p className="font-semibold">Nenhuma partida revisada ainda</p>
        <p className="hint mt-1">Cole um PGN ou busque suas partidas recentes para começar.</p>
      </div>
    )
  }
  return (
    <ul>
      {records.map((r, i) => {
        const color = myColor(identity, r)
        const opp = opponentOf(r.players, color)
        const acc = color ? r.summary.accuracy[color] : null
        return (
          <li key={r.id}>
            <a href={href({ name: 'review', id: r.id })} className="row-btn grid-cols-[1fr_auto] items-center gap-3 no-underline" style={i === 0 ? { borderTop: 0 } : undefined}>
              <span className="min-w-0">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[14px] truncate">{color ? `vs ${playerLabel(opp)}` : `${playerLabel(r.players.w)} vs ${playerLabel(r.players.b)}`}</span>
                  <OutcomePill game={r} color={color} />
                </span>
                <span className="block text-[13px] text-ink-3 mt-0.5">
                  {joinKnown(formatDate(r.playedAt), sourceLabel(r.source), r.summary.opening?.name ?? null)}
                </span>
              </span>
              <span className="text-right">
                <span className="block text-[17px] font-semibold tabular whitespace-nowrap">
                  {color ? formatAccuracy(acc) : `${formatAccuracy(r.summary.accuracy.w)} · ${formatAccuracy(r.summary.accuracy.b)}`}
                </span>
                <span className="block text-[12px] text-ink-3">{color ? 'sua precisão' : 'brancas · pretas'}</span>
              </span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}

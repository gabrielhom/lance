import { evalLabel, pvSan } from '../../analysis'
import type { EngineFailureReason, PlayedMove, Position, PositionEval, Uci } from '../../domain/types'
import { formatEval, moveNumberLabel } from '../format'
import { engineFailureText } from '../labels'
import { San } from '../san'

/** A position off the game is searched on demand, so its eval can still be on the way or fail. */
export type LineEval =
  | { readonly kind: 'searching' }
  | { readonly kind: 'failed'; readonly reason: EngineFailureReason }
  | { readonly kind: 'known'; readonly eval: PositionEval }

const CONTINUATION = 8

type Props = {
  line: { readonly moves: readonly PlayedMove[]; readonly at: number }
  evaluation: LineEval
  /** The position on the board, after `at` moves of the line. */
  position: Position
  onAt: (at: number) => void
  onExit: () => void
  /** Plays the start of the engine's line on the board. */
  onFollow: (pv: readonly Uci[]) => void
}

/** The line being tried on the board: its moves, the engine's eval of where it stands and how the engine goes on. */
export function LineCard({ line, evaluation, position, onAt, onExit, onFollow }: Props) {
  return (
    <section className="line variation" aria-labelledby="variante-titulo">
      <div className="flex items-baseline justify-between gap-4">
        <h3 id="variante-titulo" className="font-serif font-semibold text-md">Variante</h3>
        <button type="button" className="tl tl-quiet" onClick={onExit} title="Esc">Voltar à partida</button>
      </div>
      <ol className="moves" aria-label="Lances da variante">
        {line.moves.map((m, i) => (
          <li key={i}>
            <button type="button" aria-pressed={line.at === i + 1} onClick={() => onAt(i + 1)}>
              {(i === 0 || m.mover === 'w') && <span className="n">{moveNumberLabel(m.index)}</span>}
              <San san={m.san} />
            </button>
          </li>
        ))}
      </ol>
      <Verdict evaluation={evaluation} position={position} onFollow={onFollow} />
    </section>
  )
}

function Verdict({ evaluation: e, position, onFollow }: { evaluation: LineEval; position: Position; onFollow: Props['onFollow'] }) {
  if (e.kind === 'searching') return <p className="caption mt-2" aria-busy="true">A engine está avaliando a posição…</p>
  if (e.kind === 'failed') return <p className="caption mt-2">{engineFailureText(e.reason).title}.</p>
  const evaluation = e.eval
  if (evaluation.kind !== 'searched') return <p className="best mt-2 font-serif text-lg">{evaluation.kind === 'checkmate' ? 'Xeque-mate.' : 'Afogamento. Empate.'}</p>
  const { pv } = evaluation.lines[0]
  const continuation = pvSan(position.fen, pv).slice(0, CONTINUATION)
  return (
    <>
      <p className="mt-2 flex items-baseline gap-3 text-sm text-ink-2" title="Avaliação em peões, do lado das brancas">
        Avaliação <span className="num text-2xl text-ink">{formatEval(evalLabel(evaluation), position)}</span>
      </p>
      <p id="continuacao" className="mt-1 text-sm text-ink-2">Melhor continuação</p>
      <ol className="moves" aria-labelledby="continuacao">
        {continuation.map((san, i) => {
          const idx = position.index + i
          return (
            <li key={i} className="whitespace-nowrap">
              <button type="button" className={i === 0 ? 'first' : undefined} onClick={() => onFollow(pv.slice(0, i + 1))} title="Seguir no tabuleiro">
                {(i === 0 || idx % 2 === 0) && <span className="n">{moveNumberLabel(idx)}</span>}
                <San san={san} />
              </button>
            </li>
          )
        })}
      </ol>
      <p className="caption mt-1">Toque num lance para seguir a engine no tabuleiro.</p>
    </>
  )
}

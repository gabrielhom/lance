import { evalLabel, pvSan } from '../../analysis'
import type { PlayedMove, Position, PositionEval } from '../../domain/types'
import { formatEval, moveNumberLabel } from '../format'
import { San } from '../san'

/** A position off the game is searched on demand, so its eval can still be on the way or fail. */
export type LineEval = PositionEval | 'searching' | 'failed'

const CONTINUATION = 8

type Props = {
  line: { readonly moves: readonly PlayedMove[]; readonly at: number }
  evaluation: LineEval | null
  /** The position on the board, after `at` moves of the line. */
  position: Position
  onAt: (at: number) => void
  onExit: () => void
}

/** The line being tried on the board: its moves, the engine's eval of where it stands and how the engine goes on. */
export function LineCard({ line, evaluation, position, onAt, onExit }: Props) {
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
      <Verdict evaluation={evaluation} position={position} />
    </section>
  )
}

function Verdict({ evaluation, position }: { evaluation: LineEval | null; position: Position }) {
  if (evaluation === null || evaluation === 'searching') return <p className="caption mt-2" aria-busy="true">A engine está avaliando a posição…</p>
  if (evaluation === 'failed') return <p className="caption mt-2">A engine não conseguiu avaliar esta posição.</p>
  if (evaluation.kind !== 'searched') return <p className="best mt-2 font-serif text-lg">{evaluation.kind === 'checkmate' ? 'Xeque-mate.' : 'Afogamento. Empate.'}</p>
  const continuation = pvSan(position.fen, evaluation.lines[0].pv).slice(0, CONTINUATION)
  return (
    <>
      <p className="mt-2 flex items-baseline gap-3 text-sm text-ink-2" title="Avaliação em peões, do lado das brancas">
        Avaliação <span className="num text-2xl text-ink">{formatEval(evalLabel(evaluation), position)}</span>
      </p>
      <p id="continuacao" className="mt-1 text-sm text-ink-2">Melhor continuação</p>
      <ol className="flex flex-wrap gap-x-2 font-serif text-lg" aria-labelledby="continuacao">
        {continuation.map((san, i) => {
          const idx = position.index + i
          return (
            <li key={i} className="whitespace-nowrap">
              {(i === 0 || idx % 2 === 0) && <span className="text-ink-3">{moveNumberLabel(idx)}</span>}
              <San san={san} />
            </li>
          )
        })}
      </ol>
    </>
  )
}

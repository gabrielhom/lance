import { useState } from 'react'
import type { ReactNode } from 'react'
import type { MoveReview, Opening, PlayedMove } from '../../domain/types'
import { colorLabel, moveNumberLabel } from '../format'
import { CLASSIFICATION_LABEL } from '../labels'
import { Mark, San } from '../san'

/** Shown after the class label, so it adds what the label does not say instead of repeating it. */
function sentence(r: MoveReview): ReactNode {
  if (r.move.after.kind === 'checkmate') return 'Xeque-mate.'
  const best = <>{moveNumberLabel(r.move.index)}<San san={r.bestLineSan[0]} /></>
  const played = r.move.san === r.bestLineSan[0]
  switch (r.classification) {
    case 'brilliant': return 'O melhor lance, e ele entrega material.'
    case 'great': return 'O único lance que mantinha a avaliação.'
    case 'best': return 'O lance que a engine escolheu.'
    case 'excellent': return played ? 'O lance que a engine escolheu.' : <>{best} era só um pouco melhor.</>
    case 'good': return played ? 'O lance que a engine escolheu.' : <>{best} era melhor.</>
    case 'book': return r.opening ? `${r.opening.eco} · ${r.opening.name}.` : 'Lance conhecido da teoria.'
    case 'inaccuracy':
    case 'mistake':
    case 'blunder': return <>O melhor era {best}.</>
    case 'miss': return <>{best} ganhava mais.</>
  }
}

const SHORT_LINE = 6

type Props = {
  /** The move that reached the shown position, or null at the start. */
  move: PlayedMove | null
  review: MoveReview | null
  opening: Opening | null
  /** Eval per position, already formatted for display. */
  labels: readonly string[] | null
  ply: number
  /** Plies of the best line shown on the board, or null when the board shows the game. */
  preview: number | null
  onPreview: (plies: number | null) => void
}

/** The current move set like a book annotation: where it is, the move itself large, the verdict, what was better. */
export function MoveCard({ move, review: r, opening, labels, ply, preview, onPreview }: Props) {
  const [expandedAt, setExpandedAt] = useState<number | null>(null)
  if (!move) {
    return (
      <section className="annot" aria-live="polite">
        <p className="where">Posição inicial</p>
        {opening && <p className="best">{opening.eco} · {opening.name}</p>}
        <p className="caption ml-0">Toque nos lances ou use as setas.</p>
      </section>
    )
  }
  const head = (
    <>
      <p className="where">Lance {Math.floor(move.index / 2) + 1} das {colorLabel(move.mover)}</p>
      <div className="move">
        <span className="san">{moveNumberLabel(move.index)}<San san={move.san} />{r && <Mark kind={r.classification} />}</span>
        {r && <span className="cls" style={{ color: `var(--c-${r.classification})` }}>{CLASSIFICATION_LABEL[r.classification]}</span>}
      </div>
    </>
  )
  if (!r) {
    return (
      <section className="annot" aria-live="polite">
        {head}
        <p className="caption ml-0">A explicação do lance aparece quando a análise terminar.</p>
      </section>
    )
  }
  const expanded = expandedAt === ply
  const line = r.bestLineSan
  const showLine = r.classification !== 'book' && line.length > 0 && !(r.move.san === line[0] && line.length === 1)
  const visible = expanded ? line : line.slice(0, SHORT_LINE)
  const evalBefore = labels?.[ply - 1]
  const evalAfter = labels?.[ply]
  return (
    <>
      <section className="annot" aria-live="polite">
        {head}
        <p className="best">{sentence(r)}</p>
        {evalBefore && evalAfter && (
          <p className="evals" title="Avaliação em peões, do lado das brancas, antes e depois do lance">
            Avaliação <span className="num">{evalBefore}</span><span className="arrow" aria-hidden>→</span><span className="sr-only">para</span><span className="num">{evalAfter}</span>
          </p>
        )}
        <p className="text-sm text-ink-3 mt-1">
          Chance de vitória de quem jogou: {Math.round(r.winBefore)}% → {Math.round(r.winAfter)}%
        </p>
      </section>
      {showLine && (
        <section className="line" aria-labelledby="linha-titulo">
          <div className="flex items-baseline justify-between gap-4">
            <h3 id="linha-titulo" className="font-serif font-semibold text-md">Melhor sequência</h3>
            {preview !== null && <button type="button" className="tl tl-quiet" onClick={() => onPreview(null)}>Voltar à partida</button>}
          </div>
          <ol className="moves" aria-label="Melhor sequência">
            {visible.map((san, i) => {
              const idx = r.move.index + i
              const num = idx % 2 === 0 || i === 0 ? moveNumberLabel(idx) : null
              const on = preview === i + 1
              return (
                <li key={i}>
                  <button type="button" className={i === 0 ? 'first' : undefined} aria-pressed={on} onClick={() => onPreview(on ? null : i + 1)} title="Ver no tabuleiro">
                    {num && <span className="n">{num}</span>}
                    <San san={san} />
                  </button>
                </li>
              )
            })}
            {line.length > SHORT_LINE && (
              <li>
                <button type="button" className="more" onClick={() => setExpandedAt(expanded ? null : ply)} aria-expanded={expanded}>
                  {expanded ? 'ver menos' : `ver mais (${line.length - SHORT_LINE})`}
                </button>
              </li>
            )}
          </ol>
          <p className="caption ml-0 mt-1">{preview === null ? 'Toque num lance para ver a sequência no tabuleiro.' : 'Mostrando a sequência no tabuleiro. As setas avançam e voltam nela.'}</p>
        </section>
      )}
    </>
  )
}

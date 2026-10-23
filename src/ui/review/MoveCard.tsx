import { useState } from 'react'
import type { GameReview, MoveReview } from '../../domain/types'
import { moveNumberLabel } from '../format'
import { CLASSIFICATION_LABEL } from '../labels'
import { ClassificationBadge } from './ClassificationBadge'

/** Shown after the class label, so it adds what the label does not say instead of repeating it. */
function sentence(r: MoveReview): string {
  if (r.move.after.kind === 'checkmate') return 'Xeque-mate.'
  const best = r.bestLineSan[0]
  const played = r.move.san === best
  switch (r.classification) {
    case 'brilliant': return 'O melhor lance, e ele entrega material.'
    case 'great': return 'O único lance que mantinha a avaliação.'
    case 'best': return 'O lance que a engine escolheu.'
    case 'excellent': return played ? 'O lance que a engine escolheu.' : `${best} era só um pouco melhor.`
    case 'good': return played ? 'O lance que a engine escolheu.' : `${best} era melhor.`
    case 'book': return r.opening ? `${r.opening.eco} · ${r.opening.name}.` : 'Lance conhecido da teoria.'
    case 'inaccuracy':
    case 'mistake':
    case 'blunder': return `O melhor era ${best}.`
    case 'miss': return `${best} ganhava mais.`
  }
}

const SHORT_LINE = 6

type Props = {
  review: GameReview | null
  ply: number
  /** Eval per position, already formatted for display. */
  labels: readonly string[] | null
  /** Plies of the best line shown on the board, or null when the board shows the game. */
  preview: number | null
  onPreview: (plies: number | null) => void
}

export function MoveCard({ review, ply, labels, preview, onPreview }: Props) {
  const [expandedAt, setExpandedAt] = useState<number | null>(null)
  const expanded = expandedAt === ply
  if (ply === 0 || !review) {
    return (
      <div className="card p-4 min-h-[88px] flex flex-col justify-center">
        {ply === 0 ? (
          <>
            <p className="font-semibold">Posição inicial</p>
            <p className="hint mt-0.5">{review?.opening ? `${review.opening.eco} · ${review.opening.name}. ` : ''}Toque nos lances ou use as setas.</p>
          </>
        ) : (
          <p className="hint">A explicação do lance aparece quando a análise terminar.</p>
        )}
      </div>
    )
  }
  const r = review.moves[ply - 1]
  const line = r.bestLineSan
  const showLine = r.classification !== 'book' && line.length > 0 && !(r.move.san === line[0] && line.length === 1)
  const visible = expanded ? line : line.slice(0, SHORT_LINE)
  const evalBefore = labels?.[ply - 1]
  const evalAfter = labels?.[ply]
  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3" aria-live="polite">
        <ClassificationBadge kind={r.classification} size={28} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[15px] leading-tight">
            {moveNumberLabel(r.move.index)} {r.move.san}
            <span className="font-normal text-ink-2"> · {CLASSIFICATION_LABEL[r.classification]}</span>
          </p>
          <p className="text-[14px] text-ink-2 mt-0.5">{sentence(r)}</p>
          <p className="text-[12px] text-ink-3 mt-1 tabular">
            Chance de vitória de quem jogou: {Math.round(r.winBefore)}% → {Math.round(r.winAfter)}%
          </p>
        </div>
        {evalBefore && evalAfter && (
          <span className="text-[14px] font-semibold tabular whitespace-nowrap" title="Avaliação em peões, do lado das brancas, antes e depois do lance">
            <span className="sr-only">Avaliação: </span>
            {evalBefore} → {evalAfter}
          </span>
        )}
      </div>
      {showLine && (
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Melhor sequência</p>
            {preview !== null && (
              <button type="button" className="btn btn-sm" onClick={() => onPreview(null)}>
                Voltar à partida
              </button>
            )}
          </div>
          <ol className="flex flex-wrap gap-1" aria-label="Melhor sequência">
            {visible.map((san, i) => {
              const idx = r.move.index + i
              const num = idx % 2 === 0 ? `${idx / 2 + 1}.` : i === 0 ? `${(idx - 1) / 2 + 1}...` : null
              const on = preview === i + 1
              return (
                <li key={i}>
                  <button
                    type="button"
                    className={`line-chip ${i === 0 ? 'line-chip-first' : ''}`}
                    aria-pressed={on}
                    onClick={() => onPreview(on ? null : i + 1)}
                    title="Ver no tabuleiro"
                  >
                    {num && <span className="text-ink-3 mr-1">{num}</span>}
                    {san}
                  </button>
                </li>
              )
            })}
            {line.length > SHORT_LINE && (
              <li>
                <button type="button" className="line-chip text-accent" onClick={() => setExpandedAt(expanded ? null : ply)} aria-expanded={expanded}>
                  {expanded ? 'ver menos' : `ver mais (${line.length - SHORT_LINE})`}
                </button>
              </li>
            )}
          </ol>
          <p className="hint text-[12px] mt-1">{preview === null ? 'Toque num lance para ver a sequência no tabuleiro.' : 'Mostrando a sequência no tabuleiro. As setas avançam e voltam nela.'}</p>
        </div>
      )}
    </div>
  )
}

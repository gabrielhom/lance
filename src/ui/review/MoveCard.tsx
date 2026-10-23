import type { GameReview, MoveReview } from '../../domain/types'
import { moveNumberLabel } from '../format'
import { CLASSIFICATION_LABEL } from '../labels'
import { ClassificationBadge } from './ClassificationBadge'

function sentence(r: MoveReview): string {
  const best = r.bestLineSan[0]
  const played = r.move.san === best
  switch (r.classification) {
    case 'brilliant': return 'Brilhante! Um sacrifício que funciona.'
    case 'great': return 'Ótimo lance. Era o único que mantinha a posição.'
    case 'best': return 'O melhor lance.'
    case 'excellent': return played ? 'Excelente.' : `Excelente. ${best} era quase igual.`
    case 'good': return played ? 'Bom lance.' : `Bom lance. ${best} era um pouco melhor.`
    case 'book': return r.opening ? `Lance de teoria. ${r.opening.name}.` : 'Lance de teoria.'
    case 'inaccuracy': return `Imprecisão. O melhor era ${best}.`
    case 'mistake': return `Erro. O melhor era ${best}.`
    case 'blunder': return `Blunder. O melhor era ${best}.`
    case 'miss': return `Chance perdida. ${best} ganhava mais.`
  }
}

export function MoveCard({ review, ply }: { review: GameReview | null; ply: number }) {
  if (ply === 0 || !review) {
    return (
      <div className="card p-4 min-h-[88px] flex flex-col justify-center">
        {ply === 0 ? (
          <>
            <p className="font-semibold">Posição inicial</p>
            <p className="hint mt-0.5">{review?.opening ? `${review.opening.eco} · ${review.opening.name}` : 'Use as setas para percorrer a partida.'}</p>
          </>
        ) : (
          <p className="hint">A explicação do lance aparece quando a análise terminar.</p>
        )}
      </div>
    )
  }
  const r = review.moves[ply - 1]
  const showLine = r.classification !== 'book' && r.bestLineSan.length > 0 && !(r.move.san === r.bestLineSan[0] && r.bestLineSan.length === 1)
  const startsWithBlack = r.move.mover === 'b'
  return (
    <div className="card p-4 flex flex-col gap-3" aria-live="polite">
      <div className="flex items-center gap-3">
        <ClassificationBadge kind={r.classification} size={28} />
        <div className="min-w-0">
          <p className="font-semibold text-[15px] leading-tight">
            {moveNumberLabel(r.move.index)} {r.move.san}
            <span className="font-normal text-ink-2"> · {CLASSIFICATION_LABEL[r.classification]}</span>
          </p>
          <p className="text-[14px] text-ink-2 mt-0.5">{sentence(r)}</p>
        </div>
        <span className="ml-auto text-[13px] tabular text-ink-3 whitespace-nowrap self-start" title="Chance de vitória de quem jogou, antes e depois">
          {Math.round(r.winBefore)}% → {Math.round(r.winAfter)}%
        </span>
      </div>
      {showLine && (
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-3 mb-1">Melhor sequência</p>
          <ol className="flex flex-wrap gap-1" aria-label="Melhor sequência">
            {r.bestLineSan.map((san, i) => {
              const idx = r.move.index + i
              const num = idx % 2 === 0 ? `${idx / 2 + 1}.` : i === 0 && startsWithBlack ? `${(idx - 1) / 2 + 1}...` : null
              return (
                <li key={i} className={`rounded-md px-2 py-0.5 text-[13px] font-medium ${i === 0 ? 'bg-accent-soft text-ink' : 'bg-surface-2 text-ink-2'}`}>
                  {num && <span className="text-ink-3 mr-1">{num}</span>}
                  {san}
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </div>
  )
}

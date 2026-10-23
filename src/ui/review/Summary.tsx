import type { Color, GameReview } from '../../domain/types'
import { CLASSIFICATIONS } from '../../domain/types'
import { formatPct } from '../format'
import { CLASSIFICATION_LABEL } from '../labels'
import { ClassificationBadge } from './ClassificationBadge'

export function Summary({ review }: { review: GameReview }) {
  const me: Color | null = review.perspective.kind === 'me' ? review.perspective.color : null
  const shown = CLASSIFICATIONS.filter((c) => review.players.w.counts[c] + review.players.b.counts[c] > 0 || ['best', 'inaccuracy', 'mistake', 'blunder'].includes(c))
  const col = (c: Color) => {
    const p = review.players[c]
    const mine = me === c
    return (
      <div className={`flex flex-col items-center rounded-lg p-3 ${mine ? 'bg-accent-soft' : 'bg-surface-2'}`}>
        <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">{c === 'w' ? 'Brancas' : 'Pretas'}{mine ? ' · você' : ''}</span>
        <span className="text-[14px] font-medium truncate max-w-full mt-0.5">{p.player.name}</span>
        <span className={`text-[32px] leading-none font-semibold mt-2 ${mine ? 'text-accent' : ''}`}>{formatPct(p.accuracy)}</span>
        <span className="text-[12px] text-ink-3 mt-1">precisão</span>
      </div>
    )
  }
  return (
    <section className="card p-4 flex flex-col gap-4" aria-labelledby="resumo-titulo">
      <div className="flex items-baseline justify-between">
        <h2 id="resumo-titulo" className="text-[16px] font-semibold">Resumo</h2>
        {review.opening && <span className="text-[13px] text-ink-2 text-right truncate max-w-[60%]" title={`${review.opening.eco} ${review.opening.name}`}>{review.opening.name}</span>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {col('w')}
        {col('b')}
      </div>
      <table className="w-full text-[14px]">
        <caption className="sr-only">Lances por classificação</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Classificação</th>
            <th scope="col">Brancas</th>
            <th scope="col">Pretas</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((c) => (
            <tr key={c} className="h-8">
              <th scope="row" className="font-medium text-left">
                <span className="inline-flex items-center gap-2">
                  <ClassificationBadge kind={c} size={18} />
                  {CLASSIFICATION_LABEL[c]}
                </span>
              </th>
              <td className={`text-center tabular w-16 ${me === 'w' ? 'font-semibold' : 'text-ink-2'}`}>{review.players.w.counts[c]}</td>
              <td className={`text-center tabular w-16 ${me === 'b' ? 'font-semibold' : 'text-ink-2'}`}>{review.players.b.counts[c]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

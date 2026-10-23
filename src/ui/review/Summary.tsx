import { useId } from 'react'
import type { Classification, Color, GameReview } from '../../domain/types'
import { CLASSIFICATIONS } from '../../domain/types'
import { colorLabel, formatPct } from '../format'
import { CLASSIFICATION_LABEL } from '../labels'
import { ClassificationBadge } from './ClassificationBadge'

const ALWAYS_SHOWN: ReadonlySet<Classification> = new Set(['best', 'inaccuracy', 'mistake', 'blunder'])

type Props = {
  review: GameReview
  me: Color | null
  /** With it, a count is a button to that player's first move of the class. */
  onJump?: (ply: number) => void
  title?: string
  /** 'counts' drops the accuracy cards for a screen that already shows them. */
  variant?: 'full' | 'counts'
}

/** Accuracy cards and per-class counts share one table, so each count sits under its player. */
export function Summary({ review, me, onJump, title = 'Resumo', variant = 'full' }: Props) {
  const id = useId()
  const shown = CLASSIFICATIONS.filter((c) => review.players.w.counts[c] + review.players.b.counts[c] > 0 || ALWAYS_SHOWN.has(c))
  const first = (c: Color, k: Classification) => review.moves.find((r) => r.move.mover === c && r.classification === k)

  const card = (c: Color) => {
    const p = review.players[c]
    const mine = me === c
    if (variant === 'counts') {
      return (
        <th scope="col" className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
          {c === 'w' ? 'Brancas' : 'Pretas'}{mine ? ' · você' : ''}
        </th>
      )
    }
    return (
      <th scope="col" className="p-0 pb-2 align-top font-normal">
        <div className={`flex flex-col items-center rounded-lg px-1.5 py-3 ${mine ? 'bg-accent-soft' : 'bg-surface-2'}`}>
          <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">{c === 'w' ? 'Brancas' : 'Pretas'}{mine ? ' · você' : ''}</span>
          <span className="text-[13px] font-medium max-w-full mt-0.5 text-center leading-tight line-clamp-2 break-words" title={p.player.name}>{p.player.name}</span>
          <span className={`text-[28px] sm:text-[30px] leading-none font-semibold mt-2 tabular ${mine ? 'text-accent' : ''}`}>{formatPct(p.accuracy)}</span>
          <span className="text-[12px] text-ink-3 mt-1">precisão</span>
        </div>
      </th>
    )
  }

  const count = (c: Color, k: Classification) => {
    const n = review.players[c].counts[k]
    const target = onJump && n > 0 ? first(c, k) : undefined
    const weight = me === c ? 'font-semibold' : 'text-ink-2'
    return (
      <td className={`text-center tabular ${weight}`}>
        {target ? (
          <button
            type="button"
            className="count-btn"
            onClick={() => onJump!(target.move.index + 1)}
            aria-label={`${n} ${CLASSIFICATION_LABEL[k].toLowerCase()} das ${colorLabel(c)}. Ir para o primeiro.`}
          >
            {n}
          </button>
        ) : (
          n
        )}
      </td>
    )
  }

  return (
    <section className="card p-4 flex flex-col gap-3" aria-labelledby={`${id}-t`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`${id}-t`} className="text-[16px] font-semibold">{title}</h2>
        {review.opening && <span className="text-[13px] text-ink-2 text-right truncate min-w-0" title={`${review.opening.eco} ${review.opening.name}`}>{review.opening.name}</span>}
      </div>
      <table className="w-full table-fixed border-separate border-spacing-x-1 text-[14px]">
        <caption className="sr-only">Precisão e lances por classificação</caption>
        <colgroup>
          <col />
          <col className="w-[31%]" />
          <col className="w-[31%]" />
        </colgroup>
        <thead>
          <tr>
            <td />
            {card('w')}
            {card('b')}
          </tr>
        </thead>
        <tbody>
          {shown.map((k) => (
            <tr key={k} className="h-8">
              <th scope="row" className="font-medium text-left">
                <span className="inline-flex items-center gap-2 min-w-0">
                  <ClassificationBadge kind={k} size={18} />
                  <span className="truncate">{CLASSIFICATION_LABEL[k]}</span>
                </span>
              </th>
              {count('w', k)}
              {count('b', k)}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

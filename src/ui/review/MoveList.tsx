import { useEffect, useRef } from 'react'
import type { Classification, MoveReview, PlayedMove } from '../../domain/types'
import { CLASSIFICATION_LABEL } from '../labels'
import { ClassificationBadge } from './ClassificationBadge'

/** Classifications that tint the SAN; routine moves stay in ink so the list reads calm. */
const TINTED: ReadonlySet<Classification> = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'blunder', 'miss'])

type Props = {
  moves: readonly PlayedMove[]
  reviews: readonly MoveReview[] | null
  ply: number
  onSelect: (ply: number) => void
}

export function MoveList({ moves, reviews, ply, onSelect }: Props) {
  const listRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const list = listRef.current
    const el = list?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!list || !el) return
    const top = el.offsetTop - list.offsetTop
    const bottom = top + el.offsetHeight
    if (top < list.scrollTop) list.scrollTop = top - 4
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4
  }, [ply])

  const rows: { n: number; w: PlayedMove | undefined; b: PlayedMove | undefined }[] = []
  for (let i = 0; i < moves.length; i += 2) rows.push({ n: i / 2 + 1, w: moves[i], b: moves[i + 1] })

  const cell = (m: PlayedMove | undefined) => {
    if (!m) return <span />
    const r = reviews?.[m.index]
    const cls = r?.classification
    const current = ply === m.index + 1
    return (
      <button
        type="button"
        className="move-btn"
        aria-current={current ? 'true' : undefined}
        onClick={() => onSelect(m.index + 1)}
        aria-label={`${m.mover === 'w' ? 'Brancas' : 'Pretas'}: ${m.san}${cls ? `, ${CLASSIFICATION_LABEL[cls]}` : ''}`}
      >
        {cls ? <ClassificationBadge kind={cls} size={16} /> : <span style={{ width: 16 }} />}
        <span style={cls && TINTED.has(cls) ? { color: `var(--cls-${cls})` } : undefined}>{m.san}</span>
      </button>
    )
  }

  return (
    <ol ref={listRef} className="relative grid grid-cols-[2.5rem_1fr_1fr] gap-y-0.5 max-h-[320px] lg:max-h-[420px] overflow-y-auto pr-1" aria-label="Lista de lances">
      {rows.map((row) => (
        <li key={row.n} className="contents">
          <span className="text-[13px] text-ink-3 tabular self-center pl-1">{row.n}.</span>
          {cell(row.w)}
          {cell(row.b)}
        </li>
      ))}
    </ol>
  )
}

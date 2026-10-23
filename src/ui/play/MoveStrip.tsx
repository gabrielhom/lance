import { useEffect, useRef } from 'react'
import type { San } from '../../domain/types'

/** The game so far, newest move kept in view. A one-line strip on the phone, a table beside the board on desktop. */
export function MoveStrip({ sans, layout = 'strip', className = '' }: { sans: readonly San[]; layout?: 'strip' | 'table'; className?: string }) {
  const ref = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTo({ left: el.scrollWidth, top: el.scrollHeight })
  }, [sans.length])

  const rows: { n: number; w: San; b: San | undefined }[] = []
  for (let i = 0; i < sans.length; i += 2) rows.push({ n: i / 2 + 1, w: sans[i], b: sans[i + 1] })
  const last = sans.length - 1
  const cell = (san: San | undefined, i: number) =>
    san ? (
      <span className={`rounded px-1.5 py-0.5 ${i === last ? 'bg-accent-soft font-semibold text-ink' : ''}`} aria-current={i === last ? 'true' : undefined}>
        {san}
      </span>
    ) : (
      <span />
    )

  if (layout === 'table') {
    return (
      <ol ref={ref} tabIndex={0} className="grid grid-cols-[2.25rem_1fr_1fr] gap-y-0.5 max-h-[280px] overflow-y-auto text-[14px] font-medium rounded-md" aria-label="Lances da partida">
        {rows.length === 0 && <li className="col-span-3 hint px-1 py-1">Nenhum lance ainda.</li>}
        {rows.map((r) => (
          <li key={r.n} className="contents">
            <span className="text-[13px] text-ink-3 tabular self-center pl-1">{r.n}.</span>
            {cell(r.w, (r.n - 1) * 2)}
            {cell(r.b, (r.n - 1) * 2 + 1)}
          </li>
        ))}
      </ol>
    )
  }
  return (
    <ol ref={ref} tabIndex={0} className={`flex items-center gap-1 h-9 px-3 overflow-x-auto whitespace-nowrap text-[14px] font-medium scrollbar-none ${className}`} aria-label="Lances da partida">
      {rows.length === 0 && <li className="hint">Nenhum lance ainda.</li>}
      {rows.map((r) => (
        <li key={r.n} className="flex items-center gap-0.5">
          <span className="text-[13px] text-ink-3 tabular ml-1">{r.n}.</span>
          {cell(r.w, (r.n - 1) * 2)}
          {r.b && cell(r.b, (r.n - 1) * 2 + 1)}
        </li>
      ))}
    </ol>
  )
}

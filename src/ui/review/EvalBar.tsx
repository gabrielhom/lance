import type { Color } from '../../domain/types'

/** A thin vertical bar beside the board: White's share grows from White's side. The numbers live in the annotation. */
export function EvalBar({ whiteWin, label, orientation }: { whiteWin: number | null; label: string | null; orientation: Color }) {
  const pct = whiteWin ?? 50
  return (
    <div
      className="evalbar"
      role="img"
      aria-label={whiteWin === null ? 'Avaliação pendente' : `Avaliação ${label ?? ''}: brancas com ${Math.round(pct)}% de chance`}
    >
      <div style={{ height: `${pct}%`, [orientation === 'b' ? 'top' : 'bottom']: 0 }} />
    </div>
  )
}

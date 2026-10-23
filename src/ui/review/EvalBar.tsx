import type { Color } from '../../domain/types'

/** Vertical bar: the white share grows from White's side of the board. The score sits at the winning side's end. */
export function EvalBar({ whiteWin, label, orientation }: { whiteWin: number | null; label: string | null; orientation: Color }) {
  const pct = whiteWin ?? 50
  const whiteOnTop = orientation === 'b'
  const whiteAhead = pct >= 50
  return (
    <div
      className="relative w-6 sm:w-7 flex-none rounded-md overflow-hidden border border-border-strong"
      style={{ background: 'var(--eval-black)' }}
      role="img"
      aria-label={whiteWin === null ? 'Avaliação pendente' : `Avaliação ${label ?? ''}: brancas com ${Math.round(pct)}% de chance`}
    >
      <div
        className="absolute inset-x-0"
        style={{ background: 'var(--eval-white)', height: `${pct}%`, [whiteOnTop ? 'top' : 'bottom']: 0, transition: 'height 240ms ease' }}
      />
      <div className="absolute inset-x-0 h-px" style={{ top: '50%', background: 'rgba(128,128,128,0.6)' }} />
      {label && whiteWin !== null && (
        <span
          aria-hidden
          className={`absolute inset-x-0 text-center text-[9px] sm:text-[10px] font-bold tabular leading-none tracking-tight ${whiteAhead === whiteOnTop ? 'top-1.5' : 'bottom-1.5'}`}
          style={{ color: whiteAhead ? '#1b1b1f' : '#ffffff' }}
        >
          {label}
        </span>
      )}
    </div>
  )
}

import type { Color } from '../../domain/types'

/** Vertical bar: the white share grows from White's side of the board. The label hangs below so it never has to fit inside. */
export function EvalBar({ whiteWin, label, orientation }: { whiteWin: number | null; label: string | null; orientation: Color }) {
  const pct = whiteWin ?? 50
  const whiteOnTop = orientation === 'b'
  return (
    <div className="relative w-4 sm:w-5 flex-none">
      <div
        className="absolute inset-0 rounded-md overflow-hidden"
        style={{ background: 'var(--eval-black)' }}
        role="img"
        aria-label={whiteWin === null ? 'Avaliação pendente' : `Avaliação ${label ?? ''}: brancas com ${Math.round(pct)}% de chance`}
      >
        <div
          className="absolute inset-x-0"
          style={{
            background: 'var(--eval-white)',
            height: `${pct}%`,
            [whiteOnTop ? 'top' : 'bottom']: 0,
            transition: 'height 240ms ease',
          }}
        />
        <div className="absolute inset-x-0 h-px" style={{ top: '50%', background: 'rgba(128,128,128,0.6)' }} />
      </div>
      {label && (
        <span aria-hidden className="absolute top-full left-1/2 -translate-x-1/2 mt-1 text-[11px] font-semibold tabular leading-none whitespace-nowrap text-ink-2">
          {label}
        </span>
      )}
    </div>
  )
}

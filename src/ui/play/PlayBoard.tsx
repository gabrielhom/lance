import { Chessboard, defaultPieces } from 'react-chessboard'
import type { PieceDropHandlerArgs, PieceHandlerArgs, SquareHandlerArgs } from 'react-chessboard'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Color, Square } from '../../domain/types'
import type { PlayPosition } from '../../play'
import { BOARD_STYLE } from '../boardStyle'

const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const PROMOTIONS = [
  { piece: 'q', label: 'Dama' },
  { piece: 'n', label: 'Cavalo' },
  { piece: 'r', label: 'Torre' },
  { piece: 'b', label: 'Bispo' },
] as const

type Props = {
  position: PlayPosition
  orientation: Color
  /** Whether the side to move is played from this device right now. */
  interactive: boolean
  onMove: (uci: string) => void
}

/** Click-to-move and drag. The board is pointer-only; the move input next to it is the keyboard and screen reader path. */
export function PlayBoard({ position, orientation, interactive, onMove }: Props) {
  const [selected, setSelected] = useState<{ fen: string; square: Square } | null>(null)
  const [promotion, setPromotion] = useState<{ fen: string; from: Square; to: Square } | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const active = interactive && selected?.fen === position.fen ? selected.square : null
  const pending = promotion?.fen === position.fen && interactive ? promotion : null

  // dnd-kit makes every piece a focusable role=button with no name. The board is hidden from assistive tech,
  // so its pieces must leave the tab order too, including the ones react-chessboard mounts after each move.
  useLayoutEffect(() => {
    const el = boardRef.current
    if (!el) return
    const strip = () => el.querySelectorAll('[tabindex]:not([tabindex="-1"])').forEach((n) => n.setAttribute('tabindex', '-1'))
    strip()
    const mo = new MutationObserver(strip)
    mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['tabindex'] })
    return () => mo.disconnect()
  }, [])

  const targets = active ? (position.targets.get(active) ?? []) : []
  const attempt = (from: Square, to: Square): boolean => {
    const t = position.targets.get(from)?.find((x) => x.to === to)
    if (!t) return false
    setSelected(null)
    if (t.promotion) {
      setPromotion({ fen: position.fen, from, to })
      return false
    }
    onMove(`${from}${to}`)
    return true
  }
  const mine = (square: string) => position.targets.has(square as Square)

  // react-chessboard keeps the drop handler from the moment a drag starts, so read the latest one through a ref.
  const latest = useRef({ attempt, interactive })
  useEffect(() => {
    latest.current = { attempt, interactive }
  })

  const onSquareClick = ({ square }: SquareHandlerArgs) => {
    if (!interactive) return
    const sq = square as Square
    if (active && active !== sq && attempt(active, sq)) return
    if (active && targets.some((t) => t.to === sq)) return
    setSelected(mine(sq) && active !== sq ? { fen: position.fen, square: sq } : null)
  }

  const highlight = useMemo(() => {
    const s: Record<string, string[]> = {}
    const add = (sq: string, layer: string) => (s[sq] ??= []).push(layer)
    if (position.check) add(position.kingSquare, 'radial-gradient(circle, rgba(255,40,40,0.95) 0%, rgba(230,0,0,0.55) 40%, rgba(170,0,0,0) 72%)')
    if (position.lastMove) {
      add(position.lastMove.from, 'linear-gradient(var(--board-last), var(--board-last))')
      add(position.lastMove.to, 'linear-gradient(var(--board-last), var(--board-last))')
    }
    if (active) add(active, 'linear-gradient(var(--board-selected), var(--board-selected))')
    return s
  }, [position, active])
  const targetSet = new Set(targets.map((t) => t.to))

  const squareRenderer = ({ square, piece, children }: SquareHandlerArgs & { children?: ReactNode }) => {
    const layers = highlight[square]
    const style: CSSProperties = { width: '100%', height: '100%', position: 'relative', ...(layers ? { background: layers.join(', ') } : null) }
    return (
      <div style={style}>
        {children}
        {targetSet.has(square as Square) && <span aria-hidden className={piece ? 'board-ring' : 'board-dot'} />}
      </div>
    )
  }

  return (
    <div className="relative w-full select-none" style={{ touchAction: 'manipulation' }}>
      <div ref={boardRef} aria-hidden>
        <Chessboard
          options={{
            ...BOARD_STYLE,
            id: 'jogo',
            position: position.fen,
            boardOrientation: orientation === 'w' ? 'white' : 'black',
            allowDragging: interactive,
            allowDrawingArrows: false,
            showAnimations: !REDUCED_MOTION,
            animationDurationInMs: 160,
            dragActivationDistance: 4,
            canDragPiece: ({ square }: PieceHandlerArgs) => interactive && !!square && mine(square),
            onPieceDrag: ({ square }: PieceHandlerArgs) => {
              if (square && latest.current.interactive) setSelected({ fen: position.fen, square: square as Square })
            },
            onPieceDrop: ({ sourceSquare, targetSquare }: PieceDropHandlerArgs) =>
              !!targetSquare && latest.current.interactive && latest.current.attempt(sourceSquare as Square, targetSquare as Square),
            onSquareClick,
            dropSquareStyle: { boxShadow: 'inset 0 0 0 4px rgba(255,255,255,0.65)' },
            squareRenderer,
          }}
        />
      </div>
      {pending && (
        <PromotionPicker
          to={pending.to}
          color={position.turn}
          orientation={orientation}
          onPick={(piece) => {
            setPromotion(null)
            onMove(`${pending.from}${pending.to}${piece}`)
          }}
          onCancel={() => setPromotion(null)}
        />
      )}
    </div>
  )
}

function PromotionPicker({ to, color, orientation, onPick, onCancel }: { to: Square; color: Color; orientation: Color; onPick: (p: string) => void; onCancel: () => void }) {
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus(), [])
  const file = 'abcdefgh'.indexOf(to[0])
  const col = orientation === 'w' ? file : 7 - file
  const fromTop = (color === 'w') === (orientation === 'w')
  return (
    <div
      className="absolute inset-0 z-20 rounded-[8px]"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Promover o peão para"
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      onPointerDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="absolute flex" style={{ left: `${col * 12.5}%`, width: '12.5%', [fromTop ? 'top' : 'bottom']: 0, flexDirection: fromTop ? 'column' : 'column-reverse' }}>
        {PROMOTIONS.map(({ piece, label }, i) => {
          const Svg = defaultPieces[`${color}${piece.toUpperCase()}`]
          return (
            <button
              key={piece}
              ref={i === 0 ? first : undefined}
              type="button"
              className="promo-btn"
              aria-label={label}
              title={label}
              onClick={() => onPick(piece)}
            >
              <Svg />
            </button>
          )
        })}
      </div>
      <button type="button" className="sr-only focus:not-sr-only focus:absolute focus:bottom-2 focus:left-1/2 focus:-translate-x-1/2 btn btn-sm" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  )
}

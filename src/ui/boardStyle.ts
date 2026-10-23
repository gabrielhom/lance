import type { CSSProperties } from 'react'
import { defaultArrowOptions } from 'react-chessboard'

/** The printed roll-up board both boards share. Coordinates sit outside the frame, drawn by Diagram. */
export const BOARD_STYLE = {
  darkSquareStyle: { backgroundColor: 'var(--sq-dark)', backgroundImage: 'repeating-linear-gradient(135deg, var(--hatch) 0 1px, transparent 1px 5px)' },
  lightSquareStyle: { backgroundColor: 'var(--sq-light)' },
  showNotation: false,
  arrowOptions: { ...defaultArrowOptions, opacity: 0.9 },
} satisfies { darkSquareStyle: CSSProperties; lightSquareStyle: CSSProperties; showNotation: boolean; arrowOptions: typeof defaultArrowOptions }

/** A flat wash over a square, layered as a background so the piece stays on top. */
export const tint = (color: string) => `linear-gradient(${color}, ${color})`

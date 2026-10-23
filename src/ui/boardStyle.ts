import type { CSSProperties } from 'react'

/** The look both boards share. */
export const BOARD_STYLE = {
  boardStyle: { borderRadius: 8, overflow: 'hidden', boxShadow: 'var(--shadow)' },
  darkSquareStyle: { backgroundColor: 'var(--board-dark)' },
  lightSquareStyle: { backgroundColor: 'var(--board-light)' },
  darkSquareNotationStyle: { color: 'var(--board-light)', fontSize: 11, fontWeight: 600 },
  lightSquareNotationStyle: { color: 'var(--board-dark)', fontSize: 11, fontWeight: 600 },
} satisfies Record<string, CSSProperties>

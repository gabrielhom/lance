import { Chess } from 'chess.js'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Fen } from '../../domain/types'

const UCI = /^([a-h][1-8])([a-h][1-8])([nbrq])?$/

/** Resolves typed SAN ("Nf3", "exd5", "e8=Q") or UCI ("g1f3") against the position. */
function resolve(fen: Fen, text: string): string | null {
  const board = new Chess(fen)
  const t = text.trim()
  const uci = UCI.exec(t.toLowerCase())
  try {
    return (uci ? board.move({ from: uci[1], to: uci[2], promotion: uci[3] }) : board.move(t, { strict: false })).lan
  } catch {
    return null
  }
}

type Props = { fen: Fen; disabled: boolean; placeholder: string; onMove: (uci: string) => void }

/** The keyboard and screen reader way to move, since the board itself is pointer-only. The field goes in the
 *  scoresheet cell the move will fill; its error line goes under the sheet, so the two are returned apart. */
export function useMoveEntry({ fen, disabled, placeholder, onMove }: Props): { field: ReactNode; error: ReactNode } {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const field = (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (disabled || !text.trim()) return
        const lan = resolve(fen, text)
        if (!lan) return setError(`"${text.trim()}" não é um lance válido aqui.`)
        setError(null)
        setText('')
        onMove(lan)
      }}
    >
      <input
        id="lance-digitado"
        className="entry"
        aria-label="Digitar um lance"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="send"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'lance-erro' : undefined}
      />
    </form>
  )
  return {
    field,
    error: <p id="lance-erro" className="mt-2 text-sm italic font-serif text-ink min-h-[1lh]" role="alert">{error}</p>,
  }
}

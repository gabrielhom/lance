import { Chess } from 'chess.js'
import { useState } from 'react'
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

/** The keyboard and screen reader way to move, since the board itself is pointer-only. */
export function MoveInput({ fen, disabled, onMove }: { fen: Fen; disabled: boolean; onMove: (uci: string) => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault()
        const lan = resolve(fen, text)
        if (!lan) return setError(`"${text.trim()}" não é um lance válido aqui.`)
        setError(null)
        setText('')
        onMove(lan)
      }}
    >
      <label htmlFor="lance-digitado" className="label mb-0">Digitar um lance</label>
      <div className="flex gap-2">
        <input
          id="lance-digitado"
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e4, Nf3, O-O ou g1f3"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'lance-erro' : undefined}
        />
        <button type="submit" className="btn" disabled={disabled || !text.trim()}>Jogar</button>
      </div>
      <p id="lance-erro" className="text-[13px] text-bad min-h-[1lh]" role="alert">{error}</p>
    </form>
  )
}

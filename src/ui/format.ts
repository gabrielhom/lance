import type { ByColor, Color, GameResult, GameSource, PlayerTag, Position, TimeControl } from '../domain/types'

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
const shortDateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })

export function formatDate(ms: number | null): string | null {
  return ms === null ? null : dateFmt.format(ms)
}
export function formatShortDate(ms: number): string {
  return shortDateFmt.format(ms)
}

const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Accuracy as Lichess and chess books print it, '84,2', the label beside it saying what it is. */
export function formatAccuracy(n: number | null): string {
  return n === null ? '–' : decimal.format(n)
}

/** Joins the parts that are known, so a missing date or clock leaves no placeholder behind. */
export function joinKnown(...parts: (string | null)[]): string {
  return parts.filter((p) => p !== null && p !== '').join(' · ')
}

/** A graph label in Brazilian notation: '+1.3' -> '+1,3'. A mated position shows the result instead of a bare '#'. */
export function formatEval(label: string, position: Position): string {
  if (label === '#') return position.kind === 'checkmate' && position.turn === 'w' ? '0-1' : '1-0'
  if (label === '½') return '½-½'
  return label.replace('.', ',')
}

/** '600+5' -> 'Rápida 10 + 5', '180' -> 'Blitz 3 + 0', '1/86400' -> 'Correspondência', '-' -> 'Sem relógio', unknown -> null. */
export function formatTimeControl(tc: string | null): string | null {
  if (!tc) return null
  if (tc === '-') return 'Sem relógio'
  if (tc.includes('/')) return 'Correspondência'
  const [base, inc = 0] = tc.split('+').map(Number)
  if (!Number.isFinite(base)) return tc
  const estimate = base + 40 * inc
  const category = estimate < 180 ? 'Bullet' : estimate < 480 ? 'Blitz' : estimate < 1500 ? 'Rápida' : 'Clássica'
  const min = base % 60 === 0 ? `${base / 60}` : decimal.format(base / 60)
  return `${category} ${min}\u00a0+\u00a0${inc}`
}

export type Outcome = 'win' | 'loss' | 'draw' | 'unknown'
export function outcomeFor(result: GameResult, color: Color | null): Outcome {
  if (result === '*') return 'unknown'
  if (result === '1/2-1/2') return 'draw'
  if (color === null) return 'unknown'
  return (result === '1-0') === (color === 'w') ? 'win' : 'loss'
}
export const OUTCOME_LABEL: Readonly<Record<Outcome, string>> = { win: 'Vitória', loss: 'Derrota', draw: 'Empate', unknown: 'Em aberto' }

export function resultLabel(result: GameResult): string {
  return result === '1/2-1/2' ? '½–½' : result === '*' ? 'em aberto' : result.replace('-', '–')
}

export function sourceLabel(source: GameSource): string {
  switch (source.kind) {
    case 'lichess': return 'Lichess'
    case 'chesscom': return 'Chess.com'
    case 'pgn': return 'PGN importado'
    case 'played': return 'Jogada no Lance'
  }
}

export function playerLabel(p: PlayerTag): string {
  return p.rating ? `${p.name} (${p.rating})` : p.name
}

export function opponentOf(players: ByColor<PlayerTag>, color: Color | null): PlayerTag {
  return color === 'w' ? players.b : color === 'b' ? players.w : players.b
}

export function colorLabel(c: Color): string {
  return c === 'w' ? 'brancas' : 'pretas'
}

export function formatBytes(n: number): string {
  return n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.round(n / 1e3)} kB`
}

export function moveNumberLabel(index: number): string {
  const n = Math.floor(index / 2) + 1
  return index % 2 === 0 ? `${n}.` : `${n}…`
}

/** '5 + 0' with no-break spaces, as a clock setting reads; 'sem relógio' without one. */
export function formatClock(t: TimeControl): string {
  return t.kind === 'none' ? 'sem relógio' : `${t.initialMs / 60_000} + ${t.incrementMs / 1000}`
}

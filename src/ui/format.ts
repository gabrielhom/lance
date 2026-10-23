import type { ByColor, Color, GameResult, GameSource, PlayerTag } from '../domain/types'

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
const shortDateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })

export function formatDate(ms: number | null): string {
  return ms === null ? 'data desconhecida' : dateFmt.format(ms)
}
export function formatShortDate(ms: number): string {
  return shortDateFmt.format(ms)
}

export function formatPct(n: number | null, digits = 1): string {
  return n === null ? '–' : `${n.toFixed(digits)}%`
}

/** '600+5' -> 'Rápida 10+5', '180' -> 'Blitz 3 min', '1/86400' -> 'Correspondência', '-' -> 'Sem relógio'. */
export function formatTimeControl(tc: string | null): string {
  if (!tc || tc === '-') return 'Sem relógio'
  if (tc.includes('/')) return 'Correspondência'
  const [base, inc = 0] = tc.split('+').map(Number)
  if (!Number.isFinite(base)) return tc
  const estimate = base + 40 * inc
  const category = estimate < 180 ? 'Bullet' : estimate < 480 ? 'Blitz' : estimate < 1500 ? 'Rápida' : 'Clássica'
  const min = base % 60 === 0 ? `${base / 60}` : (base / 60).toFixed(1)
  return `${category} ${inc ? `${min}+${inc}` : `${min} min`}`
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
  return result === '1/2-1/2' ? '½-½' : result === '*' ? 'em aberto' : result
}

export function sourceLabel(source: GameSource): string {
  switch (source.kind) {
    case 'lichess': return 'Lichess'
    case 'chesscom': return 'Chess.com'
    case 'pgn': return 'PGN'
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
  return index % 2 === 0 ? `${n}.` : `${n}...`
}

import type { Color, PlayState, Termination } from '../../domain/types'

type Over = Extract<PlayState, { phase: 'over' }>
type Tone = 'win' | 'loss' | 'draw'
type Decisive = 'checkmate' | 'timeout' | 'resignation'

const DECISIVE: Readonly<Record<Decisive, { won: string; lost: string; side: string }>> = {
  checkmate: { won: 'Você venceu por xeque-mate', lost: 'Você perdeu por xeque-mate', side: 'vencem por xeque-mate' },
  timeout: { won: 'Você venceu no tempo', lost: 'Você perdeu no tempo', side: 'vencem no tempo' },
  resignation: { won: 'Você venceu por abandono', lost: 'Você abandonou a partida', side: 'vencem por abandono' },
}
const DRAW: Readonly<Record<Exclude<Termination, 'checkmate' | 'resignation'>, string>> = {
  stalemate: 'Empate por afogamento',
  repetition: 'Empate por repetição',
  'fifty-move': 'Empate pela regra dos 50 lances',
  'insufficient-material': 'Empate por material insuficiente',
  timeout: 'Empate no tempo',
}

/** `you` is null in a local game, where the result is told by color instead. */
export function resultTitle(state: Over, you: Color | null): { title: string; detail: string | null; tone: Tone } {
  if (state.result === '1/2-1/2') {
    const t = state.termination as keyof typeof DRAW
    const detail = t === 'timeout' ? 'O tempo acabou, mas quem sobrou não tinha material para dar mate.' : null
    return { title: DRAW[t], detail, tone: 'draw' }
  }
  const winner: Color = state.result === '1-0' ? 'w' : 'b'
  const t = DECISIVE[state.termination as Decisive]
  if (you === null) return { title: `${winner === 'w' ? 'Brancas' : 'Pretas'} ${t.side}`, detail: null, tone: 'win' }
  return winner === you ? { title: t.won, detail: null, tone: 'win' } : { title: t.lost, detail: null, tone: 'loss' }
}

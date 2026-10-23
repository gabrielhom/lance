import type { ByColor, PlayState, Termination } from '../domain/types'
import { replay } from './play'

/** The PGN standard's Termination values, as Lichess writes them. The precise reason stays in PlayState. */
const TERMINATION_TAG: Readonly<Record<Termination, string>> = {
  checkmate: 'Normal',
  stalemate: 'Normal',
  repetition: 'Normal',
  'fifty-move': 'Normal',
  'insufficient-material': 'Normal',
  resignation: 'Normal',
  timeout: 'Time forfeit',
}

export function toPgn(state: PlayState, names: ByColor<string>): string {
  const board = replay(state.moves)
  const start = new Date(state.startedAt).toISOString()
  const date = start.slice(0, 10).replace(/-/g, '.')
  const time = state.setup.time
  const tags: [string, string][] = [
    ['Event', 'Lance'],
    ['Date', date],
    ['White', names.w],
    ['Black', names.b],
    ['Result', state.phase === 'over' ? state.result : '*'],
    ['UTCDate', date],
    ['UTCTime', start.slice(11, 19)],
    ['TimeControl', time.kind === 'clock' ? `${time.initialMs / 1000}+${time.incrementMs / 1000}` : '-'],
  ]
  if (state.phase === 'over') tags.push(['Termination', TERMINATION_TAG[state.termination]])
  for (const [k, v] of tags) board.setHeader(k, v)
  return board.pgn()
}

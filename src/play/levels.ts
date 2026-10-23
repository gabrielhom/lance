import type { PlayLevel } from '../domain/types'

/** Stockfish's UCI_Elo floor is 1320, so the weakest levels use Skill Level with a short think instead.
 *  Nobody has calibrated those against human ratings, hence the vague label. */
export const LEVELS: readonly PlayLevel[] = [
  { id: 1, name: 'Iniciante', rating: 'abaixo de 1300', strength: { kind: 'skill', level: 0 }, movetimeMs: 50 },
  { id: 2, name: 'Casual', rating: 'abaixo de 1300', strength: { kind: 'skill', level: 3 }, movetimeMs: 100 },
  { id: 3, name: 'Clube', rating: '~1400', strength: { kind: 'elo', elo: 1400 }, movetimeMs: 200 },
  { id: 4, name: 'Intermediário', rating: '~1700', strength: { kind: 'elo', elo: 1700 }, movetimeMs: 300 },
  { id: 5, name: 'Avançado', rating: '~2000', strength: { kind: 'elo', elo: 2000 }, movetimeMs: 400 },
  { id: 6, name: 'Especialista', rating: '~2300', strength: { kind: 'elo', elo: 2300 }, movetimeMs: 600 },
  { id: 7, name: 'Mestre', rating: '~2600', strength: { kind: 'elo', elo: 2600 }, movetimeMs: 800 },
  { id: 8, name: 'Grande mestre', rating: '~2900', strength: { kind: 'elo', elo: 2900 }, movetimeMs: 1000 },
  { id: 9, name: 'Elite', rating: '~3190', strength: { kind: 'elo', elo: 3190 }, movetimeMs: 1500 },
  { id: 10, name: 'Máximo', rating: 'força total', strength: { kind: 'max' }, movetimeMs: 2000 },
]

export const DEFAULT_LEVEL_ID = 3

export function levelById(id: number): PlayLevel | null {
  return LEVELS.find((l) => l.id === id) ?? null
}

import { href } from '../router'

/** The three ways to train: positions from my own games, puzzles from Lichess, or the variations of an opening. */
export function TrainingModes({ current }: { current: 'mistakes' | 'puzzles' | 'openings' }) {
  return (
    <nav aria-label="Modo de treino" className="modes">
      <a href={href({ name: 'training', games: [] })} className="choice" aria-current={current === 'mistakes' ? 'page' : undefined}>Seus erros</a>
      <a href={href({ name: 'puzzles' })} className="choice" aria-current={current === 'puzzles' ? 'page' : undefined}>Puzzles</a>
      <a href={href({ name: 'openings' })} className="choice" aria-current={current === 'openings' ? 'page' : undefined}>Aberturas</a>
    </nav>
  )
}

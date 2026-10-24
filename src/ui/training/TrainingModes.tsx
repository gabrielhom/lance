import { href } from '../router'

/** The two ways to train: positions from my own games, or puzzles from Lichess. */
export function TrainingModes({ current }: { current: 'mistakes' | 'puzzles' }) {
  return (
    <nav aria-label="Modo de treino" className="modes">
      <a href={href({ name: 'training', game: null })} className="choice" aria-current={current === 'mistakes' ? 'page' : undefined}>Seus erros</a>
      <a href={href({ name: 'puzzles' })} className="choice" aria-current={current === 'puzzles' ? 'page' : undefined}>Puzzles</a>
    </nav>
  )
}

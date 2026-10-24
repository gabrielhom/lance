import { useEffect, useState } from 'react'
import { playerRating } from '../../puzzles'
import { trainingProgress } from '../../training'
import { href } from '../router'
import { useServices } from '../services'

type Nudge = { readonly kind: 'due'; readonly due: number } | { readonly kind: 'puzzles'; readonly rating: number }

/** One tap from the home screen into training: today's positions from my mistakes, or puzzles when none are due. */
export function DueToday({ className }: { className?: string }) {
  const services = useServices()
  const [nudge, setNudge] = useState<Nudge | null>(null)
  useEffect(() => {
    let alive = true
    Promise.all([services.training.list(), services.puzzles.attempts()]).then(([items, attempts]) => {
      if (!alive) return
      const { due } = trainingProgress(items, Date.now())
      setNudge(due > 0 ? { kind: 'due', due } : { kind: 'puzzles', rating: Math.round(playerRating(attempts).rating) })
    })
    return () => {
      alive = false
    }
  }, [services])
  if (!nudge) return null
  return nudge.kind === 'due' ? (
    <p className={className}>
      <a href={href({ name: 'training', game: null })} className="tl tl-accent">Treinar {nudge.due === 1 ? '1 posição' : `${nudge.due} posições`} dos seus erros</a>
      <span className="caption ml-2">para hoje</span>
    </p>
  ) : (
    <p className={className}>
      <a href={href({ name: 'puzzles' })} className="tl tl-accent">Resolver puzzles</a>
      <span className="caption ml-2">rating {nudge.rating}</span>
    </p>
  )
}

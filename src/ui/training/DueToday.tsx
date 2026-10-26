import { useEffect, useState } from 'react'
import type { Services } from '../../domain/types'
import { dueCount } from '../../openings'
import { playerRating } from '../../puzzles'
import { trainingProgress } from '../../training'
import { href } from '../router'
import { useServices } from '../services'

type Nudge = { readonly due: number; readonly lines: number; readonly rating: number }

/** One tap from the home screen into training: today's positions from my mistakes and opening lines, or puzzles when none are due. */
export function DueToday({ className }: { className?: string }) {
  const services = useServices()
  const [nudge, setNudge] = useState<Nudge | null>(null)
  useEffect(() => {
    let alive = true
    const now = Date.now()
    Promise.all([services.training.list(), services.puzzles.attempts(), openingsDue(services.openings, now)]).then(([items, attempts, lines]) => {
      if (!alive) return
      setNudge({ due: trainingProgress(items, now).due, lines, rating: Math.round(playerRating(attempts).rating) })
    })
    return () => {
      alive = false
    }
  }, [services])
  if (!nudge) return null
  if (nudge.due === 0 && nudge.lines === 0) {
    return (
      <p className={className}>
        <a href={href({ name: 'puzzles' })} className="tl tl-accent">Resolver puzzles</a>
        <span className="caption ml-2">rating {nudge.rating}</span>
      </p>
    )
  }
  return (
    <div className={className}>
      {nudge.due > 0 && (
        <p>
          <a href={href({ name: 'training', games: [] })} className="tl tl-accent">Treinar {nudge.due === 1 ? '1 posição' : `${nudge.due} posições`} dos seus erros</a>
          <span className="caption ml-2">para hoje</span>
        </p>
      )}
      {nudge.lines > 0 && (
        <p>
          <a href={href({ name: 'openings' })} className="tl tl-accent">Revisar {nudge.lines === 1 ? '1 variação de abertura' : `${nudge.lines} variações de abertura`}</a>
          <span className="caption ml-2">para hoje</span>
        </p>
      )}
    </div>
  )
}

/** The lines chunk loads only for someone with an opening line due; without it the count stays at zero. */
async function openingsDue(openings: Services['openings'], now: number): Promise<number> {
  const progress = await openings.progress()
  if (!progress.some((p) => p.schedule.due <= now)) return 0
  return openings.tree().then((tree) => dueCount(tree, progress, now), () => 0)
}

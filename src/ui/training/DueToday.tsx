import { useEffect, useState } from 'react'
import { trainingProgress } from '../../training'
import { useServices } from '../services'

/** One tap from the home screen into today's training, shown only when something is due. */
export function DueToday({ className }: { className?: string }) {
  const services = useServices()
  const [due, setDue] = useState(0)
  useEffect(() => {
    let alive = true
    services.training.list().then((items) => alive && setDue(trainingProgress(items, Date.now()).due))
    return () => {
      alive = false
    }
  }, [services])
  if (due === 0) return null
  return (
    <p className={className}>
      <a href="#/treino" className="tl tl-accent">Treinar {due === 1 ? '1 posição' : `${due} posições`} dos seus erros</a>
      <span className="caption ml-2">para hoje</span>
    </p>
  )
}

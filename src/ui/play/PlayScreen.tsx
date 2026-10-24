import { useEffect, useRef, useState } from 'react'
import type { PlayState } from '../../domain/types'
import { newPlay } from '../../play'
import { useServices } from '../services'
import { GameView } from './GameView'
import { Setup } from './Setup'

/** The game in progress lives here and in storage, so a reload resumes it with the clocks where they were. */
export function PlayScreen() {
  const services = useServices()
  const [play, setPlay] = useState<PlayState | null>(() => services.loadPlay())
  const latest = useRef(play)
  useEffect(() => {
    latest.current = play
    services.savePlay(play)
  }, [services, play])
  // Refreshes the save stamp when the page leaves, so the time away is not charged to the clock on reload.
  useEffect(() => {
    const save = () => services.savePlay(latest.current)
    const onVisibility = () => document.visibilityState === 'hidden' && save()
    addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [services])

  if (!play) return <Setup onStart={(setup) => setPlay(newPlay(setup, Date.now()))} />
  return <GameView key={play.id} state={play} setPlay={setPlay} onNew={() => setPlay(null)} />
}

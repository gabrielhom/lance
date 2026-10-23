import { useEffect, useState } from 'react'
import type { PlayState } from '../../domain/types'
import { newPlay } from '../../play'
import { useServices } from '../services'
import { GameView } from './GameView'
import { Setup } from './Setup'

/** The game in progress lives here and in storage, so a reload resumes it with the clocks where they were. */
export function PlayScreen() {
  const services = useServices()
  const [play, setPlay] = useState<PlayState | null>(() => services.loadPlay())
  useEffect(() => {
    services.savePlay(play)
  }, [services, play])

  if (!play) return <Setup onStart={(setup) => setPlay(newPlay(setup, Date.now()))} />
  return <GameView key={play.id} state={play} setPlay={setPlay} onNew={() => setPlay(null)} />
}

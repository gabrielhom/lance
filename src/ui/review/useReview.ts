import { useCallback, useEffect, useRef, useState } from 'react'
import type { Game, ReviewState } from '../../domain/types'
import { useServices } from '../services'

export type ReviewRun =
  | { readonly kind: 'running'; readonly state: ReviewState | null }
  | { readonly kind: 'cancelled'; readonly state: ReviewState | null }

const FRESH: ReviewRun = { kind: 'running', state: null }

export function useReview(game: Game): { run: ReviewRun; cancel: () => void; restart: () => void } {
  const services = useServices()
  const [attempt, setAttempt] = useState(0)
  const [stored, setStored] = useState<{ attempt: number; run: ReviewRun }>({ attempt: 0, run: FRESH })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    abortRef.current = ac
    void (async () => {
      try {
        for await (const s of services.reviewGame(game, ac.signal)) {
          if (ac.signal.aborted) return
          setStored({ attempt, run: { kind: 'running', state: s } })
        }
      } catch (e) {
        if (!ac.signal.aborted) throw e
      }
    })()
    return () => ac.abort()
  }, [services, game, attempt])

  const run = stored.attempt === attempt ? stored.run : FRESH
  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setStored((s) => ({ attempt, run: { kind: 'cancelled', state: s.attempt === attempt ? s.run.state : null } }))
  }, [attempt])
  const restart = useCallback(() => setAttempt((a) => a + 1), [])
  return { run, cancel, restart }
}

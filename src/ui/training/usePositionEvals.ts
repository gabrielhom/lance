import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlayablePosition, PositionKey } from '../../domain'
import { failureReason } from '../../engine'
import type { EvalStatus, EvalsOf } from '../../openings'
import { useServices } from '../services'

export type PositionEvals = {
  /** A position never asked for reads 'pending'. */
  readonly evals: EvalsOf
  /** Searches each position not asked for yet, in the order given. Asking again for one does nothing. */
  readonly want: (positions: readonly PlayablePosition[]) => void
  /** Forgets the failures, so the next want() searches them again. */
  readonly retry: () => void
}

/** Evaluations kept by position for the screen's lifetime, so a takeback, a transposition or the next round reads them
 *  again for free. The only writer of evaluations; leaving the screen stops every search. */
export function usePositionEvals(): PositionEvals {
  const services = useServices()
  const [results, setResults] = useState<ReadonlyMap<PositionKey, EvalStatus>>(() => new Map())
  const asked = useRef(new Set<PositionKey>())
  const signal = useRef<AbortSignal | null>(null)
  useEffect(() => {
    const ac = new AbortController()
    const keys = asked.current
    signal.current = ac.signal
    return () => {
      ac.abort()
      keys.clear()
    }
  }, [])

  const want = useCallback(
    (positions: readonly PlayablePosition[]) => {
      const live = signal.current
      if (!live) return
      for (const p of positions) {
        if (asked.current.has(p.key)) continue
        asked.current.add(p.key)
        services.evaluatePosition(p, live).then(
          (e) => setResults((r) => new Map(r).set(p.key, { kind: 'done', eval: e })),
          (error: unknown) => {
            if (!live.aborted) setResults((r) => new Map(r).set(p.key, { kind: 'failed', reason: failureReason(error) }))
          },
        )
      }
    },
    [services],
  )
  const evals = useCallback<EvalsOf>((p) => results.get(p.key) ?? { kind: 'pending' }, [results])
  const retry = useCallback(() => {
    setResults((r) => {
      const next = new Map(r)
      for (const [key, status] of r) {
        if (status.kind !== 'failed') continue
        next.delete(key)
        asked.current.delete(key)
      }
      return next
    })
  }, [])
  return { evals, want, retry }
}

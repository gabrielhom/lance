import { useEffect, useSyncExternalStore } from 'react'
import type { Game } from '../../domain/types'
import { useServices } from '../services'
import { cancelReview, releaseReview, reviewRun, startReview, subscribeReviews, type ReviewRun } from './runs'

const STARTING: ReviewRun = { kind: 'running', state: null }

export function useReview(game: Game): { run: ReviewRun; cancel: () => void; restart: () => void } {
  const services = useServices()
  useEffect(() => {
    startReview(services, game)
    return () => releaseReview(game)
  }, [services, game])
  const run = useSyncExternalStore(subscribeReviews, () => reviewRun(game.id) ?? STARTING)
  return { run, cancel: () => cancelReview(game.id), restart: () => startReview(services, game) }
}

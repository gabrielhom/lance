import { useEffect, useState, useSyncExternalStore } from 'react'
import type { LibraryRecord } from '../../domain/types'
import { finishedReviews, subscribeReviews } from '../review/runs'
import { useServices } from '../services'

/** The library, null while it loads, read again whenever a review finishes. */
export function useLibrary(): { records: readonly LibraryRecord[] | null; unreadable: number } {
  const services = useServices()
  const [records, setRecords] = useState<readonly LibraryRecord[] | null>(null)
  const [unreadable, setUnreadable] = useState(0)
  // A game played just before keeps being reviewed in the background and lands in the library when it finishes.
  const finished = useSyncExternalStore(subscribeReviews, finishedReviews)
  useEffect(() => {
    let alive = true
    services.library.list().then((l) => alive && setRecords(l))
    services.library.unreadable().then((n) => alive && setUnreadable(n))
    return () => {
      alive = false
    }
  }, [services, finished])
  return { records, unreadable }
}

import {
  type AnalysisProfile,
  type EngineDescriptor,
  type EngineFailureReason,
  type EngineTuning,
  type EvalCache,
  type EvalKey,
  type EvalProgress,
  type Evaluator,
  type PositionKey,
  type RuntimeEnv,
  type SearchedEval,
  type SearchLimit,
} from '../domain/types'
import { availability, effectiveTuning, engineId, expectedFor } from './descriptor'
import { abortError, EngineFailure } from './failure'
import { openSession, type SearchJob, type SearchOutcome, type Session } from './session'
import { connect as connectTransport, type Connect } from './transport'

type Job = {
  readonly search: SearchJob
  /** min(2, legal moves): Stockfish prints one row per legal move at most. */
  readonly expected: 1 | 2
  readonly key: EvalKey
  readonly signal: AbortSignal
  readonly onProgress: (e: EvalProgress) => void
  readonly resolve: (e: SearchedEval) => void
  readonly reject: (error: unknown) => void
  attempt: 0 | 1
}

export function evalKey(profile: AnalysisProfile, position: PositionKey): EvalKey {
  const limit = profile.limit.kind === 'depth' ? `d${profile.limit.depth}` : `t${profile.limit.ms}`
  return `c3|${profile.engine}|${limit}|mpv2|${position}` as EvalKey
}

/** Every position starts from a cleared engine. Otherwise an eval depends on what its pool worker searched before,
 *  and that depends on timing, so the same game would get a different review each time. */
// A few positions cost 10x the median at a fixed depth (the move before a mate, where line 2 searches deep).
// The cap stops only those: the median Opera game position at depth 18 needs about 0.6M nodes.
const ANALYSIS = { options: { MultiPV: '2' }, fresh: true, maxNodes: 3_000_000 } as const

/** Cache first, then a FIFO queue over a pool of sessions, urgent jobs first. A crashed search gets one retry on a fresh engine. */
export function createEvaluator(
  d: EngineDescriptor,
  limit: SearchLimit,
  tuning: EngineTuning,
  cache: EvalCache,
  env: RuntimeEnv,
  connect: Connect = connectTransport,
): Evaluator {
  const profile: AnalysisProfile = { engine: engineId(d), limit }
  const pool = effectiveTuning(d, tuning, env)
  const usable = availability(d, env)
  const queue: Job[] = []
  const idle: Session[] = []
  const busy = new Set<Session>()
  let booting = 0
  let bootCrashes = 0
  let broken: EngineFailureReason | null = null
  let disposed = false

  function pump() {
    while (queue.length > 0) {
      const session = idle.pop()
      if (session?.state === 'dead') continue
      if (session) {
        run(session, queue.shift()!)
        continue
      }
      const live = booting + busy.size
      if (broken && live === 0) {
        const reason = broken
        broken = null
        bootCrashes = 0
        for (const job of queue.splice(0)) job.reject(new EngineFailure(reason))
        return
      }
      if (broken || booting >= queue.length || live >= pool.engines) return
      boot()
    }
  }

  function boot() {
    booting++
    const onLoading = (loaded: number, total: number) => {
      for (const job of queue) job.onProgress({ kind: 'engine-loading', loaded, total })
    }
    const opening = async () => openSession(connect(d), pool, expectedFor(d), onLoading)
    opening().then(
      (session) => {
        booting--
        bootCrashes = 0
        if (disposed) return session.close()
        idle.push(session)
        pump()
      },
      (error: unknown) => {
        booting--
        const reason = error instanceof EngineFailure ? error.reason : { kind: 'crashed' as const, detail: String(error) }
        if (reason.kind !== 'crashed' || ++bootCrashes >= 2) broken = reason
        if (!disposed) pump()
      },
    )
  }

  function run(session: Session, job: Job) {
    busy.add(session)
    const onDepth = (depth: number) => job.onProgress({ kind: 'depth', depth })
    session.search(job.search, job.signal, onDepth).then((outcome) => answer(outcome, job.expected)).then(
      (result) => {
        cache.put(job.key, result).catch(() => {})
        job.resolve(result)
      },
      (error: unknown) => {
        if (error instanceof EngineFailure && error.reason.kind === 'crashed' && job.attempt === 0 && !disposed) {
          job.attempt = 1
          queue.unshift(job)
        } else {
          job.reject(error)
        }
      },
    ).finally(() => {
      busy.delete(session)
      if (session.state !== 'dead') idle.push(session)
      if (!disposed) pump()
    })
  }

  function answer(outcome: SearchOutcome, expected: 1 | 2): SearchedEval {
    const found = outcome.lines.pick(expected, limit)
    if (!found) throw new EngineFailure({ kind: 'protocol', detail: `no depth with ${expected} exact lines` })
    return found
  }

  return {
    profile,
    async evaluate(p, signal, onProgress = () => {}, urgent = false) {
      if (disposed || signal.aborted) throw abortError()
      const key = evalKey(profile, p.key)
      const hit = await cache.get(key).catch(() => null)
      if (hit) return hit
      if (disposed || signal.aborted) throw abortError()
      if (!usable.ok) throw new EngineFailure({ kind: 'unavailable', why: usable.error })
      return new Promise<SearchedEval>((resolve, reject) => {
        const onAbort = () => {
          const at = queue.indexOf(job)
          if (at < 0) return
          queue.splice(at, 1)
          reject(abortError())
        }
        const job: Job = {
          search: { input: p.input, turn: p.turn, limit, ...ANALYSIS },
          expected: p.legalMoves >= 2 ? 2 : 1,
          key,
          signal,
          onProgress,
          resolve: (v) => {
            signal.removeEventListener('abort', onAbort)
            resolve(v)
          },
          reject: (e) => {
            signal.removeEventListener('abort', onAbort)
            reject(e)
          },
          attempt: 0,
        }
        signal.addEventListener('abort', onAbort)
        if (urgent) queue.unshift(job)
        else queue.push(job)
        pump()
      })
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const job of queue.splice(0)) job.reject(abortError())
      for (const session of [...idle.splice(0), ...busy]) session.close()
    },
  }
}

import type { Color, EngineFailureReason, EngineInput, EngineTuning, SearchedEval, SearchLimit } from '../domain/types'
import { abortError, EngineFailure } from './failure'
import type { LineTransport, TransportEvent } from './transport'
import { goCommand, lineCollector, parseUciLine, positionCommand, type UciMessage } from './uci'

export type SearchJob = {
  readonly input: EngineInput
  readonly turn: Color
  /** min(2, legal moves): Stockfish prints one row per legal move at most. */
  readonly expected: 1 | 2
  readonly limit: SearchLimit
}

/** What the handshake must report, so every eval cached under a static EngineId comes from that evaluation function. */
export type Expected = { readonly kind: 'eval-file'; readonly evalFile: string } | { readonly kind: 'id-name'; readonly idName: string }

export interface Session {
  readonly state: State['kind']
  search(job: SearchJob, signal: AbortSignal, onDepth: (depth: number) => void): Promise<SearchedEval>
  /** Sends quit and drops the transport. A search in flight rejects with AbortError. */
  close(): void
}

/** Silence means a hung engine: a live Stockfish prints at least every few seconds while it searches. */
export const TIMEOUTS = { silenceMs: 60_000, stopMs: 10_000 }

type Pending<T> = { readonly resolve: (value: T) => void; readonly reject: (error: unknown) => void }
type State =
  | { readonly kind: 'booting'; readonly pending: Pending<Session>; readonly phase: 'uci' | 'ready'; readonly idName: string | null; readonly options: ReadonlyMap<string, string | null> }
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching'; readonly pending: Pending<SearchedEval>; readonly job: SearchJob; readonly lines: ReturnType<typeof lineCollector>; readonly onDepth: (depth: number) => void }
  /** `stop` is out. Nothing else is sent until its bestmove arrives, which settles the search as aborted. */
  | { readonly kind: 'stopping'; readonly pending: Pending<SearchedEval> }
  | { readonly kind: 'dead' }

export function openSession(
  transport: LineTransport,
  tuning: EngineTuning,
  expected: Expected,
  onLoading: (loaded: number, total: number) => void = () => {},
): Promise<Session> {
  return new Promise((resolve, reject) => {
    let state: State = { kind: 'booting', pending: { resolve, reject }, phase: 'uci', idName: null, options: new Map() }
    let timer: ReturnType<typeof setTimeout> | undefined

    const arm = (ms: number) => {
      clearTimeout(timer)
      timer = setTimeout(onTimeout, ms)
    }

    function die(cause: EngineFailureReason | 'aborted') {
      const was = state
      state = { kind: 'dead' }
      clearTimeout(timer)
      transport.close()
      if (was.kind === 'dead' || was.kind === 'idle') return
      const error = was.kind === 'stopping' || cause === 'aborted' ? abortError() : new EngineFailure(cause)
      was.pending.reject(error)
    }

    function onTimeout() {
      die({ kind: 'timeout', during: state.kind === 'booting' ? 'handshake' : 'search' })
    }

    function onEvent(e: TransportEvent) {
      if (state.kind === 'dead') return
      if (e.kind === 'closed') return die(e.reason)
      if (state.kind === 'booting' || state.kind === 'searching') arm(TIMEOUTS.silenceMs)
      if (e.kind === 'loading') return onLoading(e.loaded, e.total)
      const msg = parseUciLine(e.line)
      if (state.kind === 'booting') onBoot(state, msg)
      else if (state.kind === 'searching') onSearch(state, msg)
      else if (state.kind === 'stopping' && msg.kind === 'bestmove') settle(state.pending, abortError())
    }

    function onBoot(s: Extract<State, { kind: 'booting' }>, msg: UciMessage) {
      if (s.phase === 'uci') {
        if (msg.kind === 'id-name') state = { ...s, idName: msg.name }
        else if (msg.kind === 'option') state = { ...s, options: new Map(s.options).set(msg.name, msg.default) }
        else if (msg.kind === 'uciok') afterUciOk(s)
      } else if (msg.kind === 'readyok') {
        state = { kind: 'idle' }
        clearTimeout(timer)
        s.pending.resolve(session)
      }
    }

    function afterUciOk(s: Extract<State, { kind: 'booting' }>) {
      const want = expected.kind === 'eval-file' ? expected.evalFile : expected.idName
      const got = expected.kind === 'eval-file' ? s.options.get('EvalFile') : s.idName
      if (got !== want) return die({ kind: 'mismatch', expected: want, got: got ?? '(none)' })
      if (!s.options.has('MultiPV')) return die({ kind: 'protocol', detail: 'the engine has no MultiPV option' })
      state = { ...s, phase: 'ready' }
      if (s.options.has('Threads')) transport.send(`setoption name Threads value ${tuning.threadsPerEngine}`)
      if (s.options.has('Hash')) transport.send(`setoption name Hash value ${tuning.hashMb}`)
      transport.send('setoption name MultiPV value 2')
      transport.send('isready')
    }

    function onSearch(s: Extract<State, { kind: 'searching' }>, msg: UciMessage) {
      if (msg.kind === 'pv') {
        const before = s.lines.deepest
        s.lines.add(msg)
        if (s.lines.deepest > before) s.onDepth(s.lines.deepest)
      } else if (msg.kind === 'bestmove') {
        const result = msg.move === null ? null : s.lines.pick(s.job.expected, s.job.limit)
        settle(s.pending, result ?? new EngineFailure({ kind: 'protocol', detail: msg.move === null ? 'bestmove (none) for a playable position' : `no depth with ${s.job.expected} exact lines` }))
      }
    }

    function settle(pending: Pending<SearchedEval>, outcome: SearchedEval | Error) {
      state = { kind: 'idle' }
      clearTimeout(timer)
      if (outcome instanceof Error) pending.reject(outcome)
      else pending.resolve(outcome)
    }

    const session: Session = {
      get state() {
        return state.kind
      },
      search(job, signal, onDepth) {
        if (state.kind !== 'idle') return Promise.reject(new Error(`search() on a ${state.kind} session`))
        if (signal.aborted) return Promise.reject(abortError())
        return new Promise<SearchedEval>((res, rej) => {
          const onAbort = () => {
            if (state.kind !== 'searching' || state.pending !== pending) return
            state = { kind: 'stopping', pending }
            arm(TIMEOUTS.stopMs)
            transport.send('stop')
          }
          const pending: Pending<SearchedEval> = {
            resolve: (v) => {
              signal.removeEventListener('abort', onAbort)
              res(v)
            },
            reject: (e) => {
              signal.removeEventListener('abort', onAbort)
              rej(e)
            },
          }
          signal.addEventListener('abort', onAbort)
          state = { kind: 'searching', pending, job, lines: lineCollector(job.turn), onDepth }
          arm(TIMEOUTS.silenceMs)
          transport.send(positionCommand(job.input))
          transport.send(goCommand(job.limit))
        })
      },
      close() {
        if (state.kind === 'dead') return
        transport.send('quit')
        die('aborted')
      },
    }

    transport.listen(onEvent)
    arm(TIMEOUTS.silenceMs)
    transport.send('uci')
  })
}

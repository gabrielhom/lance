import type { Color, EngineFailureReason, EngineInput, EngineTuning, SearchLimit, Uci } from '../domain/types'
import { abortError, EngineFailure } from './failure'
import type { LineTransport, TransportEvent } from './transport'
import { goCommand, lineCollector, parseUciLine, positionCommand, type LineCollector, type UciMessage, type UciOption } from './uci'

export type SearchJob = {
  readonly input: EngineInput
  readonly turn: Color
  readonly limit: SearchLimit
  /** Option values this search needs. Each must be advertised, and only values that differ from the last ones set are sent. */
  readonly options: Readonly<Record<string, string>>
  /** Sends ucinewgame first, so nothing an earlier search left in the hash or the history tables shapes this one. */
  readonly fresh: boolean
}
export type SearchOutcome = { readonly bestmove: Uci; readonly lines: LineCollector }

/** What the handshake must report, so every eval cached under a static EngineId comes from that evaluation function. */
export type Expected = { readonly kind: 'eval-file'; readonly evalFile: string } | { readonly kind: 'id-name'; readonly idName: string }

export interface Session {
  readonly state: State['kind']
  /** Every option the engine advertised in its handshake, by name. */
  readonly options: ReadonlyMap<string, UciOption>
  search(job: SearchJob, signal: AbortSignal, onDepth: (depth: number) => void): Promise<SearchOutcome>
  /** Sends quit and drops the transport. A search in flight rejects with AbortError. */
  close(): void
}

/** Silence means a hung engine: a live Stockfish prints at least every few seconds while it searches. */
export const TIMEOUTS = { silenceMs: 60_000, stopMs: 10_000 }

type Pending<T> = { readonly resolve: (value: T) => void; readonly reject: (error: unknown) => void }
type Searching = { readonly pending: Pending<SearchOutcome>; readonly onDepth: (depth: number) => void }
type State =
  | { readonly kind: 'booting'; readonly pending: Pending<Session>; readonly phase: 'uci' | 'ready'; readonly idName: string | null; readonly options: ReadonlyMap<string, UciOption> }
  | { readonly kind: 'idle' }
  /** `isready` is out after setoption or ucinewgame. Its readyok starts the search, or settles it if it was aborted meanwhile. */
  | ({ readonly kind: 'syncing'; readonly job: SearchJob; readonly signal: AbortSignal } & Searching)
  | ({ readonly kind: 'searching'; readonly lines: LineCollector } & Searching)
  /** `stop` is out. Nothing else is sent until its bestmove arrives, which settles the search as aborted. */
  | { readonly kind: 'stopping'; readonly pending: Pending<SearchOutcome> }
  | { readonly kind: 'dead' }

export function openSession(
  transport: LineTransport,
  tuning: EngineTuning,
  expected: Expected,
  onLoading: (loaded: number, total: number) => void = () => {},
): Promise<Session> {
  return new Promise((resolve, reject) => {
    let state: State = { kind: 'booting', pending: { resolve, reject }, phase: 'uci', idName: null, options: new Map() }
    let advertised: ReadonlyMap<string, UciOption> = new Map()
    const applied = new Map<string, string>()
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
      if (state.kind === 'booting' || state.kind === 'syncing' || state.kind === 'searching') arm(TIMEOUTS.silenceMs)
      if (e.kind === 'loading') return onLoading(e.loaded, e.total)
      const msg = parseUciLine(e.line)
      if (state.kind === 'booting') onBoot(state, msg)
      else if (state.kind === 'syncing' && msg.kind === 'readyok') {
        if (state.signal.aborted) settle(state.pending, abortError())
        else go(state.job, state)
      } else if (state.kind === 'searching') onSearch(state, msg)
      else if (state.kind === 'stopping' && msg.kind === 'bestmove') settle(state.pending, abortError())
    }

    function onBoot(s: Extract<State, { kind: 'booting' }>, msg: UciMessage) {
      if (s.phase === 'uci') {
        if (msg.kind === 'id-name') state = { ...s, idName: msg.name }
        else if (msg.kind === 'option') state = { ...s, options: new Map(s.options).set(msg.name, msg) }
        else if (msg.kind === 'uciok') afterUciOk(s)
      } else if (msg.kind === 'readyok') {
        state = { kind: 'idle' }
        clearTimeout(timer)
        s.pending.resolve(session)
      }
    }

    function afterUciOk(s: Extract<State, { kind: 'booting' }>) {
      const want = expected.kind === 'eval-file' ? expected.evalFile : expected.idName
      const got = expected.kind === 'eval-file' ? s.options.get('EvalFile')?.default : s.idName
      if (got !== want) return die({ kind: 'mismatch', expected: want, got: got ?? '(none)' })
      state = { ...s, phase: 'ready' }
      advertised = s.options
      if (s.options.has('Threads')) transport.send(`setoption name Threads value ${tuning.threadsPerEngine}`)
      if (s.options.has('Hash')) transport.send(`setoption name Hash value ${tuning.hashMb}`)
      transport.send('isready')
    }

    function go(job: SearchJob, s: Searching) {
      state = { kind: 'searching', pending: s.pending, onDepth: s.onDepth, lines: lineCollector(job.turn) }
      arm(TIMEOUTS.silenceMs)
      transport.send(positionCommand(job.input))
      transport.send(goCommand(job.limit))
    }

    function onSearch(s: Extract<State, { kind: 'searching' }>, msg: UciMessage) {
      if (msg.kind === 'pv') {
        const before = s.lines.deepest
        s.lines.add(msg)
        if (s.lines.deepest > before) s.onDepth(s.lines.deepest)
      } else if (msg.kind === 'bestmove') {
        settle(s.pending, msg.move === null ? new EngineFailure({ kind: 'protocol', detail: 'bestmove (none) for a playable position' }) : { bestmove: msg.move, lines: s.lines })
      }
    }

    function settle(pending: Pending<SearchOutcome>, outcome: SearchOutcome | Error) {
      state = { kind: 'idle' }
      clearTimeout(timer)
      if (outcome instanceof Error) pending.reject(outcome)
      else pending.resolve(outcome)
    }

    const session: Session = {
      get state() {
        return state.kind
      },
      get options() {
        return advertised
      },
      search(job, signal, onDepth) {
        if (state.kind !== 'idle') return Promise.reject(new Error(`search() on a ${state.kind} session`))
        if (signal.aborted) return Promise.reject(abortError())
        const missing = Object.keys(job.options).find((name) => !advertised.has(name))
        if (missing !== undefined) return Promise.reject(new EngineFailure({ kind: 'protocol', detail: `the engine has no ${missing} option` }))
        return new Promise<SearchOutcome>((res, rej) => {
          const onAbort = () => {
            if (state.kind !== 'searching' || state.pending !== pending) return
            state = { kind: 'stopping', pending }
            arm(TIMEOUTS.stopMs)
            transport.send('stop')
          }
          const pending: Pending<SearchOutcome> = {
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
          const changed = Object.entries(job.options).filter(([name, value]) => applied.get(name) !== value)
          for (const [name, value] of changed) {
            applied.set(name, value)
            transport.send(`setoption name ${name} value ${value}`)
          }
          if (job.fresh) transport.send('ucinewgame')
          if (changed.length > 0 || job.fresh) {
            state = { kind: 'syncing', job, signal, pending, onDepth }
            arm(TIMEOUTS.silenceMs)
            transport.send('isready')
          } else {
            go(job, { pending, onDepth })
          }
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

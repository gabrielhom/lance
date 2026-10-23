import type { Color, EvalCache, EvalKey, Fen, PlayablePosition, PositionKey, SearchedEval, Uci } from '../../domain/types'
import type { LineTransport, TransportEvent } from '../transport'
import { TRANSCRIPTS as transcripts, type Recorded, type ScenarioName } from './transcripts'

export type FakeEngine = LineTransport & {
  readonly sent: readonly string[]
  readonly closed: boolean
  emit(line: string): void
  load(loaded: number, total: number): void
  crash(detail?: string): void
}

/**
 * Answers like the recorded engine: its handshake on `uci`, `readyok` on `isready`, and the recorded search for the
 * last recorded position on `go`. `hold` leaves every search line, bestmove included, to the test.
 * `crashOnGo` closes the pipe instead of searching, `silent` never answers anything.
 */
export function fakeEngine(recorded: Recorded = 'lite', opts: { hold?: boolean; crashOnGo?: boolean; silent?: boolean } = {}): FakeEngine {
  const { handshake, scenarios } = transcripts[recorded]
  const sent: string[] = []
  let on: (e: TransportEvent) => void = () => {}
  let closed = false
  let lines: readonly string[] = []
  const later = (events: readonly TransportEvent[]) =>
    queueMicrotask(() => {
      for (const e of events) if (!closed) on(e)
    })
  const reply = (replies: readonly string[]) => later(replies.map((line) => ({ kind: 'line', line })))
  const crash = (detail = 'RuntimeError: unreachable') => {
    later([{ kind: 'closed', reason: { kind: 'crashed', detail } }])
    queueMicrotask(() => (closed = true))
  }

  return {
    sent,
    get closed() {
      return closed
    },
    send(line) {
      if (closed) throw new Error(`send after close: ${line}`)
      sent.push(line)
      if (opts.silent) return
      if (line === 'uci') reply(handshake)
      else if (line === 'isready') reply(['readyok'])
      else if (line.startsWith('position fen ')) {
        const found = Object.values(scenarios).find((s) => line === `position fen ${s.fen}${s.moves.length ? ` moves ${s.moves.join(' ')}` : ''}`)
        lines = found?.lines ?? []
      } else if (line.startsWith('go ')) {
        if (opts.crashOnGo) return crash()
        if (!opts.hold) reply(lines)
      }
    },
    listen(f) {
      on = f
    },
    close() {
      closed = true
    },
    emit(line) {
      reply([line])
    },
    load(loaded, total) {
      later([{ kind: 'loading', loaded, total }])
    },
    crash,
  }
}

export function recordedPosition(name: ScenarioName): PlayablePosition {
  const s = transcripts.lite.scenarios[name]
  const tail = s.moves as Uci[]
  return {
    kind: 'playable',
    index: 0,
    fen: s.fen as Fen,
    turn: s.fen.split(' ')[1] as Color,
    input: { root: s.fen as Fen, tail },
    key: `${s.fen}|${tail.join(' ')}` as PositionKey,
    legalMoves: Math.max(1, s.legalMoves),
  }
}

export function memoryCache(): EvalCache & { readonly rows: Map<EvalKey, SearchedEval> } {
  const rows = new Map<EvalKey, SearchedEval>()
  return {
    rows,
    get: async (key) => rows.get(key) ?? null,
    put: async (key, value) => {
      rows.set(key, value)
    },
  }
}

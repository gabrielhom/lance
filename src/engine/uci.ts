import type { Color, EngineInput, EvalLine, NonEmpty, Score, SearchedEval, SearchLimit, Uci } from '../domain/types'

/** Relative to the side to move, as UCI sends it. `moves` is never 0: a mated side to move is never searched. */
export type RelScore = { readonly kind: 'cp'; readonly cp: number } | { readonly kind: 'mate'; readonly moves: number }
export type Bound = 'exact' | 'lower' | 'upper'
export type PvInfo = {
  readonly kind: 'pv'
  readonly depth: number
  readonly multipv: number
  readonly score: RelScore
  readonly bound: Bound
  readonly pv: NonEmpty<Uci>
}
/** An option the engine advertises. `min` and `max` bound a spin option. */
export type UciOption = { readonly name: string; readonly default: string | null; readonly min: number | null; readonly max: number | null }
export type UciMessage =
  | { readonly kind: 'id-name'; readonly name: string }
  | ({ readonly kind: 'option' } & UciOption)
  | { readonly kind: 'uciok' }
  | { readonly kind: 'readyok' }
  | PvInfo
  | { readonly kind: 'bestmove'; readonly move: Uci | null }
  | { readonly kind: 'ignored' }

const IGNORED: UciMessage = { kind: 'ignored' }
const UCI_MOVE = /^[a-h][1-8][a-h][1-8][nbrq]?$/
const OPTION_FIELDS = new Set(['type', 'default', 'min', 'max', 'var'])

export function parseUciLine(line: string): UciMessage {
  const tokens = line.trim().split(/\s+/)
  switch (tokens[0]) {
    case 'id':
      return tokens[1] === 'name' && tokens.length > 2 ? { kind: 'id-name', name: tokens.slice(2).join(' ') } : IGNORED
    case 'option':
      return parseOption(tokens)
    case 'uciok':
      return { kind: 'uciok' }
    case 'readyok':
      return { kind: 'readyok' }
    case 'bestmove':
      if (tokens[1] === '(none)') return { kind: 'bestmove', move: null }
      return tokens[1] !== undefined && UCI_MOVE.test(tokens[1]) ? { kind: 'bestmove', move: tokens[1] as Uci } : IGNORED
    case 'info':
      return parseInfo(tokens)
    default:
      return IGNORED
  }
}

function parseOption(tokens: readonly string[]): UciMessage {
  const type = tokens.indexOf('type')
  if (tokens[1] !== 'name' || type < 3) return IGNORED
  const field = (key: string) => {
    const at = tokens.indexOf(key, type)
    if (at < 0) return null
    const end = tokens.findIndex((t, i) => i > at && OPTION_FIELDS.has(t))
    return tokens.slice(at + 1, end < 0 ? undefined : end).join(' ')
  }
  return { kind: 'option', name: tokens.slice(2, type).join(' '), default: field('default'), min: int(field('min') ?? undefined), max: int(field('max') ?? undefined) }
}

function parseInfo(tokens: readonly string[]): UciMessage {
  let depth: number | null = null
  let multipv = 1
  let score: RelScore | null = null
  let bound: Bound = 'exact'
  let pv: readonly string[] = []
  for (let i = 1; i < tokens.length; i++) {
    switch (tokens[i]) {
      case 'string':
        return IGNORED
      case 'depth':
        depth = int(tokens[++i])
        break
      case 'multipv':
        multipv = int(tokens[++i]) ?? 0
        break
      case 'score': {
        const kind = tokens[++i]
        const value = int(tokens[++i])
        score = value === null ? null : kind === 'cp' ? { kind: 'cp', cp: value } : kind === 'mate' && value !== 0 ? { kind: 'mate', moves: value } : null
        break
      }
      case 'lowerbound':
        bound = 'lower'
        break
      case 'upperbound':
        bound = 'upper'
        break
      case 'wdl':
        i += 3
        break
      case 'pv':
        pv = tokens.slice(i + 1)
        i = tokens.length
        break
      default:
        i++
    }
  }
  const [first, ...rest] = pv
  if (depth === null || depth < 1 || multipv < 1 || score === null || first === undefined) return IGNORED
  if (!pv.every((m) => UCI_MOVE.test(m))) return IGNORED
  return { kind: 'pv', depth, multipv, score, bound, pv: [first as Uci, ...(rest as Uci[])] }
}

function int(token: string | undefined): number | null {
  return token !== undefined && /^-?\d+$/.test(token) ? Number(token) : null
}

/** The only sign flip in the codebase: UCI scores are relative to the side to move, Score names White or the winner. */
export function toScore(rel: RelScore, turn: Color): Score {
  if (rel.kind === 'cp') return { kind: 'cp', white: turn === 'w' ? rel.cp : 0 - rel.cp }
  const winner: Color = rel.moves > 0 ? turn : turn === 'w' ? 'b' : 'w'
  return { kind: 'mate', winner, moves: Math.abs(rel.moves) }
}

export type LineTable = ReadonlyMap<number, readonly (EvalLine | undefined)[]>

/** Deepest depth, at or below `through`, whose rows 0..expected-1 are all present. */
export function pickLines(table: LineTable, expected: 1 | 2, through = Infinity): SearchedEval | null {
  const depths = [...table.keys()].filter((d) => d <= through).sort((a, b) => b - a)
  for (const depth of depths) {
    const [first, second] = table.get(depth) ?? []
    if (first && expected === 1) return { depth, lines: [first] }
    if (first && second) return { depth, lines: [first, second] }
  }
  return null
}

/**
 * Collects one search's lines by depth. Bounded lines mark a depth as reached but never enter the table.
 * Stockfish reprints rows it has not re-searched yet at depth - 1, so a line below the deepest depth seen is stale.
 * At the same depth the last print wins, because the print after the final MultiPV row re-sorts the earlier rows.
 */
export function lineCollector(turn: Color) {
  const table = new Map<number, (EvalLine | undefined)[]>()
  let deepest = 0
  return {
    get deepest() {
      return deepest
    },
    add(info: PvInfo): void {
      if (info.depth < deepest || info.multipv > 2) return
      deepest = info.depth
      if (info.bound !== 'exact') return
      const row = table.get(info.depth) ?? []
      row[info.multipv - 1] = { score: toScore(info.score, turn), pv: info.pv }
      table.set(info.depth, row)
    },
    /** A movetime search ends mid-iteration, and Stockfish then prints a displaced former best move as an exact
     *  line 2 at that partial depth. Only a depth-limited search finishes its last depth. */
    pick(expected: 1 | 2, limit: SearchLimit): SearchedEval | null {
      return pickLines(table, expected, limit.kind === 'depth' ? Infinity : deepest - 1)
    },
  }
}

export type LineCollector = ReturnType<typeof lineCollector>

export function positionCommand(input: EngineInput): string {
  return `position fen ${input.root}${input.tail.length > 0 ? ` moves ${input.tail.join(' ')}` : ''}`
}

export function goCommand(limit: SearchLimit): string {
  return limit.kind === 'depth' ? `go depth ${limit.depth}` : `go movetime ${limit.ms}`
}

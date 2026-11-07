import { Chess, SQUARES, type Move } from 'chess.js'
import type { Color, Fen, PieceKind, PlayedMove, Square } from '../domain'
import { captures, PIECE_VALUE, see } from './material'

/** What a move does on the board, read off the positions before and after it. Each fact is something the board shows,
 *  never an intention. */
export type MoveFact =
  | { readonly kind: 'castles'; readonly side: 'king' | 'queen' }
  | { readonly kind: 'captures'; readonly piece: PieceKind; readonly square: Square; readonly recapture: boolean }
  | { readonly kind: 'check'; readonly mate: boolean }
  /** One of my pieces can now be taken at a profit, net of what the move took; `by` is the cheapest taker. */
  | { readonly kind: 'hangs'; readonly piece: PieceKind; readonly square: Square; readonly by: PieceKind }
  /** The moved piece stood where it could be taken at a profit, and no longer does. */
  | { readonly kind: 'escapes'; readonly piece: PieceKind; readonly by: PieceKind }
  /** A knight or bishop leaves its first square. */
  | { readonly kind: 'develops'; readonly piece: 'n' | 'b'; readonly to: Square }
  /** The moved piece newly attacks two targets at once, each worth more than it or unprotected (the king counts). */
  | { readonly kind: 'forks'; readonly targets: readonly Target[] }
  /** The moved piece newly attacks one such target, or a pawn only the king protects (f7 and f2 at the start). */
  | { readonly kind: 'attacks'; readonly target: PieceKind; readonly square: Square; readonly why: 'undefended' | 'king-only' | 'bigger' }
  | { readonly kind: 'pins'; readonly target: PieceKind; readonly square: Square; readonly behind: 'k' | 'q' | 'r' }
  /** The moved piece newly protects one of my pieces the opponent attacks. */
  | { readonly kind: 'defends'; readonly target: PieceKind; readonly square: Square }
  /** A pawn the opponent can take for nothing more than the pawn. */
  | { readonly kind: 'gambit'; readonly square: Square }
  /** A pawn move that attacks an enemy pawn, offering a trade (...d5 against e4, c4 against d5). */
  | { readonly kind: 'pawn-break'; readonly target: Square }
  /** The move empties the last square between king and rook while the right to castle stands. */
  | { readonly kind: 'prepares-castling'; readonly side: 'king' | 'queen' }
  /** A pawn on its fourth rank in the center, or a knight or bishop on a central square. */
  | { readonly kind: 'occupies-center'; readonly square: Square }
  /** A pawn move that protects the central square a pawn of mine behind it can advance to (c3 for d4, ...c6 for ...d5). */
  | { readonly kind: 'prepares-push'; readonly square: Square }
  | { readonly kind: 'fianchetto'; readonly side: 'king' | 'queen'; readonly step: 'pawn' | 'bishop' }
  /** A pawn move that gives a bishop or the queen still on the first rank at least two more squares. */
  | { readonly kind: 'opens-line'; readonly pieces: readonly ('b' | 'q')[] }
  /** Empty central squares the moved piece newly attacks. */
  | { readonly kind: 'controls-center'; readonly squares: readonly Square[] }
  /** A pawn reaches the fifth rank. */
  | { readonly kind: 'gains-space'; readonly square: Square }
  /** A piece moves a second time, without taking, while a knight or bishop of its side is still at home. */
  | { readonly kind: 'moves-again'; readonly piece: PieceKind }
export type FactKind = MoveFact['kind']
export type Target = { readonly piece: PieceKind; readonly square: Square }

/** More reads as a list, not an explanation. */
export const FACT_LIMIT = 3

const CENTER: readonly Square[] = ['d4', 'e4', 'd5', 'e5']
const HOME: Readonly<Record<Color, readonly Square[]>> = { w: ['b1', 'c1', 'f1', 'g1'], b: ['b8', 'c8', 'f8', 'g8'] }

/** Computed once per move and read by every rule. */
type Seen = {
  readonly move: PlayedMove
  readonly earlier: readonly PlayedMove[]
  readonly mover: Color
  readonly them: Color
  readonly before: Chess
  readonly after: Chess
  /** Squares the moved piece attacks from where it landed, and attacked from where it stood. */
  readonly reach: ReadonlySet<Square>
  readonly reachBefore: ReadonlySet<Square>
}

/** In telling order: tactics first, then development and the center, then the rest. Each rule decides from Seen alone. */
const RULES: readonly (readonly [FactKind, (s: Seen) => MoveFact | null])[] = [
  ['castles', ({ move }) => (move.piece === 'k' && Math.abs(file(move.from) - file(move.to)) === 2 ? { kind: 'castles', side: file(move.to) > file(move.from) ? 'king' : 'queen' } : null)],
  ['captures', ({ move, earlier }) => {
    if (!move.captured) return null
    const last = earlier.at(-1)
    return { kind: 'captures', piece: move.captured, square: move.to, recapture: !!last?.captured && last.to === move.to }
  }],
  ['check', ({ after }) => (after.inCheck() ? { kind: 'check', mate: after.isCheckmate() } : null)],
  ['hangs', (s) => {
    const loss = bestTake(s)
    return loss && loss.piece !== 'p' ? { kind: 'hangs', piece: loss.piece, square: loss.square, by: loss.by } : null
  }],
  ['forks', (s) => {
    const targets = threats(s)
    return targets.length >= 2 ? { kind: 'forks', targets: targets.map(({ piece, square }) => ({ piece, square })) } : null
  }],
  ['escapes', ({ move, before, them }) => {
    if (move.piece === 'k' || move.piece === 'p' || !takeable(theirTurn(move.before.fen), move.from)) return null
    return { kind: 'escapes', piece: move.piece, by: cheapest(before, move.from, them)! }
  }],
  ['develops', ({ move }) => (HOME[move.mover].includes(move.from) && (move.piece === 'n' || move.piece === 'b') ? { kind: 'develops', piece: move.piece, to: move.to } : null)],
  ['attacks', (s) => {
    const targets = threats(s)
    if (targets.length !== 1 || targets[0].piece === 'k') return null
    const [{ piece, square, why }] = targets
    return { kind: 'attacks', target: piece, square, why }
  }],
  ['pins', pins],
  ['defends', ({ move, after, reach, reachBefore, mover, them }) => {
    const guarded = [...reach]
      .filter((sq) => !reachBefore.has(sq) && sq !== move.to)
      .map((sq) => ({ sq, piece: after.get(sq) }))
      .filter(({ sq, piece }) => piece?.color === mover && piece.type !== 'k' && after.attackers(sq, them).length > 0)
      .sort((a, b) => PIECE_VALUE[b.piece!.type] - PIECE_VALUE[a.piece!.type])
    return guarded.length > 0 ? { kind: 'defends', target: guarded[0].piece!.type, square: guarded[0].sq } : null
  }],
  ['gambit', (s) => {
    const loss = bestTake(s)
    return loss?.piece === 'p' && !takeable(theirTurn(s.move.before.fen), loss.square) ? { kind: 'gambit', square: loss.square } : null
  }],
  ['pawn-break', ({ move, after, reach, them }) => {
    if (move.piece !== 'p' || move.captured) return null
    const target = [...reach].find((sq) => after.get(sq)?.color === them && after.get(sq)?.type === 'p')
    return target ? { kind: 'pawn-break', target } : null
  }],
  ['prepares-castling', ({ move, before, after, mover }) => {
    if (move.piece === 'k') return null
    const rank = mover === 'w' ? '1' : '8'
    const rights = after.getCastlingRights(mover)
    for (const [side, files] of [['king', 'fg'], ['queen', 'bcd']] as const) {
      const between = [...files].map((f) => `${f}${rank}` as Square)
      if (rights[side === 'king' ? 'k' : 'q'] && between.every((sq) => !after.get(sq)) && between.some((sq) => before.get(sq))) return { kind: 'prepares-castling', side }
    }
    return null
  }],
  ['occupies-center', ({ move, mover }) => {
    if (!CENTER.includes(move.to) || move.captured) return null
    if (move.piece === 'p') return relativeRank(move.to, mover) === 4 ? { kind: 'occupies-center', square: move.to } : null
    return move.piece === 'n' || move.piece === 'b' ? { kind: 'occupies-center', square: move.to } : null
  }],
  ['prepares-push', (s) => {
    const square = pushPrepared(s)
    return square ? { kind: 'prepares-push', square } : null
  }],
  ['fianchetto', (s) => {
    const side = fianchetto(s)
    return side ? { kind: 'fianchetto', side, step: s.move.piece === 'p' ? 'pawn' : 'bishop' } : null
  }],
  ['opens-line', (s) => {
    if (s.move.piece !== 'p' || fianchetto(s)) return null
    const rank = s.mover === 'w' ? '1' : '8'
    const opened = new Set<'b' | 'q'>()
    for (const f of 'abcdefgh') {
      const sq = `${f}${rank}` as Square
      const piece = s.after.get(sq)
      if (piece?.color !== s.mover || (piece.type !== 'b' && piece.type !== 'q')) continue
      if (range(s.after, sq, piece.type) - range(s.before, sq, piece.type) >= 2) opened.add(piece.type)
    }
    return opened.size > 0 ? { kind: 'opens-line', pieces: (['b', 'q'] as const).filter((p) => opened.has(p)) } : null
  }],
  ['controls-center', (s) => {
    const pushed = pushPrepared(s)
    const squares = CENTER.filter((sq) => s.reach.has(sq) && !s.reachBefore.has(sq) && !s.after.get(sq) && sq !== pushed)
    return squares.length > 0 ? { kind: 'controls-center', squares } : null
  }],
  ['gains-space', ({ move, mover }) => (move.piece === 'p' && !move.captured && relativeRank(move.to, mover) === 5 ? { kind: 'gains-space', square: move.to } : null)],
  ['moves-again', ({ move, earlier, before, mover }) => {
    if (move.piece === 'k' || move.piece === 'p' || move.captured) return null
    if (!earlier.some((m) => m.mover === mover && m.to === move.from)) return null
    const undeveloped = HOME[mover].some((sq) => {
      const piece = before.get(sq)
      return piece?.color === mover && (piece.type === 'n' || piece.type === 'b')
    })
    return undeveloped ? { kind: 'moves-again', piece: move.piece } : null
  }],
]

/** Up to FACT_LIMIT facts, strongest first; none for a move no rule recognises. `earlier` is the game's moves before it. */
export function describeMove(move: PlayedMove, earlier: readonly PlayedMove[]): readonly MoveFact[] {
  const before = new Chess(move.before.fen)
  const after = new Chess(move.after.fen)
  const mover = move.mover
  const reach = new Set(SQUARES.filter((sq) => after.attackers(sq, mover).includes(move.to)))
  const reachBefore = new Set(SQUARES.filter((sq) => before.attackers(sq, mover).includes(move.from)))
  const seen: Seen = { move, earlier, mover, them: mover === 'w' ? 'b' : 'w', before, after, reach, reachBefore }
  const facts: MoveFact[] = []
  for (const [, rule] of RULES) {
    const fact = rule(seen)
    if (fact) facts.push(fact)
    if (facts.length === FACT_LIMIT) break
  }
  return facts
}

/** The opponent's most profitable capture now, net of what the move took; null when nothing is won. A capture that
 *  lets me take back as much elsewhere (a knight pinned to its queen) wins nothing. */
function bestTake({ move, after, mover }: Seen): (Target & { readonly by: PieceKind }) | null {
  if (move.after.kind !== 'playable') return null
  const gain = (move.captured ? PIECE_VALUE[move.captured] : 0) + (move.promotion ? PIECE_VALUE[move.promotion] - 1 : 0)
  const fen = move.after.fen
  let best: { square: Square; net: number; by: PieceKind } | null = null
  for (const c of captures(fen)) {
    const net = see(fen, c) - gain
    if (net <= 0 || (best && net <= best.net)) continue
    const answers = captures(c.after as Fen)
    if (answers.some((a) => see(c.after as Fen, a) >= PIECE_VALUE[c.captured!])) continue
    best = { square: victim(c), net, by: c.piece }
  }
  return best && { piece: after.get(best.square)!.type, square: best.square, by: cheapest(after, best.square, mover === 'w' ? 'b' : 'w') ?? best.by }
}

/** Some capture of the piece on `square` wins material for the side to move in `fen`. */
function takeable(fen: Fen, square: Square): boolean {
  return captures(fen).some((c) => victim(c) === square && see(fen, c) > 0)
}

/** The square of the piece a capture removes: en passant takes the pawn beside the landing square. */
function victim(c: Move): Square {
  return c.flags.includes('e') ? (`${c.to[0]}${c.from[1]}` as Square) : c.to
}

/** The same position with the other side to move, to ask what it could take. */
function theirTurn(fen: Fen): Fen {
  const [placement, turn, castling, , halfmove, fullmove] = fen.split(' ')
  return [placement, turn === 'w' ? 'b' : 'w', castling, '-', halfmove, fullmove].join(' ') as Fen
}

/** The enemy pieces the moved piece newly attacks that are worth more than it or unprotected, the most valuable first.
 *  A pawn attacking a pawn is a pawn break, not a threat. */
function threats({ move, after, reach, reachBefore, them }: Seen): readonly (Target & { readonly why: 'undefended' | 'king-only' | 'bigger' })[] {
  const found: (Target & { why: 'undefended' | 'king-only' | 'bigger' })[] = []
  for (const square of reach) {
    const target = after.get(square)
    if (target?.color !== them || reachBefore.has(square)) continue
    if (move.piece === 'p' && target.type === 'p') continue
    const defenders = after.attackers(square, them).map((sq) => after.get(sq)!.type)
    const why =
      target.type === 'k' || PIECE_VALUE[target.type] > PIECE_VALUE[move.promotion ?? move.piece] ? 'bigger'
      : defenders.length === 0 ? 'undefended'
      : target.type === 'p' && defenders.every((d) => d === 'k') ? 'king-only'
      : null
    if (why) found.push({ piece: target.type, square, why })
  }
  return found.sort((a, b) => PIECE_VALUE[b.piece] - PIECE_VALUE[a.piece])
}

/** The moved line piece now holds an enemy piece in front of a more valuable one: the king, the queen or a rook. */
function pins({ move, after, them }: Seen): MoveFact | null {
  const piece = move.promotion ?? move.piece
  const directions = [
    ...(piece === 'b' || piece === 'q' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : []),
    ...(piece === 'r' || piece === 'q' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : []),
  ]
  for (const [df, dr] of directions) {
    const met: Target[] = []
    for (let f = file(move.to) + df, r = rank(move.to) + dr; f >= 0 && f < 8 && r >= 1 && r <= 8 && met.length < 2; f += df, r += dr) {
      const sq = `${'abcdefgh'[f]}${r}` as Square
      const occupant = after.get(sq)
      if (!occupant) continue
      if (occupant.color !== them) break
      met.push({ piece: occupant.type, square: sq })
    }
    const [front, behind] = met
    if (!behind || front.piece === 'k' || front.piece === 'p') continue
    if ((behind.piece === 'k' || behind.piece === 'q' || behind.piece === 'r') && PIECE_VALUE[behind.piece] > PIECE_VALUE[front.piece]) {
      return { kind: 'pins', target: front.piece, square: front.square, behind: behind.piece }
    }
  }
  return null
}

/** The central square on my side's fourth rank that the moved pawn now protects and a pawn of mine on the same file can
 *  advance to, while the opponent contests it. */
function pushPrepared({ move, after, reach, mover, them }: Seen): Square | null {
  if (move.piece !== 'p') return null
  const step = mover === 'w' ? -1 : 1
  for (const sq of reach) {
    if (!CENTER.includes(sq) || relativeRank(sq, mover) !== 4 || after.get(sq) || after.attackers(sq, them).length === 0) continue
    for (let r = rank(sq) + step, n = 0; n < 2; r += step, n++) {
      const behind = after.get(`${sq[0]}${r}` as Square)
      if (behind?.color === mover && behind.type === 'p') return sq
      if (behind) break
    }
  }
  return null
}

/** The side whose bishop the move puts on, or makes ready for, its long diagonal. */
function fianchetto({ move, after, mover }: Seen): 'king' | 'queen' | null {
  const back = mover === 'w' ? 1 : 8
  const front = mover === 'w' ? 2 : 7
  const pawn = mover === 'w' ? 3 : 6
  for (const [side, f, home] of [['king', 'g', 'f'], ['queen', 'b', 'c']] as const) {
    const bishop = after.get(`${home}${back}` as Square)
    if (move.piece === 'p' && move.from === `${f}${front}` && move.to === `${f}${pawn}` && bishop?.color === mover && bishop.type === 'b') return side
    const pawnThere = after.get(`${f}${pawn}` as Square)
    if (move.piece === 'b' && move.from === `${home}${back}` && move.to === `${f}${front}` && pawnThere?.color === mover && pawnThere.type === 'p') return side
  }
  return null
}

/** Empty squares a bishop or queen can slide to from `from`. */
function range(board: Chess, from: Square, piece: 'b' | 'q'): number {
  const directions = piece === 'b' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]
  let n = 0
  for (const [df, dr] of directions) {
    for (let f = file(from) + df, r = rank(from) + dr; f >= 0 && f < 8 && r >= 1 && r <= 8; f += df, r += dr) {
      if (board.get(`${'abcdefgh'[f]}${r}` as Square)) break
      n++
    }
  }
  return n
}

function cheapest(board: Chess, square: Square, color: Color): PieceKind | null {
  const kinds = board.attackers(square, color).map((sq) => board.get(sq)!.type)
  return kinds.sort((a, b) => PIECE_VALUE[a] - PIECE_VALUE[b])[0] ?? null
}

function file(sq: Square): number {
  return sq.charCodeAt(0) - 97
}

function rank(sq: Square): number {
  return Number(sq[1])
}

/** 1 to 8 from the mover's side of the board. */
function relativeRank(sq: Square, color: Color): number {
  return color === 'w' ? rank(sq) : 9 - rank(sq)
}

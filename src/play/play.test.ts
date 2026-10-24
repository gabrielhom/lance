import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import type { Fen, PlayEvent, PlaySetup, PlayState, Uci } from '../domain/types'
import { LEVELS } from './levels'
import { clocksAt, newPlay, playPosition, reducePlay } from './play'

const T0 = 1_000_000
const vsEngine = (you: 'w' | 'b' = 'w', time: PlaySetup['time'] = { kind: 'none' }): PlaySetup => ({ opponent: { kind: 'engine', levelId: 1 }, you, time })
const local: PlaySetup = { opponent: { kind: 'local' }, you: 'w', time: { kind: 'none' } }
const blitz = (minutes: number, incS: number): PlaySetup['time'] => ({ kind: 'clock', initialMs: minutes * 60_000, incrementMs: incS * 1000 })

function uci(sans: string): Uci[] {
  const b = new Chess()
  return sans.split(/\s+/).filter(Boolean).map((san) => b.move(san).lan as Uci)
}

/** Feeds moves one second apart, starting a second after the game began. */
function playMoves(state: PlayState, moves: readonly Uci[], step = 1000): PlayState {
  return moves.reduce((s, m, i) => reducePlay(s, { kind: 'move', uci: m, at: s.startedAt + (i + 1) * step }), state)
}

function rng(seed: number) {
  let s = seed
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    return s / 2 ** 32
  }
}

/** A seeded game where both sides grab material at random. They end in every way the rules allow. */
function capturingGame(seed: number, stop: (b: Chess) => boolean = () => false): { moves: Uci[]; board: Chess } {
  const r = rng(seed)
  const board = new Chess()
  const moves: Uci[] = []
  while (!board.isGameOver() && !stop(board) && moves.length < 600) {
    const legal = board.moves({ verbose: true })
    const captures = legal.filter((m) => m.captured)
    const pool = captures.length ? captures : legal
    const m = pool[Math.floor(r() * pool.length)]
    board.move(m)
    moves.push(m.lan as Uci)
  }
  return { moves, board }
}

/** Quiet piece moves after a few opening pawn pushes: the fifty-move draw arrives at ply 107 with no position repeated. */
const FIFTY_MOVE_GAME = `
b2b3 b8c6 h2h4 e7e6 f2f3 f8a3 d2d4 d8e7 h1h2 c6b4 c1h6 e8f8
h2h1 b4d5 e1d2 a3c5 d2d3 e7g5 g1h3 g5g6 d3d2 c5b4 b1c3 g6g4
h6e3 b4d6 h3g5 g4f5 g5h3 f5f6 c3b1 d6e5 e3g1 d5b6 d2c3 f6g6
b1d2 b6d5 c3b2 g8h6 d2c4 d5e3 c4b6 e5h2 d1b1 g6f5 b2c1 e3g4
c1b2 f5f4 g1e3 a8b8 e3g1 f4c1 b2c3 c1f4 g1f2 h6g8 b6a4 g8h6
c3d3 f4f6 h3f4 f6e7 a4b2 e7e8 d3e4 f8g8 b1c1 g4e3 c1d2 e3f5
d2c3 h2g3 c3d3 g3h2 d3e3 f5g3 e4d3 h2g1 h1h2 g3h5 f4g6 h5f4
d3c4 h6g4 e3d2 g4e3 c4b5 e3d1 b5a5 d1c3 g6e7 g8f8 h2h1 c3d5
e7c6 d5b4 d2d1 f4d3 f2e1 b4a6 b2a4 e8e7 e1c3 e7d6 a4c5
`.trim().split(/\s+/) as Uci[]

describe('moves and endings', () => {
  it('appends a legal move and passes the turn', () => {
    const s = reducePlay(newPlay(local, T0), { kind: 'move', uci: 'e2e4' as Uci, at: T0 + 500 })
    expect(s.moves).toEqual(['e2e4'])
    expect(playPosition(s.moves).turn).toBe('b')
  })

  it.each([
    ['an illegal move', 'e2e5'],
    ['a promotion letter on a plain move', 'e2e4q'],
    ['garbage', 'castle'],
  ])('ignores %s', (_, move) => {
    const s = newPlay(local, T0)
    expect(reducePlay(s, { kind: 'move', uci: move as Uci, at: T0 + 1 })).toBe(s)
  })

  it('needs the promotion piece and accepts an underpromotion', () => {
    const s = playMoves(newPlay(local, T0), uci('a4 b5 axb5 a6 bxa6 Bb7 axb7 Nc6'))
    expect(reducePlay(s, { kind: 'move', uci: 'b7a8' as Uci, at: T0 + 20_000 })).toBe(s)
    const promoted = reducePlay(s, { kind: 'move', uci: 'b7a8n' as Uci, at: T0 + 20_000 })
    expect(playPosition(promoted.moves).sans.at(-1)).toBe('bxa8=N')
  })

  it('ends by checkmate with the win to the mating side', () => {
    const s = playMoves(newPlay(local, T0), uci('f3 e5 g4 Qh4#'))
    expect(s).toMatchObject({ phase: 'over', result: '0-1', termination: 'checkmate', endedAt: T0 + 4000 })
  })

  it('ends in a draw by stalemate', () => {
    const s = playMoves(newPlay(local, T0), uci('e3 a5 Qh5 Ra6 Qxa5 h5 h4 Rah6 Qxc7 f6 Qxd7+ Kf7 Qxb7 Qd3 Qxb8 Qh7 Qxc8 Kg6 Qe6'))
    expect(s).toMatchObject({ phase: 'over', result: '1/2-1/2', termination: 'stalemate' })
  })

  it('ends in a draw by threefold repetition', () => {
    const s = playMoves(newPlay(local, T0), uci('Nf3 Nf6 Ng1 Ng8 Nf3 Nf6 Ng1 Ng8'))
    expect(s).toMatchObject({ phase: 'over', result: '1/2-1/2', termination: 'repetition' })
  })

  it('ends in a draw by insufficient material', () => {
    const { moves } = capturingGame(12)
    const s = playMoves(newPlay(local, T0), moves)
    expect(s).toMatchObject({ phase: 'over', result: '1/2-1/2', termination: 'insufficient-material' })
    expect(s.moves).toEqual(moves)
  })

  it('ends in a draw by the fifty-move rule', () => {
    const s = playMoves(newPlay(local, T0), FIFTY_MOVE_GAME)
    expect(s).toMatchObject({ phase: 'over', result: '1/2-1/2', termination: 'fifty-move' })
    expect(s.moves).toEqual(FIFTY_MOVE_GAME)
  })

  it('ignores every event once the game is over', () => {
    const over = playMoves(newPlay(vsEngine(), T0), uci('f3 e5 g4 Qh4#'))
    const events: PlayEvent[] = [
      { kind: 'move', uci: 'a2a3' as Uci, at: T0 + 9000 },
      { kind: 'resign', by: 'b', at: T0 + 9000 },
      { kind: 'flag', at: T0 + 9_000_000 },
      { kind: 'takeback', at: T0 + 9000 },
    ]
    for (const e of events) expect(reducePlay(over, e)).toBe(over)
  })

  it('gives the win to the other side on resignation', () => {
    const s = playMoves(newPlay(vsEngine('b'), T0), uci('e4'))
    expect(reducePlay(s, { kind: 'resign', by: 'b', at: T0 + 5000 })).toMatchObject({ phase: 'over', result: '1-0', termination: 'resignation', endedAt: T0 + 5000 })
  })
})

describe('clocks', () => {
  const game = (minutes: number, inc: number) => newPlay(vsEngine('w', blitz(minutes, inc)), T0)

  it('starts with full time for both sides, or no clocks at all', () => {
    expect(game(5, 0).clocks).toEqual({ w: 300_000, b: 300_000 })
    expect(newPlay(vsEngine(), T0).clocks).toBeNull()
  })

  it('does not charge either side for its first move', () => {
    const s = reducePlay(reducePlay(game(3, 2), { kind: 'move', uci: 'e2e4' as Uci, at: T0 + 60_000 }), { kind: 'move', uci: 'e7e5' as Uci, at: T0 + 120_000 })
    expect(s.clocks).toEqual({ w: 180_000, b: 180_000 })
    expect(clocksAt(s, T0 + 130_000)).toEqual({ w: 170_000, b: 180_000 })
  })

  it('charges the thinking time and then adds the increment', () => {
    const s = playMoves(game(3, 2), uci('e4 e5'))
    const after = reducePlay(s, { kind: 'move', uci: 'g1f3' as Uci, at: s.phase === 'playing' ? s.turnStartedAt + 10_000 : 0 })
    expect(after.clocks).toEqual({ w: 172_000, b: 180_000 })
  })

  it('ends the game on a flag only when the side to move is really out of time', () => {
    const s = playMoves(game(1, 0), uci('e4 e5'))
    const started = s.phase === 'playing' ? s.turnStartedAt : 0
    expect(reducePlay(s, { kind: 'flag', at: started + 59_999 })).toBe(s)
    expect(reducePlay(s, { kind: 'flag', at: started + 60_000 })).toMatchObject({ phase: 'over', result: '0-1', termination: 'timeout', clocks: { w: 0, b: 60_000 } })
  })

  it('turns a move made after the flag fell into a loss on time', () => {
    const s = playMoves(game(1, 0), uci('e4 e5'))
    const started = s.phase === 'playing' ? s.turnStartedAt : 0
    expect(reducePlay(s, { kind: 'move', uci: 'g1f3' as Uci, at: started + 61_000 })).toMatchObject({ phase: 'over', termination: 'timeout', result: '0-1', moves: s.moves })
  })

  it('makes a timeout a draw when the side left on the board cannot mate', () => {
    const loneKing = (b: Chess) => b.board().flat().filter((sq) => sq?.color === 'b').length === 1 && b.turn() === 'w'
    let seed = 1
    while (!loneKing(capturingGame(seed, loneKing).board)) seed++
    const line = capturingGame(seed, loneKing).moves
    const s = playMoves(newPlay(vsEngine('w', blitz(30, 0)), T0), line, 10)
    expect(s.phase).toBe('playing')
    expect(reducePlay(s, { kind: 'flag', at: T0 + 10 * 60 * 60_000 })).toMatchObject({ phase: 'over', result: '1/2-1/2', termination: 'timeout' })
  })
})

describe('takeback', () => {
  it("undoes the player's move and the engine's reply", () => {
    const s = playMoves(newPlay(vsEngine('w'), T0), uci('e4 e5 Nf3 Nc6'))
    expect(reducePlay(s, { kind: 'takeback', at: T0 + 9000 }).moves).toEqual(uci('e4 e5'))
  })

  it('undoes only the player move while the engine is still thinking', () => {
    const s = playMoves(newPlay(vsEngine('b'), T0), uci('e4 e5 Nf3'))
    expect(reducePlay(s, { kind: 'takeback', at: T0 + 9000 }).moves).toEqual(uci('e4'))
  })

  it('does nothing before the player has moved, or in a local game', () => {
    const asBlack = playMoves(newPlay(vsEngine('b'), T0), uci('e4'))
    expect(reducePlay(asBlack, { kind: 'takeback', at: T0 + 9000 })).toBe(asBlack)
    const two = playMoves(newPlay(local, T0), uci('e4 e5'))
    expect(reducePlay(two, { kind: 'takeback', at: T0 + 9000 })).toBe(two)
  })

  it('charges the time spent before it to the side that was thinking', () => {
    const s = playMoves(newPlay(vsEngine('w', blitz(3, 0)), T0), uci('e4 e5 Nf3 Nc6'))
    const back = reducePlay(s, { kind: 'takeback', at: s.phase === 'playing' ? s.turnStartedAt + 5000 : 0 })
    expect(back.clocks).toEqual({ w: 174_000, b: 179_000 })
  })
})

describe('position', () => {
  it('sends the engine the position after the last pawn move or capture and the moves since', () => {
    const moves = uci('e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O Bd6 Re1')
    const p = playPosition(moves)
    const afterCapture = new Chess()
    for (const m of moves.slice(0, 8)) afterCapture.move(m)
    expect(p.input).toEqual({ root: afterCapture.fen(), tail: moves.slice(8) })
    expect(playPosition([]).input).toEqual({ root: new Chess().fen(), tail: [] })
  })

  it('lists one target per destination, with promotions flagged', () => {
    const p = playPosition(uci('a4 b5 axb5 a6 bxa6 Bb7 axb7 Nc6'))
    expect(p.targets.get('b7')).toEqual(expect.arrayContaining([{ to: 'a8', promotion: true }, { to: 'b8', promotion: true }]))
    expect(p.targets.get('b7')).toHaveLength(2)
  })

  it('reports check, the checked king and the last move', () => {
    const p = playPosition(uci('e4 f5 Qh5+'))
    expect(p).toMatchObject({ check: true, kingSquare: 'e8', lastMove: { from: 'd1', to: 'h5' }, turn: 'b' })
  })
})

describe('levels', () => {
  it('climb in strength and keep UCI_Elo inside Stockfish range', () => {
    const rank = LEVELS.map((l) => (l.strength.kind === 'skill' ? l.strength.level : l.strength.kind === 'elo' ? 100 + l.strength.elo : 10_000))
    expect(rank).toEqual([...rank].sort((a, b) => a - b))
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length)
    for (const l of LEVELS) if (l.strength.kind === 'elo') expect(l.strength.elo).toBeGreaterThanOrEqual(1320)
    for (const l of LEVELS) if (l.strength.kind === 'elo') expect(l.strength.elo).toBeLessThanOrEqual(3190)
  })
})

describe('playPosition from a start position', () => {
  const root = 'rn2kb1r/pp2qppp/2p2n2/4p3/2B1P3/1QN5/PPP2PPP/R1B1K2R w KQkq - 0 9' as Fen

  it('plays the moves from the given position and roots the engine input there', () => {
    const p = playPosition(['c1g5' as Uci], root)
    expect(p.fen).toBe('rn2kb1r/pp2qppp/2p2n2/4p1B1/2B1P3/1QN5/PPP2PPP/R3K2R b KQkq - 1 9')
    expect(p.lastMove).toEqual({ from: 'c1', to: 'g5' })
    expect(p.input).toEqual({ root, tail: ['c1g5'] })
  })

  it('roots an empty move list at the start position itself', () => {
    expect(playPosition([], root).input).toEqual({ root, tail: [] })
  })
})

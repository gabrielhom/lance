import { describe, expect, it } from 'vitest'
import opera from '../../e2e/fixtures/opera.pgn?raw'
import scholar from '../../e2e/fixtures/scholar.pgn?raw'
import { gameFromPgn, type Game, type GameSource } from '.'

const PGN_SOURCE: GameSource = { kind: 'pgn' }
const epd = (fen: string) => fen.split(' ').slice(0, 4).join(' ')

function parse(pgn: string, source: GameSource = PGN_SOURCE): Game {
  const r = gameFromPgn(pgn, source)
  if (!r.ok) throw new Error(`rejected: ${r.error.kind} ${r.error.detail}`)
  return r.value
}

describe('gameFromPgn on the Opera game', () => {
  const game = parse(opera)

  it('links every move to the positions on both sides of it', () => {
    expect(game.moves).toHaveLength(33)
    expect(game.positions).toHaveLength(34)
    game.moves.forEach((m, i) => {
      expect(m.before).toBe(game.positions[i])
      expect(m.after).toBe(game.positions[i + 1])
    })
  })

  it('ends on a terminal checkmate with Black to move', () => {
    const last = game.positions[33]
    expect(last.kind).toBe('checkmate')
    expect(last.turn).toBe('b')
    expect(game.moves[32].san).toBe('Rd8#')
  })

  it('roots the engine input at the last pawn move or capture', () => {
    const [, afterE4, afterE5, afterNf3] = game.positions
    for (const p of [afterE4, afterE5]) {
      expect(p.kind === 'playable' && p.input).toEqual({ root: p.fen, tail: [] })
    }
    expect(afterNf3.kind === 'playable' && afterNf3.input).toEqual({ root: afterE5.fen, tail: ['g1f3'] })
  })

  it('writes castling as the king move, as UCI does, in the tail after 11.Bxb5+', () => {
    const castle = game.moves[22]
    expect(castle.san).toBe('O-O-O')
    expect(castle.uci).toBe('e1c1')
    const after = castle.after
    expect(after.kind === 'playable' && after.input).toEqual({ root: game.positions[21].fen, tail: ['b8d7', 'e1c1'] })
  })

  it('reads players and leaves an incomplete date unset', () => {
    expect(game.players.w).toEqual({ name: 'Paul Morphy', rating: null })
    expect(game.result).toBe('1-0')
    expect(game.playedAt).toBeNull()
  })
})

describe("gameFromPgn on scholar's mate", () => {
  const game = parse(scholar)

  it('has 7 moves ending in checkmate', () => {
    expect(game.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'])
    expect(game.positions[7].kind).toBe('checkmate')
    expect(game.moves[6].captured).toBe('p')
  })

  it('counts legal moves of every playable position', () => {
    expect(game.positions[0].kind === 'playable' && game.positions[0].legalMoves).toBe(20)
  })

  it('keeps the same id when its own canonical PGN is parsed again', () => {
    expect(game.id).toMatch(/^pgn:/)
    expect(parse(game.pgn).id).toBe(game.id)
    expect(parse(game.pgn.replace('Oponente', 'Outro')).id).not.toBe(game.id)
  })
})

describe('repetition keys', () => {
  const game = parse('1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 *')

  it('gives a repeated position a different key from its first occurrence', () => {
    const [start, , , , again] = game.positions
    expect(epd(again.fen)).toBe(epd(start.fen))
    expect(again.kind === 'playable' && again.key).toBe(`${start.fen}|g1f3 g8f6 f3g1 f6g8`)
    expect(start.kind === 'playable' && start.key).toBe(`${start.fen}|`)
  })

  it('never repeats a key within a game', () => {
    const keys = game.positions.map((p) => (p.kind === 'playable' ? p.key : null))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps the start position as root when a FEN start never resets the clock', () => {
    const fen = '4k3/8/8/8/8/8/8/R3K3 w - - 37 60'
    const g = parse(`[SetUp "1"]\n[FEN "${fen}"]\n\n60. Ra2 Kd7 61. Ra1 *`)
    const last = g.positions[3]
    expect(last.kind === 'playable' && last.input).toEqual({ root: fen, tail: ['a1a2', 'e8d7', 'a2a1'] })
  })
})

describe('terminal and rejected games', () => {
  it('marks a stalemate as terminal', () => {
    const g = parse('[SetUp "1"]\n[FEN "7k/8/6K1/8/8/8/8/5Q2 w - - 0 1"]\n\n1. Qf7 1/2-1/2')
    expect(g.positions[1].kind).toBe('stalemate')
    expect(g.result).toBe('1/2-1/2')
  })

  it('rejects other variants, garbage and empty games', () => {
    const chess960 = '[Variant "Chess960"]\n[SetUp "1"]\n[FEN "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w HFhf - 0 1"]\n\n1. e4 *'
    expect(gameFromPgn(chess960, PGN_SOURCE)).toMatchObject({ ok: false, error: { kind: 'variant' } })
    expect(gameFromPgn('1. e4 e5 2. Kxe8', PGN_SOURCE)).toMatchObject({ ok: false, error: { kind: 'unparseable' } })
    expect(gameFromPgn('[White "x"]\n\n*', PGN_SOURCE)).toMatchObject({ ok: false, error: { kind: 'no-moves' } })
  })

  it('accepts Lichess standard and from-position tags', () => {
    expect(gameFromPgn('[Variant "Standard"]\n\n1. e4 *', PGN_SOURCE).ok).toBe(true)
    const fromPosition = '[Variant "From Position"]\n[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/R3K3 w - - 0 1"]\n\n1. Ra8# 1-0'
    expect(gameFromPgn(fromPosition, PGN_SOURCE).ok).toBe(true)
  })
})

describe('site metadata', () => {
  it('ids a game by its site and reads UTC time, ratings and time control', () => {
    const pgn = [
      '[White "a"]', '[Black "b"]', '[Result "0-1"]', '[UTCDate "2026.10.22"]', '[UTCTime "17:57:32"]',
      '[WhiteElo "1823"]', '[BlackElo "?"]', '[TimeControl "600+0"]', '', '1. f3 e5 2. g4 Qh4# 0-1',
    ].join('\n')
    const g = parse(pgn, { kind: 'lichess', id: 'k8OVq8Y5', url: 'https://lichess.org/k8OVq8Y5' })
    expect(g.id).toBe('lichess:k8OVq8Y5')
    expect(g.playedAt).toBe(Date.UTC(2026, 9, 22, 17, 57, 32))
    expect(g.players).toEqual({ w: { name: 'a', rating: 1823 }, b: { name: 'b', rating: null } })
    expect(g.timeControl).toBe('600+0')
    expect(g.result).toBe('0-1')
    const c = parse(pgn, { kind: 'chesscom', uuid: 'u-1', url: 'https://www.chess.com/game/live/1' })
    expect(c.id).toBe('chesscom:u-1')
  })
})

import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { playableAt, playMove, type Fen, type PlayablePosition, type PlayedMove, type Uci } from '../domain'
import { describeMove } from './describe'

const ITALIAN = 'e2e4 e7e5 g1f3 b8c6 f1c4'

function described(before: string, uci: string) {
  const earlier: PlayedMove[] = []
  let at: PlayablePosition = playableAt({ root: new Chess().fen() as Fen, tail: [] }, 0)!
  for (const u of before.split(' ').filter(Boolean)) {
    const m = playMove(at, u as Uci)!
    earlier.push(m)
    at = m.after as PlayablePosition
  }
  return describeMove(playMove(at, uci as Uci)!, earlier)
}

describe('describeMove', () => {
  it.each([
    ['', 'e2e4', ['occupies-center', 'opens-line', 'controls-center']],
    ['e2e4 e7e5', 'g1f3', ['develops', 'attacks', 'controls-center']],
    ['e2e4 e7e5 g1f3', 'b8c6', ['develops', 'defends', 'controls-center']],
    ['e2e4 e7e5 g1f3 b8c6', 'f1c4', ['develops', 'attacks', 'prepares-castling']],
    [ITALIAN, 'f8c5', ['develops', 'attacks', 'controls-center']],
    [`${ITALIAN} f8c5`, 'c2c3', ['prepares-push', 'opens-line']],
    [`${ITALIAN} f8c5`, 'd2d3', ['opens-line']],
    [`${ITALIAN} f8c5`, 'e1g1', ['castles']],
    [`${ITALIAN} f8c5`, 'b2b4', ['attacks', 'gambit', 'opens-line']],
    [`${ITALIAN} f8c5`, 'f3g5', ['hangs', 'attacks', 'moves-again']],
    [`${ITALIAN} f8c5 c2c3 g8f6`, 'd2d4', ['attacks', 'pawn-break', 'occupies-center']],
    ['e2e4 e7e5', 'f2f4', ['gambit', 'pawn-break']],
    ['d2d4 d7d5', 'c2c4', ['gambit', 'pawn-break', 'opens-line']],
    ['d2d4 d7d5 c2c4 e7e6', 'b1c3', ['develops', 'controls-center']],
    ['e2e4 e7e5 g1f3 b8c6 f1b5 a7a6', 'b5a4', ['escapes', 'moves-again']],
    ['e2e4 e7e5 g1f3 b8c6 f1b5 d7d6', 'c2c3', ['prepares-push', 'opens-line']],
    ['e2e4 c7c5 g1f3 d7d6 d2d4', 'c5d4', ['captures']],
    ['e2e4 c7c6 d2d4 d7d5', 'e4e5', ['gains-space']],
    ['g1f3 d7d5', 'g2g3', ['fianchetto']],
    ['d2d4 g8f6 c2c4 g7g6 b1c3', 'f8g7', ['develops', 'prepares-castling', 'fianchetto']],
    ['d2d4 g8f6 c2c4 e7e6 b1c3', 'f8b4', ['develops', 'pins', 'prepares-castling']],
    ['d2d4 g8f6 c1g5 e7e6', 'e2e4', ['occupies-center', 'opens-line', 'controls-center']],
    ['f2f3 e7e5 g2g4', 'd8h4', ['check']],
    ['e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 f3g5 d7d5 e4d5 f6d5', 'g5f7', ['captures', 'hangs', 'forks']],
  ])('%s, then %s', (before, uci, kinds) => {
    expect(described(before, uci).map((f) => f.kind)).toEqual(kinds)
  })

  it('says which piece hangs and who takes it, which pawn only the king defends, and what a fork hits', () => {
    expect(described(`${ITALIAN} f8c5`, 'f3g5')).toEqual([
      { kind: 'hangs', piece: 'n', square: 'g5', by: 'q' },
      { kind: 'attacks', target: 'p', square: 'f7', why: 'king-only' },
      { kind: 'moves-again', piece: 'n' },
    ])
    expect(described('e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 f3g5 d7d5 e4d5 f6d5', 'g5f7')).toEqual([
      { kind: 'captures', piece: 'p', square: 'f7', recapture: false },
      { kind: 'hangs', piece: 'n', square: 'f7', by: 'k' },
      { kind: 'forks', targets: [{ piece: 'q', square: 'd8' }, { piece: 'r', square: 'h8' }] },
    ])
  })

  it('tells a recapture from a capture and a pin to the king from one to the queen', () => {
    expect(described('e2e4 c7c5 g1f3 d7d6 d2d4 c5d4', 'f3d4')).toEqual([{ kind: 'captures', piece: 'p', square: 'd4', recapture: true }])
    expect(described('d2d4 g8f6 c2c4 e7e6 b1c3', 'f8b4')[1]).toEqual({ kind: 'pins', target: 'n', square: 'c3', behind: 'k' })
    expect(described('d2d4 g8f6 g1f3 e7e6', 'c1g5')[1]).toEqual({ kind: 'pins', target: 'n', square: 'f6', behind: 'q' })
  })

  it('offers a pawn only when it is newly en prise, not on every move while it stays so', () => {
    expect(described('d2d4 d7d5 c2c4 e7e6', 'g1f3').map((f) => f.kind)).toEqual(['develops', 'controls-center'])
  })
})

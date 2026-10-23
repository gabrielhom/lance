import { describe, expect, it } from 'vitest'
import { WASM_FLAVORS, type Color, type SearchLimit } from '../domain/types'
import { TRANSCRIPTS, type Recorded, type ScenarioName } from './testing/transcripts'
import { lineCollector, parseUciLine, toScore, type PvInfo } from './uci'

const DEPTH_12: SearchLimit = { kind: 'depth', depth: 12 }
const MOVETIME: SearchLimit = { kind: 'movetime', ms: 1000 }

function collect(recorded: Recorded, name: ScenarioName, turn: Color = TRANSCRIPTS[recorded].scenarios[name].fen.split(' ')[1] as Color) {
  const lines = lineCollector(turn)
  for (const line of TRANSCRIPTS[recorded].scenarios[name].lines) {
    const msg = parseUciLine(line)
    if (msg.kind === 'pv') lines.add(msg)
  }
  return lines
}

function pv(depth: number, multipv: number, cp: number, moves: string, bound: PvInfo['bound'] = 'exact'): PvInfo {
  return parseUciLine(`info depth ${depth} multipv ${multipv} score cp ${cp}${bound === 'exact' ? '' : ` ${bound}bound`} pv ${moves}`) as PvInfo
}

describe('parseUciLine on recorded Stockfish 19 output', () => {
  it.each([
    ['native', 'Stockfish 19', 'nn-1a298aa575a0.nnue'],
    ['lite', 'Stockfish 19 Lite WASM', `${WASM_FLAVORS.lite.net}.nnue`],
  ] as const)('reads the %s handshake: id name, the EvalFile net, uciok', (recorded, idName, evalFile) => {
    const messages = TRANSCRIPTS[recorded].handshake.map(parseUciLine)
    expect(messages).toContainEqual({ kind: 'id-name', name: idName })
    expect(messages).toContainEqual({ kind: 'option', name: 'EvalFile', default: evalFile })
    expect(messages).toContainEqual({ kind: 'option', name: 'MultiPV', default: '1' })
    expect(messages.at(-1)).toEqual({ kind: 'uciok' })
  })

  it('reads option names with spaces and options without a default', () => {
    expect(parseUciLine('option name Clear Hash type button')).toEqual({ kind: 'option', name: 'Clear Hash', default: null })
    expect(parseUciLine('option name Debug Log File type string default <empty>')).toEqual({ kind: 'option', name: 'Debug Log File', default: '<empty>' })
    expect(parseUciLine('option name Hash type spin default 16 min 1 max 33554432')).toEqual({ kind: 'option', name: 'Hash', default: '16' })
  })

  it('reads a native pv line with seldepth, nodes, tbhits and the side-to-move score', () => {
    const line = 'info depth 12 seldepth 18 multipv 2 score cp -32 nodes 58491 nps 913921 hashfull 20 tbhits 0 time 64 pv c7c5 g1f3 b8c6 f1b5 e7e6 e1g1 g8e7 c2c3 a7a6 b5a4 b7b5'
    expect(parseUciLine(line)).toEqual({
      kind: 'pv',
      depth: 12,
      multipv: 2,
      score: { kind: 'cp', cp: -32 },
      bound: 'exact',
      pv: ['c7c5', 'g1f3', 'b8c6', 'f1b5', 'e7e6', 'e1g1', 'g8e7', 'c2c3', 'a7a6', 'b5a4', 'b7b5'],
    })
  })

  it('reads mate scores for the side to move, from a lite line without tbhits', () => {
    expect(parseUciLine('info depth 12 seldepth 2 multipv 1 score mate 1 nodes 11136 nps 1012363 hashfull 4 time 11 pv a1a8')).toMatchObject({
      score: { kind: 'mate', moves: 1 },
      pv: ['a1a8'],
    })
    expect(parseUciLine('info depth 12 seldepth 3 multipv 2 score mate -1 nodes 74 nps 74000 hashfull 0 time 1 pv a7a6 f7g7')).toMatchObject({
      multipv: 2,
      score: { kind: 'mate', moves: -1 },
    })
  })

  it('reads the bounds Stockfish prints after stop', () => {
    expect(parseUciLine('info depth 13 seldepth 22 multipv 1 score cp 30 lowerbound nodes 56760 nps 995789 hashfull 14 tbhits 0 time 57 pv f1b5 a7a6')).toMatchObject({ depth: 13, bound: 'lower' })
    expect(parseUciLine('info depth 17 seldepth 39 multipv 2 score cp 19 upperbound nodes 495698 nps 843023 hashfull 171 time 588 pv d2d4 e5d4')).toMatchObject({ depth: 17, bound: 'upper' })
  })

  it('never turns the mated position report into a score', () => {
    expect(parseUciLine('info depth 0 score mate 0')).toEqual({ kind: 'ignored' })
    expect(parseUciLine('bestmove (none)')).toEqual({ kind: 'bestmove', move: null })
  })

  it('reads bestmove with and without ponder, and ignores banners and info strings', () => {
    expect(parseUciLine('bestmove e7e5 ponder g1f3')).toEqual({ kind: 'bestmove', move: 'e7e5' })
    expect(parseUciLine('bestmove a1a8')).toEqual({ kind: 'bestmove', move: 'a1a8' })
    expect(parseUciLine('Stockfish 19 by the Stockfish developers (see AUTHORS file)')).toEqual({ kind: 'ignored' })
    expect(parseUciLine('info string NNUE evaluation using nn-1a298aa575a0.nnue (109MiB, (86896, 1024, 32, 32, 1))')).toEqual({ kind: 'ignored' })
    expect(parseUciLine('')).toEqual({ kind: 'ignored' })
  })

  it('parses every recorded line without throwing, and finds a bestmove at the end of every search', () => {
    for (const recorded of ['native', 'lite'] as const) {
      for (const s of Object.values(TRANSCRIPTS[recorded].scenarios)) {
        expect(parseUciLine(s.lines.at(-1)!).kind).toBe('bestmove')
      }
    }
  })
})

describe('toScore', () => {
  it('turns side-to-move centipawns into White centipawns', () => {
    expect(toScore({ kind: 'cp', cp: -28 }, 'b')).toEqual({ kind: 'cp', white: 28 })
    expect(toScore({ kind: 'cp', cp: 30 }, 'w')).toEqual({ kind: 'cp', white: 30 })
    const level = toScore({ kind: 'cp', cp: 0 }, 'b')
    expect(level.kind === 'cp' && Object.is(level.white, 0)).toBe(true)
  })

  it('names the winner of a mate', () => {
    expect(toScore({ kind: 'mate', moves: 1 }, 'w')).toEqual({ kind: 'mate', winner: 'w', moves: 1 })
    expect(toScore({ kind: 'mate', moves: -1 }, 'b')).toEqual({ kind: 'mate', winner: 'w', moves: 1 })
    expect(toScore({ kind: 'mate', moves: 3 }, 'b')).toEqual({ kind: 'mate', winner: 'b', moves: 3 })
    expect(toScore({ kind: 'mate', moves: -2 }, 'w')).toEqual({ kind: 'mate', winner: 'b', moves: 2 })
  })
})

describe('lineCollector over recorded searches', () => {
  it.each([
    ['native', 28, 'e7e5', 32, 'c7c5'],
    ['lite', 23, 'e7e5', 30, 'e7e6'],
  ] as const)('%s: both lines come from the target depth, scored from White', (recorded, cp1, move1, cp2, move2) => {
    const picked = collect(recorded, 'black-to-move').pick(2, DEPTH_12)
    expect(picked?.depth).toBe(12)
    expect(picked?.lines.map((l) => [l.score, l.pv[0]])).toEqual([
      [{ kind: 'cp', white: cp1 }, move1],
      [{ kind: 'cp', white: cp2 }, move2],
    ])
  })

  it('lite: the recorded depth 12 lines, signs flipped for Black to move', () => {
    const picked = collect('lite', 'black-to-move').pick(2, DEPTH_12)
    expect(picked).toEqual({
      depth: 12,
      lines: [
        { score: { kind: 'cp', white: 23 }, pv: 'e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 g8f6 b1c3 f8b4 d4c6 b7c6 f1d3'.split(' ') },
        { score: { kind: 'cp', white: 30 }, pv: 'e7e6 d2d4 d7d5 e4e5 c7c5 c2c3 b8c6 g1f3 d8b6 f1d3 c8d7 e1g1 c5d4 c3d4 c6d4'.split(' ') },
      ],
    })
  })

  it.each(['native', 'lite'] as const)('%s: mate in 1 for White to move is a White mate', (recorded) => {
    const picked = collect(recorded, 'mate-in-1').pick(2, DEPTH_12)
    expect(picked?.lines[0]).toEqual({ score: { kind: 'mate', winner: 'w', moves: 1 }, pv: ['a1a8'] })
    expect(picked?.lines[1]?.score).toMatchObject({ kind: 'cp' })
  })

  it.each(['native', 'lite'] as const)('%s: Black to move and mated next move is a White mate on both lines', (recorded) => {
    const picked = collect(recorded, 'mated-in-1').pick(2, DEPTH_12)
    expect(picked?.lines.map((l) => l.score)).toEqual([
      { kind: 'mate', winner: 'w', moves: 1 },
      { kind: 'mate', winner: 'w', moves: 1 },
    ])
  })

  it.each(['native', 'lite'] as const)('%s: one legal move gives one line', (recorded) => {
    const picked = collect(recorded, 'one-legal-move').pick(1, DEPTH_12)
    expect(picked?.depth).toBe(12)
    expect(picked?.lines).toHaveLength(1)
    expect(picked?.lines[0].pv[0]).toBe('h8g7')
  })

  it.each([
    ['native', 12],
    ['lite', 16],
  ] as const)('%s: after stop, the bounded last depth is skipped (picks depth %i)', (recorded, depth) => {
    expect(collect(recorded, 'stop').pick(2, MOVETIME)?.depth).toBe(depth)
    expect(collect(recorded, 'stop').pick(2, { kind: 'depth', depth: 30 })?.depth).toBe(depth)
  })

  it('a checkmated position yields no line at all', () => {
    expect(collect('native', 'checkmated').pick(1, DEPTH_12)).toBeNull()
    expect(collect('lite', 'checkmated').pick(1, DEPTH_12)).toBeNull()
  })

  it('a reprint of an unsearched row at depth - 1 never overwrites the finished depth', () => {
    const lines = lineCollector('w')
    lines.add(pv(10, 1, 30, 'e2e4 e7e5'))
    lines.add(pv(10, 2, 20, 'd2d4 d7d5'))
    lines.add(pv(11, 1, 35, 'd2d4 g8f6'))
    lines.add(pv(10, 2, 30, 'e2e4 e7e5'))
    expect(lines.pick(2, MOVETIME)?.lines.map((l) => l.pv[0])).toEqual(['e2e4', 'd2d4'])
  })

  it('a movetime search never trusts its last depth, a depth search does', () => {
    const lines = lineCollector('w')
    lines.add(pv(9, 1, 20, 'e2e4'))
    lines.add(pv(9, 2, 10, 'd2d4'))
    lines.add(pv(10, 1, 27, 'g1f3'))
    lines.add(pv(10, 2, 21, 'e2e4'))
    expect(lines.pick(2, MOVETIME)?.depth).toBe(9)
    expect(lines.pick(2, { kind: 'depth', depth: 10 })?.depth).toBe(10)
  })

  it('the last print of a depth wins, since the final MultiPV row re-sorts the earlier ones', () => {
    const lines = lineCollector('w')
    lines.add(pv(20, 1, 30, 'e2e4'))
    lines.add(pv(20, 2, 25, 'e2e4', 'upper'))
    lines.add(pv(20, 1, 40, 'd2d4'))
    lines.add(pv(20, 2, 30, 'e2e4'))
    expect(lines.pick(2, { kind: 'depth', depth: 20 })?.lines.map((l) => l.pv[0])).toEqual(['d2d4', 'e2e4'])
  })
})

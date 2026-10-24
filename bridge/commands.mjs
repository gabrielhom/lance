// The only UCI the app sends (src/engine/session.ts, uci.ts, picker.ts, evaluator.ts), as verb -> validator of its arguments.
// Everything else is refused, so a page on an allowed origin cannot reach options that touch the filesystem
// (Debug Log File, EvalFile, SyzygyPath...) or smuggle a second command after a newline.
const int = (min, max) => (s) => /^\d{1,9}$/.test(s) && Number(s) >= min && Number(s) <= max
const bool = (s) => s === 'true' || s === 'false'

const OPTIONS = new Map([
  ['Threads', int(1, 1024)],
  ['Hash', int(1, 65_536)],
  ['MultiPV', int(1, 500)],
  ['UCI_Elo', int(0, 4000)],
  ['UCI_LimitStrength', bool],
  ['Skill Level', int(0, 20)],
])
const FEN = /^[1-8pnbrqkPNBRQK/]+ [wb] (-|[KQkqA-Ha-h]+) (-|[a-h][36]) \d{1,4} \d{1,5}$/
const MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/
const SEARCH_LIMITS = new Set(['depth', 'movetime', 'nodes'])

const none = (args) => args.length === 0

const setoption = (args) => {
  const at = args.indexOf('value')
  if (args[0] !== 'name' || at < 2) return false
  const check = OPTIONS.get(args.slice(1, at).join(' '))
  return check !== undefined && args.length === at + 2 && check(args[at + 1])
}

const position = (args) => {
  const moves = args.indexOf('moves')
  const head = moves < 0 ? args : args.slice(0, moves)
  const tail = moves < 0 ? [] : args.slice(moves + 1)
  const root = head[0] === 'startpos' ? head.length === 1 : head[0] === 'fen' && FEN.test(head.slice(1).join(' '))
  return root && (moves < 0 || tail.length > 0) && tail.every((m) => MOVE.test(m))
}

const go = (args) => args.length > 0 && args.length % 2 === 0 && args.every((a, i) => (i % 2 === 0 ? SEARCH_LIMITS.has(a) : int(0, 2_000_000_000)(a)))

const COMMANDS = new Map([
  ['uci', none],
  ['isready', none],
  ['ucinewgame', none],
  ['stop', none],
  ['quit', none],
  ['setoption', setoption],
  ['position', position],
  ['go', go],
])

/** Returns why a client frame must not reach the engine, or null when it may. */
export function refusal(frame) {
  if (/[\r\n]/.test(frame)) return 'frame has a line break'
  const [verb, ...args] = frame.split(' ')
  const check = COMMANDS.get(verb)
  if (!check) return `unknown command ${JSON.stringify(verb.slice(0, 20))}`
  return check(args) ? null : `bad arguments for ${verb}`
}

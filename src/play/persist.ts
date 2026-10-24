import type { Color, Opponent, PlaySetup, PlayState, Termination, TimeControl, Uci } from '../domain/types'
import { DEFAULT_LEVEL_ID, levelById } from './levels'
import { tryReplay } from './play'

/** What the setup form remembers. Unlike PlaySetup it keeps "random" as a choice instead of the color it drew. */
export type SetupChoice = { readonly opponent: Opponent; readonly color: Color | 'random'; readonly time: TimeControl }

export const DEFAULT_CHOICE: SetupChoice = {
  opponent: { kind: 'engine', levelId: DEFAULT_LEVEL_ID },
  color: 'w',
  time: { kind: 'none' },
}

const PLAY_KEY = 'lance.play'
const CHOICE_KEY = 'lance.playSetup'
const TERMINATIONS: readonly Termination[] = ['checkmate', 'stalemate', 'repetition', 'fifty-move', 'insufficient-material', 'resignation', 'timeout']
const RESULTS = ['1-0', '0-1', '1/2-1/2'] as const

type Obj = Readonly<Record<string, unknown>>
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isMs = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0
const isColor = (x: unknown): x is Color => x === 'w' || x === 'b'

function parseOpponent(x: unknown): Opponent | null {
  if (!isObj(x)) return null
  if (x.kind === 'local') return { kind: 'local' }
  if (x.kind === 'engine' && typeof x.levelId === 'number' && levelById(x.levelId)) return { kind: 'engine', levelId: x.levelId }
  return null
}

function parseTime(x: unknown): TimeControl | null {
  if (!isObj(x)) return null
  if (x.kind === 'none') return { kind: 'none' }
  if (x.kind === 'clock' && isMs(x.initialMs) && x.initialMs > 0 && isMs(x.incrementMs)) return { kind: 'clock', initialMs: x.initialMs, incrementMs: x.incrementMs }
  return null
}

function parseSetup(x: unknown): PlaySetup | null {
  if (!isObj(x) || !isColor(x.you)) return null
  const opponent = parseOpponent(x.opponent)
  const time = parseTime(x.time)
  return opponent && time ? { opponent, you: x.you, time } : null
}

/** Stored state is untrusted: an old build, a manual edit or a half-written key can leave anything, so anything off is null. */
export function parsePlay(raw: unknown, now: number = Date.now()): PlayState | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !isNum(raw.startedAt) || !Array.isArray(raw.moves)) return null
  const setup = parseSetup(raw.setup)
  if (!setup || !raw.moves.every((m) => typeof m === 'string')) return null
  const board = tryReplay(raw.moves as string[])
  if (!board) return null
  const clocks = isObj(raw.clocks) && isMs(raw.clocks.w) && isMs(raw.clocks.b) ? { w: raw.clocks.w, b: raw.clocks.b } : null
  if ((clocks === null) !== (setup.time.kind === 'none') || (raw.clocks !== null && clocks === null)) return null
  const base = { id: raw.id, setup, startedAt: raw.startedAt, moves: raw.moves as Uci[], clocks }
  if (raw.phase === 'playing' && isNum(raw.turnStartedAt) && !board.isGameOver()) {
    // The page was away from savedAt until now, and that time is nobody's.
    const away = clocks && isNum(raw.savedAt) ? Math.max(0, now - raw.savedAt) : 0
    return { ...base, phase: 'playing', turnStartedAt: raw.turnStartedAt + away }
  }
  const result = RESULTS.find((r) => r === raw.result)
  const termination = TERMINATIONS.find((t) => t === raw.termination)
  if (raw.phase === 'over' && isNum(raw.endedAt) && result && termination) return { ...base, phase: 'over', endedAt: raw.endedAt, result, termination }
  return null
}

function parseChoice(raw: unknown): SetupChoice | null {
  if (!isObj(raw)) return null
  const opponent = parseOpponent(raw.opponent)
  const time = parseTime(raw.time)
  const color = isColor(raw.color) || raw.color === 'random' ? raw.color : null
  return opponent && time && color ? { opponent, color, time } : null
}

function read(key: string): unknown {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

/** Without storage (private mode, quota) the value lasts for this page only. */
function write(key: string, value: unknown): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key)
    else globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    return
  }
}

export const loadPlay = (now: number = Date.now()): PlayState | null => parsePlay(read(PLAY_KEY), now)
/** The save stamp lets loadPlay tell time spent thinking from time spent away. */
export const savePlay = (state: PlayState | null, now: number = Date.now()): void => write(PLAY_KEY, state && { ...state, savedAt: now })
export const loadChoice = (): SetupChoice => parseChoice(read(CHOICE_KEY)) ?? DEFAULT_CHOICE
export const saveChoice = (choice: SetupChoice): void => write(CHOICE_KEY, choice)

export function resolveChoice(choice: SetupChoice, random: () => number): PlaySetup {
  const you = choice.opponent.kind === 'local' ? 'w' : choice.color === 'random' ? (random() < 0.5 ? 'w' : 'b') : choice.color
  return { opponent: choice.opponent, you, time: choice.time }
}

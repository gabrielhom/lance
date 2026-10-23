import type { EngineDescriptor, EngineInput, EngineTuning, MovePicker, PlayLevel, RuntimeEnv, Strength, Uci } from '../domain/types'
import { availability, effectiveTuning, expectedFor } from './descriptor'
import { abortError, EngineFailure } from './failure'
import { openSession, type Session } from './session'
import { connect as connectTransport, type Connect, type LineTransport } from './transport'
import type { UciOption } from './uci'

/** Stockfish's UCI_Elo range. An engine with only Skill Level maps an Elo linearly from it onto levels 0..20. */
const ELO = { min: 1320, max: 3190 }
const TOP_SKILL = 20

/** One engine of its own, booted on the first pick and again after it dies. Picks run one at a time, and a crashed
 *  pick gets one retry on a fresh engine. */
export function createMovePicker(d: EngineDescriptor, tuning: EngineTuning, env: RuntimeEnv, connect: Connect = connectTransport): MovePicker {
  const usable = availability(d, env)
  const single = effectiveTuning(d, { ...tuning, engines: 1 }, env)
  let session: Session | null = null
  let previous: EngineInput | null = null
  let queue: Promise<unknown> = Promise.resolve()
  let disposed = false

  async function engine(): Promise<Session> {
    if (session && session.state !== 'dead') return session
    let transport: LineTransport
    try {
      transport = connect(d)
    } catch (error) {
      throw new EngineFailure({ kind: 'crashed', detail: String(error) })
    }
    const opened = await openSession(transport, single, expectedFor(d))
    if (disposed) {
      opened.close()
      throw abortError()
    }
    session = opened
    return opened
  }

  async function attempt(input: EngineInput, level: PlayLevel, signal: AbortSignal): Promise<Uci> {
    if (disposed || signal.aborted) throw abortError()
    const live = await engine()
    const fresh = previous === null || !continues(previous, input)
    previous = input
    const options = { ...(live.options.has('MultiPV') ? { MultiPV: '1' } : {}), ...strengthOptions(level.strength, live.options) }
    const job = { input, turn: plyOf(input) % 2 === 0 ? 'w' : 'b', limit: { kind: 'movetime', ms: level.movetimeMs }, options, fresh } as const
    return (await live.search(job, signal, () => {})).bestmove
  }

  return {
    pick(input, level, signal) {
      if (!usable.ok) return Promise.reject(new EngineFailure({ kind: 'unavailable', why: usable.error }))
      const crashed = (e: unknown) => e instanceof EngineFailure && e.reason.kind === 'crashed' && !disposed
      const picked = queue.then(() => attempt(input, level, signal).catch((e: unknown) => (crashed(e) ? attempt(input, level, signal) : Promise.reject(e))))
      queue = picked.catch(() => {})
      return picked
    },
    dispose() {
      disposed = true
      session?.close()
    },
  }
}

/** The values of the strength options this engine has. Without UCI_Elo an Elo becomes a Skill Level, and without
 *  Skill Level too every strength is full strength. */
function strengthOptions(strength: Strength, has: ReadonlyMap<string, UciOption>): Record<string, string> {
  const elo = has.has('UCI_LimitStrength') ? has.get('UCI_Elo') : undefined
  if (strength.kind === 'elo' && elo) return { UCI_LimitStrength: 'true', UCI_Elo: spin(strength.elo, elo) }
  const skill = has.get('Skill Level')
  return {
    ...(has.has('UCI_LimitStrength') ? { UCI_LimitStrength: 'false' } : {}),
    ...(skill ? { 'Skill Level': spin(skillLevel(strength, skill), skill) } : {}),
  }
}

type Range = { readonly min: number | null; readonly max: number | null }

function skillLevel(strength: Strength, skill: Range): number {
  switch (strength.kind) {
    case 'skill':
      return strength.level
    case 'elo':
      return ((clamp(strength.elo, ELO) - ELO.min) / (ELO.max - ELO.min)) * TOP_SKILL
    case 'max':
      return skill.max ?? TOP_SKILL
  }
}

function clamp(n: number, range: Range): number {
  return Math.min(range.max ?? Infinity, Math.max(range.min ?? -Infinity, n))
}

function spin(n: number, range: Range): string {
  return String(Math.round(clamp(n, range)))
}

/** Plies since the start of the game, from the root's move number. */
function plyOf({ root, tail }: EngineInput): number {
  const [, turn, , , , move] = root.split(' ')
  return 2 * (Number(move) - 1) + (turn === 'b' ? 1 : 0) + tail.length
}

/** Moves before a root are not in the input, so a later root can only be told from a new game by its ply. */
function continues(previous: EngineInput, next: EngineInput): boolean {
  if (next.root === previous.root) return previous.tail.every((move, i) => next.tail[i] === move)
  return plyOf({ root: next.root, tail: [] }) > plyOf(previous)
}

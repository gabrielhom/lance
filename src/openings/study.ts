import type { ByColor, Color, DrillOutcome, Family, LineId, LineKey, LineProgress, OpeningTree, Schedule, Uci, Variation } from '../domain'
import { inBox, nextSchedule } from '../training/schedule'

export const OPENINGS = {
  /** New variations a session teaches after the ones due. Five siblings with a shared trunk fit one sitting. */
  newPerSession: 5,
  /** A variation is a main one when it has at least this share of the games of the family's variations. */
  mainShare: 0.01,
} as const

export const lineKey = (color: Color, line: LineId): LineKey => `${color} ${line}` as LineKey

/** A first drill makes the line learned: box 0, back tomorrow. After that a drill is an answer to nextSchedule, so a
 *  clean one moves it up a box, a miss sends it to box 0, and before the due day nothing changes. Returns `s` itself
 *  when nothing changes, so the store can skip the write. */
export function nextProgress(s: Schedule | null, outcome: DrillOutcome, now: number): Schedule {
  if (s === null) return inBox(0, now, true)
  return outcome === 'learned' ? s : nextSchedule(s, outcome === 'clean', now)
}

export type LineState =
  | { readonly kind: 'new' }
  | { readonly kind: 'due'; readonly box: number; readonly due: number }
  | { readonly kind: 'learned'; readonly box: number; readonly due: number }
export type StudyLine = { readonly variation: Variation; readonly state: LineState }
export type VariationGroup = {
  /** path[0] of its variations; null for the family's own line. */
  readonly name: string | null
  readonly lines: readonly StudyLine[]
  /** The plies that make the group: the longest start of its first line that two thirds of its lines, and at least
   *  two, begin with; all of a lone line. A line reached by another move order may not begin with them. */
  readonly shared: number
}
export type FamilyStudy = {
  readonly family: Family
  readonly color: Color
  /** Study order. */
  readonly lines: readonly StudyLine[]
  /** The lines to learn first, in study order: the ones with at least OPENINGS.mainShare of the games of the family's
   *  variations, and every line already studied, so no review hides behind them. */
  readonly main: readonly StudyLine[]
  /** Studied at least once with this color. */
  readonly learned: number
  readonly due: number
}

export function familyStudy(family: Family, color: Color, progress: readonly LineProgress[], now: number): FamilyStudy {
  const schedules = new Map(progress.filter((p) => p.color === color).map((p) => [p.line, p.schedule]))
  const lines = family.variations[color].map((variation) => ({ variation, state: stateOf(schedules.get(variation.line.id) ?? null, now) }))
  const games = lines.reduce((sum, l) => sum + l.variation.games, 0)
  return {
    family,
    color,
    lines,
    main: lines.filter(({ variation: v, state }) => state.kind !== 'new' || (v.games > 0 && v.games >= games * OPENINGS.mainShare)),
    learned: lines.filter((l) => l.state.kind !== 'new').length,
    due: lines.filter((l) => l.state.kind === 'due').length,
  }
}

/** By path[0], in order of their first line. */
export function groupsOf(lines: readonly StudyLine[]): readonly VariationGroup[] {
  const groups = new Map<string | null, StudyLine[]>()
  for (const line of lines) {
    const name = line.variation.path[0] ?? null
    groups.set(name, [...(groups.get(name) ?? []), line])
  }
  return [...groups].map(([name, lines]) => {
    const moves = lines.map((l) => l.variation.line.moves)
    const need = lines.length === 1 ? 1 : Math.max(2, Math.ceil((lines.length * 2) / 3))
    let shared = 0
    while (shared < moves[0].length && moves.filter((m) => startsWith(m, moves[0], shared + 1)).length >= need) shared++
    return { name, lines, shared }
  })
}

/** Whether `moves` begins with the first `plies` of `start`. */
export function startsWith(moves: readonly Uci[], start: readonly Uci[], plies = start.length): boolean {
  return plies <= start.length && plies <= moves.length && start.slice(0, plies).every((m, i) => moves[i] === m)
}

function stateOf(s: Schedule | null, now: number): LineState {
  if (s === null) return { kind: 'new' }
  return { kind: s.due <= now ? 'due' : 'learned', box: s.box, due: s.due }
}

/** 'learn' shows the arrows. 'review' is due. 'practice' is a learned line drilled before its day. 'again' repeats a
 *  missed or just-learned line at the end of the session. Only 'learn' and 'review' can move a schedule. */
export type Pass = 'learn' | 'review' | 'practice' | 'again'
export type StudyStep = { readonly variation: Variation; readonly pass: Pass }

/** Due lines, oldest due first, then up to OPENINGS.newPerSession new ones, both in study order on ties. */
export function studyQueue(lines: readonly StudyLine[]): readonly StudyStep[] {
  const due = lines.flatMap((l) => (l.state.kind === 'due' ? [{ variation: l.variation, due: l.state.due }] : [])).sort((a, b) => a.due - b.due)
  const fresh = lines.filter((l) => l.state.kind === 'new').slice(0, OPENINGS.newPerSession)
  return [...due.map(({ variation }) => ({ variation, pass: 'review' as const })), ...fresh.map(({ variation }) => ({ variation, pass: 'learn' as const }))]
}

/** Drilling one chosen variation. */
export function stepFor({ variation, state }: StudyLine): StudyStep {
  return { variation, pass: state.kind === 'new' ? 'learn' : state.kind === 'due' ? 'review' : 'practice' }
}

/** Appends an 'again' step after 'learned' or 'missed', once per variation per session. */
export function requeueStep(steps: readonly StudyStep[], at: number, outcome: DrillOutcome): readonly StudyStep[] {
  const { variation } = steps[at]
  return outcome === 'clean' || steps.some((s) => s.variation === variation && s.pass === 'again') ? steps : [...steps, { variation, pass: 'again' }]
}

/** My games in one group of the weaknesses report, under the family the trainer studies it in. */
export type PlayedOpening = { readonly family: string; readonly color: Color; readonly games: number }
export type CatalogEntry = {
  readonly family: Family
  readonly colors: ByColor<{ readonly total: number; readonly learned: number; readonly due: number }>
  /** My reviewed games in the family with each color. */
  readonly games: ByColor<number>
}

/** Every family with what I learned, have due and played in it per color, by name. */
export function catalog(tree: OpeningTree, progress: readonly LineProgress[], played: readonly PlayedOpening[], now: number): readonly CatalogEntry[] {
  const studied = new Map<string, ByColor<{ learned: number; due: number }>>()
  for (const { row, variation } of live(tree, progress)) {
    const counts = studied.get(variation.line.family) ?? { w: { learned: 0, due: 0 }, b: { learned: 0, due: 0 } }
    counts[row.color].learned++
    if (row.schedule.due <= now) counts[row.color].due++
    studied.set(variation.line.family, counts)
  }
  // Several report groups can fold into one family here, the Veresov and the Stonewall both under the Queen's Pawn Game.
  const games = new Map<string, ByColor<number>>()
  for (const p of played) {
    const counts = games.get(p.family) ?? { w: 0, b: 0 }
    games.set(p.family, { ...counts, [p.color]: counts[p.color] + p.games })
  }
  return tree.families.map((family) => {
    const counts = studied.get(family.name) ?? { w: { learned: 0, due: 0 }, b: { learned: 0, due: 0 } }
    return {
      family,
      colors: { w: { total: family.variations.w.length, ...counts.w }, b: { total: family.variations.b.length, ...counts.b } },
      games: games.get(family.name) ?? { w: 0, b: 0 },
    }
  })
}

/** The catalog studied with one color, each shelf in the order to show it. */
export type CatalogShelves = {
  /** With lines due, most due first. A family with no line for the color is on no shelf. */
  readonly due: readonly CatalogEntry[]
  /** Played or studied and nothing due, most of my games first, then most learned. */
  readonly mine: readonly CatalogEntry[]
  /** The others, the ones strong players reach most (`Family.games`) first. */
  readonly rest: readonly CatalogEntry[]
}

export function shelves(entries: readonly CatalogEntry[], color: Color): CatalogShelves {
  const by = (...keys: ((e: CatalogEntry) => number)[]) => (a: CatalogEntry, b: CatalogEntry) => keys.reduce((d, k) => d || k(b) - k(a), 0)
  const due = (e: CatalogEntry) => e.colors[color].due
  const learned = (e: CatalogEntry) => e.colors[color].learned
  const played = (e: CatalogEntry) => e.games[color]
  const popular = (e: CatalogEntry) => e.family.games
  const listed = entries.filter((e) => e.colors[color].total > 0)
  return {
    due: listed.filter((e) => due(e) > 0).sort(by(due, popular)),
    mine: listed.filter((e) => due(e) === 0 && played(e) + learned(e) > 0).sort(by(played, learned, popular)),
    rest: listed.filter((e) => played(e) + learned(e) === 0).sort(by(popular)),
  }
}

/** Every word of the query in the family's name or its `alias`, ignoring case and accents. */
export function searchCatalog(entries: readonly CatalogEntry[], query: string, alias: (family: string) => string = (f) => f): readonly CatalogEntry[] {
  const words = fold(query).split(/\s+/).filter((w) => w !== '')
  return entries.filter((e) => {
    const names = fold(`${e.family.name} ${alias(e.family.name)}`)
    return words.every((w) => names.includes(w))
  })
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Lines due now across all families, counting only rows whose line is still a variation. */
export function dueCount(tree: OpeningTree, progress: readonly LineProgress[], now: number): number {
  return live(tree, progress).filter(({ row }) => row.schedule.due <= now).length
}

/** The rows whose line the tree still has as a variation of that color. A dataset rebuild can drop one. */
function live(tree: OpeningTree, progress: readonly LineProgress[]): readonly { readonly row: LineProgress; readonly variation: Variation }[] {
  return progress.flatMap((row) => {
    const variation = tree.variation(row.line, row.color)
    return variation ? [{ row, variation }] : []
  })
}

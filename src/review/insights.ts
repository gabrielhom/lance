import { accuracyPercentile } from '../analysis'
import { PHASES, type Color, type GameId, type GameResult, type Identity, type LibraryRecord, type Phase, type PhaseErrors } from '../domain'
import { myGames, type MyGame } from './history'

export const INSIGHTS = {
  /** My games in one opening with one color before the opening gets a verdict. */
  minOpeningGames: 3,
  /** My games with an accuracy in a phase before phases are compared. */
  minPhaseGames: 5,
  /** Games on each side of a trend, and in the rolling average of errors. */
  window: 5,
  /** Points per game, out of 1, at or under which an opening is weak. */
  weakScore: 0.4,
  /** How far my accuracy in an opening can fall under my average before the opening is weak. */
  weakAccuracyGap: 5,
  /** My win% under this where theory ended counts as already worse: about a pawn down. */
  worseAtBookExit: 40,
} as const

/** The mean of the last `INSIGHTS.window` values and of the as many before them. */
export type Trend = { readonly recent: number; readonly previous: number }
/** 'few' until the sample reaches its minimum: no verdict then, only the numbers. */
export type Verdict = 'few' | 'weak' | 'fine'

/** My games in one opening family with one color. */
export type OpeningStats = {
  /** The family, from `family`: 'Sicilian Defense', or 'Queen's Pawn Game: London System' for a catch-all. */
  readonly name: string
  /** 'C41', or the range the family's games span, 'B30–B90'. */
  readonly eco: string
  readonly color: Color
  /** Newest first. */
  readonly games: readonly GameId[]
  /** Points per finished game, 0 to 1; null when none finished. */
  readonly score: number | null
  readonly accuracy: number
  /** Games that know how they stood when theory ended, and how many of them I was already worse in. */
  readonly bookExit: { readonly known: number; readonly worse: number }
  readonly verdict: Verdict
}

/** My play in one phase over the games with my accuracy in it. */
export type PhaseStats = {
  readonly games: number
  readonly accuracy: number | null
  /** Mean over those games of how each ranks among Lichess players in this phase, 0 to 100. */
  readonly percentile: number | null
  readonly trend: Trend | null
  /** My least accurate recent game in this phase, opened where the phase starts. */
  readonly worst: { readonly gameId: GameId; readonly opponent: string; readonly ply: number; readonly accuracy: number } | null
  /** Per game, over those of the games saved with their errors per phase. */
  readonly errors: { readonly games: number; readonly perGame: PhaseErrors } | null
}

export type ErrorPoint = {
  readonly gameId: GameId
  readonly playedAt: number
  readonly errors: PhaseErrors
  /** Mistakes, blunders and misses per game over this game and the ones before it in the window. */
  readonly rolling: number
}

export type Weaknesses = {
  /** My games that count, and `shortGames`, mine left out for too few moves outside theory. */
  readonly games: number
  readonly shortGames: number
  readonly openings: {
    /** Weak first, then by games played. */
    readonly groups: readonly OpeningStats[]
    /** Games with no named opening. */
    readonly unnamed: number
  }
  readonly phases: {
    readonly byPhase: Readonly<Record<Phase, PhaseStats>>
    /** The phase where my games rank lowest among Lichess players; null until two phases have enough games. */
    readonly weakest: Phase | null
    /** Games saved before errors per phase were stored, which the backfill could not refresh. */
    readonly withoutPhaseErrors: number
  }
  readonly errors: {
    /** Oldest first. */
    readonly points: readonly ErrorPoint[]
    /** Of mistakes, blunders and misses per game. */
    readonly trend: Trend | null
    readonly withBlunder: number
    readonly losses: number
    /** Newest first. */
    readonly lossesWithBlunder: readonly GameId[]
  }
}

/** Where I lose points across my reviewed games, from the stored summaries alone. */
export function weaknesses(records: readonly LibraryRecord[], identity: Identity): Weaknesses {
  const { games, shortGames } = myGames(records, identity)
  return {
    games: games.length,
    shortGames,
    openings: openings(games, mean(games.map((g) => g.accuracy)) ?? 0),
    phases: phases(games),
    errors: errors(games),
  }
}

function openings(games: readonly MyGame[], average: number): Weaknesses['openings'] {
  const groups = new Map<string, MyGame[]>()
  let unnamed = 0
  for (const g of games) {
    const opening = g.record.summary.opening
    if (!opening) {
      unnamed++
      continue
    }
    const key = `${family(opening.name)}|${g.color}`
    groups.set(key, [...(groups.get(key) ?? []), g])
  }
  const rank: Record<Verdict, number> = { weak: 0, fine: 1, few: 2 }
  return {
    groups: [...groups.values()]
      .map((list) => openingStats(list, average))
      .sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.games.length - a.games.length || (a.score ?? 1) - (b.score ?? 1)),
    unnamed,
  }
}

/** Catch-all families in the opening book: what 1.d4, 1.e4, 1.Nf3, 1.e3, 1.Nc3, 1.d3 or 1.g3 is called before a named
 *  system. Their variations are openings of their own, the London System or the Colle under the Queen's Pawn Game. */
const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
  "Queen's Pawn Game",
  "King's Pawn Game",
  'Indian Defense',
  'Zukertort Opening',
  "Van't Kruijs Opening",
  'Van Geet Opening',
  'Mieses Opening',
  'Hungarian Opening',
  'Englund Gambit Declined',
])

/** The name before any ':', and for a catch-all family also the variation, up to its first ','. */
export function family(name: string): string {
  const [head, rest] = name.split(/:(.*)/s)
  const f = head.trim()
  return GENERIC_FAMILIES.has(f) && rest ? `${f}: ${rest.split(',')[0].trim()}` : f
}

function openingStats(list: readonly MyGame[], average: number): OpeningStats {
  const { color } = list[0]
  const ecos = [...new Set(list.map((g) => g.record.summary.opening!.eco))].sort()
  const score = mean(list.flatMap((g) => points(g.record.result, g.color) ?? []))
  const accuracy = mean(list.map((g) => g.accuracy))!
  const exits = list.flatMap((g) => (g.record.summary.bookExit === null ? [] : [g.color === 'w' ? g.record.summary.bookExit : 100 - g.record.summary.bookExit]))
  const weak = (score !== null && score <= INSIGHTS.weakScore) || accuracy <= average - INSIGHTS.weakAccuracyGap
  return {
    name: family(list[0].record.summary.opening!.name),
    eco: ecos.length === 1 ? ecos[0] : `${ecos[0]}–${ecos[ecos.length - 1]}`,
    color,
    games: list.map((g) => g.record.id).reverse(),
    score,
    accuracy,
    bookExit: { known: exits.length, worse: exits.filter((w) => w < INSIGHTS.worseAtBookExit).length },
    verdict: list.length < INSIGHTS.minOpeningGames ? 'few' : weak ? 'weak' : 'fine',
  }
}

function phases(games: readonly MyGame[]): Weaknesses['phases'] {
  const byPhase = Object.fromEntries(PHASES.map((p) => [p, phaseStats(games, p)])) as Record<Phase, PhaseStats>
  const compared = PHASES.filter((p) => byPhase[p].games >= INSIGHTS.minPhaseGames)
  return {
    byPhase,
    weakest: compared.length < 2 ? null : compared.reduce((a, b) => (byPhase[b].percentile! < byPhase[a].percentile! ? b : a)),
    withoutPhaseErrors: games.filter((g) => g.record.summary.phaseErrors === null).length,
  }
}

function phaseStats(games: readonly MyGame[], phase: Phase): PhaseStats {
  const played = games.flatMap((g) => {
    const accuracy = g.record.summary.phases?.[g.color][phase] ?? null
    return accuracy === null ? [] : [{ g, accuracy }]
  })
  const accuracies = played.map((p) => p.accuracy)
  const worst = played
    .slice(-2 * INSIGHTS.window)
    .flatMap(({ g, accuracy }) => {
      const ply = phaseStart(g, phase)
      return ply === null ? [] : [{ gameId: g.record.id, opponent: g.record.players[g.color === 'w' ? 'b' : 'w'].name, ply, accuracy }]
    })
    .reduce<PhaseStats['worst']>((w, x) => (w === null || x.accuracy <= w.accuracy ? x : w), null)
  const counted = played.flatMap(({ g }) => (g.record.summary.phaseErrors ? [g.record.summary.phaseErrors[g.color][phase]] : []))
  const per = (k: keyof PhaseErrors) => counted.reduce((s, e) => s + e[k], 0) / counted.length
  return {
    games: played.length,
    accuracy: mean(accuracies),
    percentile: mean(accuracies.map((a) => accuracyPercentile(a, phase))),
    trend: trend(accuracies),
    worst,
    errors: counted.length ? { games: counted.length, perGame: { mistake: per('mistake'), blunder: per('blunder'), miss: per('miss') } } : null,
  }
}

/** The position where my play in the phase begins: out of theory for the opening, else where the Divider starts it. */
function phaseStart({ record: { summary } }: MyGame, phase: Phase): number | null {
  if (phase === 'opening') return summary.counts.w.book + summary.counts.b.book
  return summary.division?.[phase] ?? null
}

function errors(games: readonly MyGame[]): Weaknesses['errors'] {
  const mine = games.map((g) => {
    const { mistake, blunder, miss } = g.record.summary.counts[g.color]
    return { g, errors: { mistake, blunder, miss }, total: mistake + blunder + miss }
  })
  const losses = mine.filter(({ g }) => points(g.record.result, g.color) === 0)
  return {
    points: mine.map(({ g, errors }, i) => ({
      gameId: g.record.id,
      playedAt: g.playedAt,
      errors,
      rolling: mean(mine.slice(Math.max(0, i - INSIGHTS.window + 1), i + 1).map((m) => m.total))!,
    })),
    trend: trend(mine.map((m) => m.total)),
    withBlunder: mine.filter((m) => m.errors.blunder > 0).length,
    losses: losses.length,
    lossesWithBlunder: losses.filter((m) => m.errors.blunder > 0).map(({ g }) => g.record.id).reverse(),
  }
}

function points(result: GameResult, color: Color): number | null {
  if (result === '*') return null
  if (result === '1/2-1/2') return 0.5
  return (result === '1-0') === (color === 'w') ? 1 : 0
}

function trend(xs: readonly number[]): Trend | null {
  const w = INSIGHTS.window
  return xs.length < 2 * w ? null : { recent: mean(xs.slice(-w))!, previous: mean(xs.slice(-2 * w, -w))! }
}

function mean(xs: readonly number[]): number | null {
  return xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null
}

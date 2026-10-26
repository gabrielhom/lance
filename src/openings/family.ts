/** Catch-all families in the opening book: what 1.d4, 1.e4, 1.Nf3, 1.e3, 1.Nc3, 1.d3 or 1.g3 is called before a named
 *  system. Their variations are openings of their own, the London System or the Colle under the Queen's Pawn Game. */
export const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
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

/** Systems the book names both under a catch-all family and on their own: "Queen's Pawn Game: London System" and
 *  "London System" are one opening. Kept by hand so `family` needs no data; lines.test.ts derives the set from
 *  lines.json and fails when the two disagree. */
export const STANDALONE_SYSTEMS: ReadonlySet<string> = new Set([
  'Colle System',
  'Dresden Opening',
  'Dutch Defense',
  'Grünfeld Defense',
  'Gunderam Defense',
  'London System',
  'Modern Defense',
  'Paleface Attack',
  'Polish Defense',
  'St. George Defense',
  'Torre Attack',
  'Wade Defense',
  'Ware Defense',
])

/** Two groupings of one name. The report keeps a catch-all family's systems apart, so a Stonewall's numbers never mix
 *  with a Veresov's; the trainer studies them together under the catch-all, each system a group of its screen. */
type Grouping = 'report' | 'study'

/** The family of a name and the rest of it, one entry per comma, so the two always cut the name at the same place.
 *  The head is the text before the first ':' or ','. A catch-all head names its system after the ':'. */
function cut(name: string, grouping: Grouping): readonly [family: string, path: readonly string[]] {
  const [head, ...rest] = name.split(/[:,]/).map((s) => s.trim())
  if (!GENERIC_FAMILIES.has(head) || name[name.search(/[:,]/)] !== ':') return [head, rest]
  const [system, ...path] = rest
  if (STANDALONE_SYSTEMS.has(system)) return [system, path]
  return grouping === 'report' ? [`${head}: ${system}`, path] : [head, rest]
}

/** 'French Defense, Classical, 4. Bg5' → 'French Defense'; "Queen's Pawn Game: Symmetrical Variation" stays whole, a
 *  system under a catch-all family; "Queen's Pawn Game: London System" → 'London System', a system that is a family too. */
export function family(name: string): string {
  return cut(name, 'report')[0]
}

/** 'Queen's Pawn Game: London System, with e6' → ['with e6']; 'French Defense, Classical, 4. Bg5' → ['Classical',
 *  '4. Bg5']; 'Sicilian Defense' → []. */
export function variationPath(name: string): readonly string[] {
  return cut(name, 'report')[1]
}

/** The trainer's family: "King's Pawn Game: Bavarian Gambit" → "King's Pawn Game", the system a group of that screen;
 *  every other name as `family`. A report family is a name cut at the same places, so this also maps it to the family
 *  the trainer studies it under: "Queen's Pawn Game: Veresov Attack" → "Queen's Pawn Game". */
export function studyFamily(name: string): string {
  return cut(name, 'study')[0]
}

/** "King's Pawn Game: Bavarian Gambit, Accepted" → ['Bavarian Gambit', 'Accepted'], the system first; every other name
 *  as `variationPath`. */
export function studyPath(name: string): readonly string[] {
  return cut(name, 'study')[1]
}

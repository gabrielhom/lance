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

/** The family of a name and the rest of it, one entry per comma, so the two always cut the name at the same place.
 *  The head is the text before the first ':' or ','. A catch-all head names its system after the ':'. */
function cut(name: string): readonly [family: string, path: readonly string[]] {
  const [head, ...rest] = name.split(/[:,]/).map((s) => s.trim())
  if (!GENERIC_FAMILIES.has(head) || name[name.search(/[:,]/)] !== ':') return [head, rest]
  const [system, ...path] = rest
  return [STANDALONE_SYSTEMS.has(system) ? system : `${head}: ${system}`, path]
}

/** 'French Defense, Classical, 4. Bg5' → 'French Defense'; "Queen's Pawn Game: Symmetrical Variation" stays whole, a
 *  system under a catch-all family; "Queen's Pawn Game: London System" → 'London System', a system that is a family too. */
export function family(name: string): string {
  return cut(name)[0]
}

/** 'Queen's Pawn Game: London System, with e6' → ['with e6']; 'French Defense, Classical, 4. Bg5' → ['Classical',
 *  '4. Bg5']; 'Sicilian Defense' → []. */
export function variationPath(name: string): readonly string[] {
  return cut(name)[1]
}

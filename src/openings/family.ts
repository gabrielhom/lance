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

/** The name after its family, split at the commas. 'Queen's Pawn Game: London System, with e6' → ['with e6'];
 *  'Sicilian Defense' → []. Shares GENERIC_FAMILIES with `family`, so the two always cut a name at the same place. */
export function variationPath(name: string): readonly string[] {
  const [head, rest] = name.split(/:(.*)/s)
  if (!rest) return []
  const parts = rest.split(',').map((s) => s.trim())
  return GENERIC_FAMILIES.has(head.trim()) ? parts.slice(1) : parts
}

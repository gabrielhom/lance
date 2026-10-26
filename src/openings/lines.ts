import type { BookMove, Color, Drill, Family, LineId, Opening, OpeningLine, OpeningTree, San, Uci, Variation } from '../domain'
import { studyFamily, studyPath } from './family'

/** [eco, name, uci moves, san moves], moves space-separated, in dataset order. */
export type LineTuple = readonly [string, string, string, string]
export type LineFile = { readonly source: string; readonly license: string; readonly lines: readonly LineTuple[] }
/** Games per Opening name, scripts/build-popularity.mjs counting the broadcast database. */
export type Popularity = Readonly<Record<string, number>>
export type PopularityFile = { readonly source: string; readonly months: readonly string[]; readonly minAvg: number; readonly games: number; readonly counts: Popularity }

/** Trusts its input: scripts/build-openings.mjs writes it from moves chess.js played. */
export function fromTuple([eco, name, uci, san]: LineTuple): OpeningLine {
  return { id: uci as LineId, eco, name, family: studyFamily(name), moves: uci.split(' ') as Uci[], sans: san.split(' ') as San[] }
}

type Node = {
  /** Insertion order is dataset order, the tie-break of study order. */
  readonly children: Map<Uci, Child>
  line: OpeningLine | null
  /** Family → its lines ending at or after this node. */
  readonly count: Map<string, number>
  /** Family → games of its lines ending at or after this node. */
  readonly games: Map<string, number>
}
type Child = Node & { readonly san: San }

/** A game's Opening tag names the deepest position it reached, so a name's games belong to its rows. When several
 *  rows share a name the file can't tell which one a game went through, so each row gets an equal share. */
export function buildTree(file: LineFile, popularity: Popularity): OpeningTree {
  const root: Node = { children: new Map(), line: null, count: new Map(), games: new Map() }
  const rows = new Map<string, number>()
  for (const [, name] of file.lines) rows.set(name, (rows.get(name) ?? 0) + 1)
  const byFamily = new Map<string, OpeningLine[]>()
  for (const tuple of file.lines) {
    const line = fromTuple(tuple)
    const share = (popularity[line.name] ?? 0) / rows.get(line.name)!
    let node = root
    bump(node, line.family, share)
    line.moves.forEach((move, i) => {
      let child = node.children.get(move)
      if (!child) node.children.set(move, (child = { san: line.sans[i], children: new Map(), line: null, count: new Map(), games: new Map() }))
      bump(child, line.family, share)
      node = child
    })
    node.line = line
    byFamily.set(line.family, [...(byFamily.get(line.family) ?? []), line])
  }
  const families = [...byFamily].map(([name, lines]) => familyOf(name, lines, root, popularity)).sort((a, b) => a.name.localeCompare(b.name, 'en'))
  const byName = new Map(families.map((f) => [f.name, f]))
  const byLine = { w: new Map<LineId, Variation>(), b: new Map<LineId, Variation>() }
  for (const f of families) for (const c of ['w', 'b'] as const) for (const v of f.variations[c]) byLine[c].set(v.line.id, v)
  return {
    families,
    family: (name) => byName.get(name) ?? null,
    variation: (line, color) => byLine[color].get(line) ?? null,
    drill: (variation, color, learn) => drillFor(root, variation, color, learn),
  }
}

function bump(node: Node, family: string, games: number) {
  node.count.set(family, (node.count.get(family) ?? 0) + 1)
  node.games.set(family, (node.games.get(family) ?? 0) + games)
}

/** The family's variations in study order: a depth-first walk of its branches, the branch with more of its games first,
 *  ties by its lines. A line is a variation when its node counts only itself for the family, so no other line of the
 *  family extends it. The family's games sum its names, so a name split across rows counts once. */
function familyOf(name: string, lines: readonly OpeningLine[], root: Node, popularity: Popularity): Family {
  const count = (n: Node) => n.count.get(name) ?? 0
  const games = (n: Node) => n.games.get(name) ?? 0
  const order: OpeningLine[] = []
  const visit = (n: Node) => {
    if (n.line?.family === name && count(n) === 1) order.push(n.line)
    const branches = [...n.children.values()].filter((c) => count(c) > 0).sort((a, b) => games(b) - games(a) || count(b) - count(a))
    for (const c of branches) visit(c)
  }
  visit(root)
  const sameName = new Map<string, OpeningLine[]>()
  for (const l of order) sameName.set(l.name, [...(sameName.get(l.name) ?? []), l])
  const variations = order.map((line) => ({ line, path: studyPath(line.name), distinctFrom: distinctFrom(line, sameName.get(line.name)!) }))
  const ecos = [...new Set(lines.map((l) => l.eco))].sort()
  return {
    name,
    eco: ecos.length === 1 ? ecos[0] : `${ecos[0]}–${ecos[ecos.length - 1]}`,
    games: [...new Set(lines.map((l) => l.name))].reduce((sum, n) => sum + (popularity[n] ?? 0), 0),
    variations: { w: variations, b: variations.filter((v) => v.line.moves.length > 1) },
  }
}

/** The first ply where the same-named variations part ways. Two never share every move, since ids are unique. */
function distinctFrom(line: OpeningLine, sameName: readonly OpeningLine[]): number | null {
  if (sameName.length === 1) return null
  let ply = 0
  while (sameName.every((o) => o.moves[ply] === line.moves[ply])) ply++
  return ply
}

function drillFor(root: Node, variation: Variation, color: Color, learn: boolean): Drill {
  const { line } = variation
  const book = new Map<number, Map<Uci, BookMove>>()
  const names: (Opening | null)[] = []
  let node = root
  line.moves.forEach((move, ply) => {
    if ((ply % 2 === 0 ? 'w' : 'b') === color) {
      const others = new Map<Uci, BookMove>()
      for (const [uci, child] of node.children) {
        if (uci === move) continue
        const sameFamily = child.count.has(line.family)
        const named = shallowestLine(child, sameFamily ? line.family : null)
        others.set(uci, { san: child.san, opening: { eco: named.eco, name: named.name }, sameFamily })
      }
      book.set(ply, others)
    }
    node = node.children.get(move)!
    names.push(node.line && { eco: node.line.eco, name: node.line.name })
  })
  return { variation, color, learn, book, names }
}

/** Breadth-first, so the named line fewest moves away wins; within `family` only when one is given. */
function shallowestLine(node: Node, family: string | null): OpeningLine {
  const queue = [node]
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i]
    if (n.line && (family === null || n.line.family === family)) return n.line
    for (const c of n.children.values()) if (family === null || c.count.has(family)) queue.push(c)
  }
  throw new Error('every branch of the trie ends in a line')
}

/** Separate chunks, fetched the first time someone opens the openings; the service worker keeps them for offline use. */
export async function loadTree(): Promise<OpeningTree> {
  const [{ default: file }, { default: popularity }] = await Promise.all([import('./lines.json'), import('./popularity.json')])
  return buildTree(file as unknown as LineFile, (popularity as PopularityFile).counts)
}

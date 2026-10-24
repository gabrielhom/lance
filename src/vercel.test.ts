import { describe, expect, it } from 'vitest'
import vercel from '../vercel.json'

type Rule = { source: string; headers: { key: string; value: string }[] }
const rules: readonly Rule[] = vercel.headers

/** Vercel `source` patterns, limited to literal paths and regex groups. Anything else fails here instead of matching wrongly. */
function sourceRegExp(source: string): RegExp {
  const parts = source.split(/(\([^)]*\))/)
  const body = parts
    .map((p, i) => {
      if (i % 2 === 1) return p
      if (!/^[\w/.-]*$/.test(p)) throw new Error(`unsupported pattern syntax in ${source}`)
      return p.replace(/\./g, '\\.')
    })
    .join('')
  return new RegExp(`^${body}$`)
}

/** The headers a request path gets. Two matching rules setting the same header would depend on Vercel's merge order, so that throws. */
function headersFor(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rule of rules.filter((r) => sourceRegExp(r.source).test(path))) {
    for (const { key, value } of rule.headers) {
      const k = key.toLowerCase()
      if (k in out) throw new Error(`${key} set twice for ${path}`)
      out[k] = value
    }
  }
  return out
}

const base = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
}
const forever = { ...base, 'cache-control': 'public, max-age=31536000, immutable' }
const revalidate = { ...base, 'cache-control': 'no-cache' }

describe('vercel.json headers', () => {
  it.each([
    ['/', revalidate],
    ['/index.html', revalidate],
    ['/sw.js', revalidate],
    ['/build-manifest.json', revalidate],
    ['/manifest.webmanifest', revalidate],
    ['/assets/index-BpyK9ZoK.js', forever],
    ['/assets/source-serif-4-latin-wght-normal-Ct8b9OQn.woff2', forever],
    ['/engine/19.0.1/stockfish-19-lite-single.wasm', forever],
    ['/engine/19.0.1/stockfish-19.js', forever],
    ['/favicon.svg', base],
    ['/icons/icon-512.png', base],
  ])('%s', (path, expected) => {
    expect(headersFor(path)).toEqual(expected)
  })
})

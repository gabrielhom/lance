import { afterEach, describe, expect, it, vi } from 'vitest'
import opera from '../../e2e/fixtures/opera.pgn?raw'
import scholar from '../../e2e/fixtures/scholar.pgn?raw'
import archives from './fixtures/chesscom-erik-archives.json?raw'
import october from './fixtures/chesscom-erik-2026-10.json?raw'
import september from './fixtures/chesscom-erik-2026-09.json?raw'
import lichessGames from './fixtures/lichess-thibault.ndjson?raw'
import lichessVariant from './fixtures/lichess-thibault-variant.ndjson?raw'
import { fetchRecentGames, parsePgnText } from '.'

type Route = { status?: number; body: string; headers?: Record<string, string> }
const requests: { url: string; accept: string | null }[] = []

function serve(routes: Readonly<Record<string, Route>>) {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    requests.push({ url, accept: new Headers(init.headers).get('Accept') })
    init.signal?.throwIfAborted()
    const route = routes[url] ?? { status: 404, body: '{"error":"Not found"}' }
    return new Response(route.body, { status: route.status ?? 200, headers: route.headers })
  })
}

const signal = () => new AbortController().signal

afterEach(() => {
  vi.unstubAllGlobals()
  requests.length = 0
})

describe('parsePgnText', () => {
  it('splits a file of several games and reports the bad ones by position', () => {
    const text = [opera, '[Event "broken"]\n\n1. e4 e5 2. Kxe8 *', scholar.replace(/\n/g, '\r\n')].join('\n\n')
    const { games, rejected } = parsePgnText(`﻿${text}`)
    expect(games.map((g) => g.players.w.name)).toEqual(['Paul Morphy', 'gabrielhom'])
    expect(rejected).toEqual([{ index: 1, rejection: expect.objectContaining({ kind: 'unparseable' }) }])
  })

  it('accepts bare movetext without tags', () => {
    expect(parsePgnText('1. e4 e5 2. Nf3 *').games).toHaveLength(1)
    expect(parsePgnText('   \n').games).toHaveLength(0)
  })
})

describe('fetchRecentGames from Lichess', () => {
  const URL = 'https://lichess.org/api/games/user/thibault?max=3&pgnInJson=true'

  it('asks for NDJSON with the PGN inside and builds games newest first', async () => {
    serve({ [URL]: { body: lichessGames + lichessVariant } })
    const r = await fetchRecentGames('lichess', ' Thibault ', { max: 3, signal: signal() })
    expect(requests).toEqual([{ url: URL, accept: 'application/x-ndjson' }])
    if (!r.ok) throw new Error(r.error.kind)
    expect(r.value.games.map((g) => g.id)).toEqual(['lichess:k8OVq8Y5', 'lichess:aDN8u0zd'])
    expect(r.value.games[0].source).toEqual({ kind: 'lichess', id: 'k8OVq8Y5', url: 'https://lichess.org/k8OVq8Y5' })
    expect(r.value.games[0].positions.at(-1)?.kind).toBe('checkmate')
    expect(r.value.rejected).toEqual([{ index: 2, rejection: { kind: 'variant', detail: 'threeCheck' } }])
  })

  it('maps a missing user, rate limiting and a garbled body to their failures', async () => {
    serve({})
    expect(await fetchRecentGames('lichess', 'no_such_user_qqzx', { max: 3, signal: signal() })).toEqual({
      ok: false,
      error: { kind: 'not-found' },
    })
    serve({ [URL]: { status: 429, body: '', headers: { 'Retry-After': '60' } } })
    expect(await fetchRecentGames('lichess', 'thibault', { max: 3, signal: signal() })).toEqual({
      ok: false,
      error: { kind: 'rate-limited', retryAfterS: 60 },
    })
    serve({ [URL]: { status: 503, body: 'down' } })
    expect(await fetchRecentGames('lichess', 'thibault', { max: 3, signal: signal() })).toMatchObject({
      ok: false,
      error: { kind: 'bad-response' },
    })
    serve({ [URL]: { body: '<!DOCTYPE html>' } })
    expect(await fetchRecentGames('lichess', 'thibault', { max: 3, signal: signal() })).toMatchObject({
      ok: false,
      error: { kind: 'bad-response' },
    })
  })

  it('reports a network failure, and rejects when aborted', async () => {
    vi.stubGlobal('fetch', async () => Promise.reject(new TypeError('Failed to fetch')))
    expect(await fetchRecentGames('lichess', 'thibault', { max: 3, signal: signal() })).toEqual({
      ok: false,
      error: { kind: 'network', detail: 'Failed to fetch' },
    })
    serve({ [URL]: { body: lichessGames } })
    const ac = new AbortController()
    ac.abort()
    await expect(fetchRecentGames('lichess', 'thibault', { max: 3, signal: ac.signal })).rejects.toThrow(
      expect.objectContaining({ name: 'AbortError' }),
    )
  })
})

describe('fetchRecentGames from Chess.com', () => {
  const BASE = 'https://api.chess.com/pub/player/erik/games'
  const routes = {
    [`${BASE}/archives`]: { body: archives },
    [`${BASE}/2026/10`]: { body: october },
    [`${BASE}/2026/09`]: { body: september },
  }

  it('reads the newest month first, latest finished first, and stops once it has enough games', async () => {
    serve(routes)
    const r = await fetchRecentGames('chesscom', 'Erik', { max: 5, signal: signal() })
    expect(requests.map((q) => q.url)).toEqual([`${BASE}/archives`, `${BASE}/2026/10`])
    if (!r.ok) throw new Error(r.error.kind)
    expect(r.value.games).toHaveLength(5)
    expect(r.value.games[0].source).toEqual({
      kind: 'chesscom',
      uuid: '5d1a47d2-c7f4-11f1-b813-55db7f01000b',
      url: 'https://www.chess.com/game/daily/1044272298',
    })
    expect(r.value.games.map((g) => g.source.kind === 'chesscom' && g.source.uuid.slice(0, 8))).toEqual([
      '5d1a47d2', '5d134718', 'f50693fe', '3eddda8a', 'eb30a876',
    ])
  })

  it('moves on to older months and rejects Chess960', async () => {
    serve(routes)
    const r = await fetchRecentGames('chesscom', 'erik', { max: 12, signal: signal() })
    expect(requests.map((q) => q.url)).toEqual([`${BASE}/archives`, `${BASE}/2026/10`, `${BASE}/2026/09`])
    if (!r.ok) throw new Error(r.error.kind)
    expect(r.value.games).toHaveLength(12)
    expect(r.value.rejected).toEqual([
      { index: 8, rejection: { kind: 'variant', detail: 'chess960' } },
      { index: 10, rejection: { kind: 'variant', detail: 'chess960' } },
      { index: 11, rejection: { kind: 'variant', detail: 'chess960' } },
    ])
  })

  it('maps an unknown player to not-found', async () => {
    serve({ [`https://api.chess.com/pub/player/nobody/games/archives`]: { status: 404, body: '{"code":0}' } })
    expect(await fetchRecentGames('chesscom', 'nobody', { max: 5, signal: signal() })).toEqual({
      ok: false,
      error: { kind: 'not-found' },
    })
  })
})

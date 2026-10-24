import { gameFromPgn, type FetchFailure, type Game, type GameRejection, type GameSource, type ImportResult, type Result } from '../domain'

type Site = 'lichess' | 'chesscom'
type Found =
  | { readonly pgn: string; readonly source: GameSource; readonly variant: string | null }
  | { readonly rejection: GameRejection }

const LICHESS_VARIANTS = ['standard', 'fromPosition']
const CHESSCOM_ARCHIVE = 'https://api.chess.com/pub/player/'

/** The user's most recent finished games, newest first. Rejects with the signal's AbortError when aborted. */
export async function fetchRecentGames(
  site: Site,
  username: string,
  opts: { readonly max: number; readonly signal: AbortSignal },
): Promise<Result<ImportResult, FetchFailure>> {
  const user = encodeURIComponent(username.trim().toLowerCase())
  const found = site === 'lichess' ? await lichess(user, opts.max, opts.signal) : await chesscom(user, opts.max, opts.signal)
  return found.ok ? { ok: true, value: importAll(found.value) } : found
}

function importAll(found: readonly Found[]): ImportResult {
  const games: Game[] = []
  const rejected: { index: number; rejection: GameRejection }[] = []
  found.forEach((f, index) => {
    const r: Result<Game, GameRejection> =
      'rejection' in f ? { ok: false, error: f.rejection }
      : f.variant ? { ok: false, error: { kind: 'variant', detail: f.variant } }
      : gameFromPgn(f.pgn, f.source)
    if (r.ok) games.push(r.value)
    else rejected.push({ index, rejection: r.error })
  })
  return { games, rejected }
}

async function lichess(user: string, max: number, signal: AbortSignal): Promise<Result<Found[], FetchFailure>> {
  const body = await get(`https://lichess.org/api/games/user/${user}?max=${max}&pgnInJson=true`, 'application/x-ndjson', signal)
  if (!body.ok) return body
  const found: Found[] = []
  for (const line of body.value.split('\n')) {
    if (line.trim() === '') continue
    const g = parseJson(line)
    if (!isRecord(g) || typeof g.id !== 'string' || typeof g.variant !== 'string' || typeof g.pgn !== 'string') {
      found.push({ rejection: { kind: 'unparseable', detail: `unexpected Lichess game: ${line.slice(0, 80)}` } })
      continue
    }
    found.push({
      pgn: g.pgn,
      source: { kind: 'lichess', id: g.id, url: `https://lichess.org/${g.id}` },
      variant: LICHESS_VARIANTS.includes(g.variant) ? null : g.variant,
    })
  }
  const bad = found.find((f) => 'rejection' in f)
  // Every line bad means the body is not an ndjson game list at all (an error page, say).
  if (bad && 'rejection' in bad && found.every((f) => 'rejection' in f)) return badResponse(bad.rejection.detail)
  return { ok: true, value: found }
}

/** Monthly archives, newest month first, until `max` standard games are in hand. */
async function chesscom(user: string, max: number, signal: AbortSignal): Promise<Result<Found[], FetchFailure>> {
  const index = await getJson(`${CHESSCOM_ARCHIVE}${user}/games/archives`, signal)
  if (!index.ok) return index
  const archives = isRecord(index.value) && Array.isArray(index.value.archives) ? index.value.archives : null
  if (!archives || !archives.every((a) => typeof a === 'string' && a.startsWith(CHESSCOM_ARCHIVE))) {
    return badResponse('unexpected Chess.com archive list')
  }
  const found: Found[] = []
  let standard = 0
  for (const url of [...archives].reverse()) {
    if (standard >= max) break
    const month = await getJson(url, signal)
    if (!month.ok) return month
    const games = isRecord(month.value) && Array.isArray(month.value.games) ? month.value.games : null
    if (!games || !games.every(isChessComGame)) return badResponse(`unexpected Chess.com archive ${url}`)
    for (const g of [...games].sort((a, b) => b.end_time - a.end_time)) {
      if (standard >= max) break
      const variant = g.rules === 'chess' ? null : g.rules
      if (!variant) standard++
      found.push({ pgn: g.pgn, source: { kind: 'chesscom', uuid: g.uuid, url: g.url }, variant })
    }
  }
  return { ok: true, value: found }
}

type ChessComGame = { readonly url: string; readonly uuid: string; readonly rules: string; readonly end_time: number; readonly pgn: string }

function isChessComGame(g: unknown): g is ChessComGame {
  return (
    isRecord(g) &&
    typeof g.url === 'string' &&
    typeof g.uuid === 'string' &&
    typeof g.rules === 'string' &&
    typeof g.end_time === 'number' &&
    typeof g.pgn === 'string'
  )
}

async function getJson(url: string, signal: AbortSignal): Promise<Result<unknown, FetchFailure>> {
  const body = await get(url, 'application/json', signal)
  if (!body.ok) return body
  const value = parseJson(body.value)
  return value === undefined ? badResponse(`not JSON: ${url}`) : { ok: true, value }
}

async function get(url: string, accept: string, signal: AbortSignal): Promise<Result<string, FetchFailure>> {
  try {
    const res = await fetch(url, { headers: { Accept: accept }, signal })
    if (res.status === 404) return { ok: false, error: { kind: 'not-found' } }
    if (res.status === 429) return { ok: false, error: { kind: 'rate-limited', retryAfterS: retryAfter(res.headers.get('Retry-After')) } }
    if (!res.ok) return badResponse(`HTTP ${res.status} from ${url}`)
    return { ok: true, value: await res.text() }
  } catch (e) {
    if (signal.aborted) throw e
    return { ok: false, error: { kind: 'network', detail: e instanceof Error ? e.message : String(e) } }
  }
}

function retryAfter(header: string | null): number | null {
  const s = Number(header)
  return header !== null && Number.isFinite(s) && s >= 0 ? s : null
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

function badResponse(detail: string): Result<never, FetchFailure> {
  return { ok: false, error: { kind: 'bad-response', detail } }
}

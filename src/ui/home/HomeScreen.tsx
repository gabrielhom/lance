import { AlertCircle, ClipboardPaste, Globe, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { FetchFailure, Game, ImportResult, LibraryRecord } from '../../domain/types'
import { fetchFailureText, rejectionText } from '../labels'
import { holdGame } from '../pending'
import { navigate } from '../router'
import { useServices, useSettings } from '../services'
import { useMediaQuery } from '../useMediaQuery'
import { GameList, LibraryList } from './GameList'

type Site = 'lichess' | 'chesscom'
const SITE_LABEL: Readonly<Record<Site, string>> = { lichess: 'Lichess', chesscom: 'Chess.com' }
const LAST_USER_KEY = 'lance.lastUser'

type FetchState =
  | { kind: 'idle' }
  | { kind: 'loading'; username: string }
  | { kind: 'ok'; username: string; result: ImportResult }
  | { kind: 'failed'; username: string; failure: FetchFailure }

function readLastUser(): { site: Site; username: string } {
  try {
    const raw = localStorage.getItem(LAST_USER_KEY)
    if (raw) {
      const v = JSON.parse(raw) as { site: Site; username: string }
      if ((v.site === 'lichess' || v.site === 'chesscom') && typeof v.username === 'string') return v
    }
  } catch {
    /* defaults below */
  }
  return { site: 'lichess', username: '' }
}

export function HomeScreen() {
  const services = useServices()
  const [settings] = useSettings()
  const openGame = (game: Game) => {
    holdGame(game)
    navigate({ name: 'review', id: game.id })
  }
  const [library, setLibrary] = useState<readonly LibraryRecord[] | null>(null)
  useEffect(() => {
    let alive = true
    services.library.list().then((l) => alive && setLibrary(l))
    return () => {
      alive = false
    }
  }, [services])

  // On a phone the import panels fill the first screen, so a returning player sees their games first.
  const wide = useMediaQuery('(min-width: 1024px)')
  const libraryFirst = !wide && !!library && library.length > 0
  const librarySection = (
    <section aria-labelledby="biblioteca-titulo">
      <div className="flex items-baseline justify-between mb-3">
        <h2 id="biblioteca-titulo" className="text-[18px] font-semibold tracking-tight">Partidas revisadas</h2>
        {library && library.length > 0 && <a href="#/historico" className="text-[14px] text-accent font-medium">Ver histórico</a>}
      </div>
      <LibraryList records={library} identity={settings.identity} />
    </section>
  )

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">Revisar uma partida</h1>
        <p className="hint">Cole um PGN ou traga suas partidas do Lichess e do Chess.com para ver precisão, momentos-chave e o que a engine jogaria.</p>
      </header>
      {libraryFirst && librarySection}
      <section className="grid gap-4 lg:grid-cols-2" aria-label="Importar partidas">
        <PastePanel onParsed={openGame} />
        <FetchPanel onPick={openGame} />
      </section>
      {!libraryFirst && librarySection}
    </div>
  )
}

function PastePanel({ onParsed }: { onParsed: (g: Game) => void }) {
  const services = useServices()
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ImportResult | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const submit = (source: string) => {
    const r = services.parsePgnText(source)
    if (r.games.length === 1 && r.rejected.length === 0) onParsed(r.games[0])
    else setParsed(r)
  }
  const readFile = (file: File | undefined) => {
    if (!file) return
    file.text().then((t) => {
      setText(t)
      submit(t)
    })
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    readFile(e.dataTransfer.files[0])
  }

  return (
    <div
      className={`card p-4 sm:p-5 flex flex-col gap-3 ${dragging ? 'ring-2 ring-accent' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-2">
        <ClipboardPaste size={18} className="text-accent" aria-hidden />
        <h2 className="text-[16px] font-semibold">Colar PGN</h2>
      </div>
      <p className="hint">Cole o texto de uma ou mais partidas, ou solte um arquivo .pgn aqui.</p>
      <label className="label" htmlFor="pgn-text">PGN</label>
      <textarea
        id="pgn-text"
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'[Event "Casual"]\n1. e4 e5 2. Nf3 Nc6 ...'}
        spellCheck={false}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" disabled={!text.trim()} onClick={() => submit(text)}>
          Revisar partida
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          <Upload size={16} aria-hidden />
          Abrir arquivo .pgn
        </button>
        <input ref={fileRef} type="file" accept=".pgn,text/plain" className="sr-only" aria-label="Arquivo PGN" onChange={(e) => readFile(e.target.files?.[0])} />
      </div>
      {parsed && <ParsedResult result={parsed} onPick={onParsed} />}
    </div>
  )
}

function ParsedResult({ result, onPick }: { result: ImportResult; onPick: (g: Game) => void }) {
  if (result.games.length === 0 && result.rejected.length === 0) return null
  return (
    <div className="flex flex-col gap-3">
      {result.rejected.length > 0 && (
        <div role="alert" className="flex gap-2 rounded-lg bg-bad-soft text-ink p-3 text-[14px]">
          <AlertCircle size={18} className="text-bad flex-none mt-0.5" aria-hidden />
          <div>
            <p className="font-semibold">{result.rejected.length === 1 ? 'Uma partida não pôde ser lida' : `${result.rejected.length} partidas não puderam ser lidas`}</p>
            <ul className="mt-1 list-disc pl-5 text-ink-2">
              {result.rejected.slice(0, 5).map((r) => {
                const t = rejectionText(r.rejection)
                return (
                  <li key={r.index}>
                    {result.rejected.length + result.games.length > 1 && `Partida ${r.index + 1}: `}
                    {t.text}
                    {t.detail && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[13px]">Detalhes técnicos</summary>
                        <code className="block mt-1 text-[12px] break-words">{t.detail}</code>
                      </details>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
      {result.games.length > 0 && (
        <div>
          <p className="label">{result.games.length === 1 ? '1 partida encontrada' : `${result.games.length} partidas encontradas`}</p>
          <GameList games={result.games} onPick={onPick} />
        </div>
      )}
    </div>
  )
}

function FetchPanel({ onPick }: { onPick: (g: Game) => void }) {
  const services = useServices()
  const [settings] = useSettings()
  const [last] = useState(readLastUser)
  const [site, setSite] = useState<Site>(last.site)
  const [username, setUsername] = useState(
    () => last.username || settings.identity.accounts.find((a) => a.site === last.site || a.site === 'any')?.username || '',
  )
  const [state, setState] = useState<FetchState>({ kind: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const run = () => {
    const u = username.trim()
    if (!u) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      localStorage.setItem(LAST_USER_KEY, JSON.stringify({ site, username: u }))
    } catch {
      /* best effort */
    }
    setState({ kind: 'loading', username: u })
    services.fetchRecentGames(site, u, { max: 20, signal: ac.signal }).then((r) => {
      if (ac.signal.aborted) return
      setState(r.ok ? { kind: 'ok', username: u, result: r.value } : { kind: 'failed', username: u, failure: r.error })
    })
  }

  return (
    <div className="card p-4 sm:p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Globe size={18} className="text-accent" aria-hidden />
        <h2 className="text-[16px] font-semibold">Buscar partidas recentes</h2>
      </div>
      <div className="seg self-start" role="tablist" aria-label="Site">
        {(['lichess', 'chesscom'] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={site === s} onClick={() => setSite(s)}>
            {SITE_LABEL[s]}
          </button>
        ))}
      </div>
      <form
        className="flex flex-col sm:flex-row gap-2 sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          run()
        }}
      >
        <div className="flex-1">
          <label className="label" htmlFor="fetch-user">Nome de usuário no {SITE_LABEL[site]}</label>
          <input id="fetch-user" className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="off" spellCheck={false} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={!username.trim() || state.kind === 'loading'}>
          Buscar
        </button>
      </form>
      <FetchBody state={state} onPick={onPick} onRetry={run} />
    </div>
  )
}

function FetchBody({ state, onPick, onRetry }: { state: FetchState; onPick: (g: Game) => void; onRetry: () => void }) {
  switch (state.kind) {
    case 'idle':
      return <p className="hint">As últimas 20 partidas aparecem aqui para você escolher qual revisar.</p>
    case 'loading':
      return (
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          <p className="hint">Buscando partidas de {state.username}…</p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-12" />
          ))}
        </div>
      )
    case 'failed': {
      const t = fetchFailureText(state.failure, state.username)
      return (
        <div role="alert" className="flex gap-2 rounded-lg bg-bad-soft p-3 text-[14px]">
          <AlertCircle size={18} className="text-bad flex-none mt-0.5" aria-hidden />
          <div className="flex-1">
            <p className="font-semibold">{t.title}</p>
            <p className="text-ink-2 mt-0.5">{t.detail}</p>
            {state.failure.kind !== 'not-found' && (
              <button type="button" className="btn btn-sm mt-2" onClick={onRetry}>
                Tentar de novo
              </button>
            )}
          </div>
        </div>
      )
    }
    case 'ok': {
      const { games, rejected } = state.result
      if (games.length === 0) return <p className="hint">Nenhuma partida recente de {state.username}.</p>
      return (
        <div>
          {rejected.length > 0 && <p className="hint mb-2">{rejected.length} partida(s) ignorada(s) por serem de variantes.</p>}
          <GameList games={games} onPick={onPick} highlight={state.username} />
        </div>
      )
    }
  }
}

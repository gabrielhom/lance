import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Puzzle, PuzzleAttempt, PuzzleTheme, Square, Uci } from '../../domain/types'
import { boardPosition } from '../../play'
import { FILTER_THEMES, nextPuzzle, playerRating, puzzleLine, puzzleSide, replay, START, stepAttempt, type AttemptEvent, type AttemptState, type PlayerRating } from '../../puzzles'
import { colorLabel, moveNumberLabel } from '../format'
import { THEME_LABEL } from '../labels'
import { useMoveEntry } from '../play/MoveInput'
import { PlayBoard } from '../play/PlayBoard'
import { San } from '../san'
import { useServices } from '../services'
import { useMediaQuery } from '../useMediaQuery'

type Loaded = { readonly puzzles: readonly Puzzle[]; readonly attempts: readonly PuzzleAttempt[] }

export function PuzzleScreen() {
  const services = useServices()
  const [loaded, setLoaded] = useState<Loaded | 'failed' | null>(null)
  const [theme, setTheme] = useState<PuzzleTheme | null>(null)
  // `round` tells two picks of the same puzzle apart, so a repeat starts over.
  const [current, setCurrent] = useState<{ puzzle: Puzzle | null; round: number } | null>(null)

  const load = () => {
    Promise.all([services.puzzles.list(), services.puzzles.attempts()]).then(
      ([puzzles, attempts]) => {
        setLoaded({ puzzles, attempts })
        setCurrent({ puzzle: nextPuzzle(puzzles, attempts, playerRating(attempts).rating, null, Math.random), round: 0 })
      },
      () => setLoaded('failed'),
    )
  }
  useEffect(load, [services])

  if (loaded === null || (loaded !== 'failed' && !current)) return <p className="caption" aria-busy="true">Abrindo os puzzles…</p>
  if (loaded === 'failed') {
    return (
      <div className="max-w-lg">
        <h1 className="display text-3xl md:text-5xl">Puzzles</h1>
        <p className="text-ink-2 mt-3" role="alert">Não deu para abrir os puzzles. Na primeira vez eles precisam de internet.</p>
        <button
          type="button"
          className="btn mt-6"
          onClick={() => {
            setLoaded(null)
            load()
          }}
        >
          Tentar de novo
        </button>
      </div>
    )
  }
  const { puzzles, attempts } = loaded
  const rating = playerRating(attempts)
  const pick = (t: PuzzleTheme | null) =>
    setCurrent((c) => ({ puzzle: nextPuzzle(puzzles, attempts, rating.rating, t, Math.random), round: (c?.round ?? 0) + 1 }))
  const filter = (
    <div className="mt-6 max-w-64">
      <label htmlFor="puzzle-tema" className="label">Tema</label>
      <select
        id="puzzle-tema"
        className="field"
        value={theme ?? ''}
        onChange={(e) => {
          const t = (e.target.value || null) as PuzzleTheme | null
          setTheme(t)
          pick(t)
        }}
      >
        <option value="">Todos os temas</option>
        {FILTER_THEMES.map((t) => <option key={t} value={t}>{THEME_LABEL[t]}</option>)}
      </select>
    </div>
  )
  if (!current?.puzzle) {
    return (
      <div className="max-w-lg">
        <h1 className="display text-3xl md:text-5xl">Puzzles</h1>
        <p className="dek">{ratingLine(rating)}</p>
        {filter}
        <p className="mt-6">Nenhum puzzle com esse tema.</p>
      </div>
    )
  }
  return (
    <Attempt
      key={`${current.puzzle.id}@${current.round}`}
      puzzle={current.puzzle}
      rating={rating}
      repeat={attempts.some((a) => a.id === current.puzzle?.id)}
      filter={filter}
      onFinished={(attempt) => {
        // Only a first attempt is stored, and only it moves the rating.
        if (!attempts.some((a) => a.id === attempt.id)) {
          setLoaded({ puzzles, attempts: [...attempts, attempt] })
          return services.puzzles.record(attempt)
        }
      }}
      onNext={() => pick(theme)}
    />
  )
}

function ratingLine({ rating, played }: PlayerRating): string {
  return played === 0 ? `Rating ${Math.round(rating)}, para começar` : `Rating ${Math.round(rating)} · ${played} ${played === 1 ? 'puzzle feito' : 'puzzles feitos'}`
}

type AttemptProps = {
  puzzle: Puzzle
  /** Live: once the attempt is stored it already counts it. */
  rating: PlayerRating
  /** Already tried: this time it doesn't count. */
  repeat: boolean
  filter: ReactNode
  onFinished: (attempt: PuzzleAttempt) => Promise<void> | void
  onNext: () => void
}

/** How long the opponent's move waits, so the player sees the position change. The setup move waits longer. */
const SETUP_MS = 700
const REPLY_MS = 450

function Attempt({ puzzle, rating, repeat: repeatNow, filter, onFinished, onNext }: AttemptProps) {
  const [state, setState] = useState<AttemptState>(START)
  // As they were when the puzzle came up: finishing it stores the attempt, which changes both.
  const [{ before, repeat }] = useState({ before: rating, repeat: repeatNow })
  const [error, setError] = useState<string | null>(null)
  /** null shows how the attempt ended; a number shows the line after that many of its moves. */
  const [view, setView] = useState<number | null>(null)
  const side = puzzleSide(puzzle)
  const line = useMemo(() => puzzleLine(puzzle), [puzzle])
  const over = state.phase === 'solved' || state.phase === 'failed'

  useEffect(() => {
    if (state.phase !== 'opponent') return
    const t = setTimeout(() => setState((s) => stepAttempt(puzzle, s, { kind: 'reply' })), state.played.length === 0 ? SETUP_MS : REPLY_MS)
    return () => clearTimeout(t)
  }, [puzzle, state])

  const act = (event: AttemptEvent) => {
    const next = stepAttempt(puzzle, state, event)
    if (next === state) return
    setState(next)
    if (next.phase !== 'solved' && next.phase !== 'failed') return
    const saved = onFinished({ id: puzzle.id, at: Date.now(), solved: next.phase === 'solved', puzzleRating: puzzle.rating })
    saved?.catch(() => setError('Não deu para salvar o resultado neste navegador.'))
  }

  const shown = useMemo(() => {
    const moves = view !== null ? puzzle.moves.slice(0, view) : state.phase === 'failed' && state.wrong ? [...state.played, state.wrong] : state.played
    const last = moves.at(-1)
    return boardPosition(replay(puzzle.fen, moves), last ? squares(last) : null)
  }, [puzzle, state, view])
  const entry = useMoveEntry({ fen: shown.fen, disabled: state.phase !== 'player', placeholder: 'seu lance', onMove: (uci) => act({ kind: 'move', uci: uci as Uci }) })

  const next = useRef<HTMLButtonElement>(null)
  const finePointer = useMediaQuery('(pointer: fine)')
  useEffect(() => {
    if (over) next.current?.focus()
    // On a phone the field would open the keyboard over the board, so it takes focus only with a mouse or trackpad.
    else if (state.phase === 'player' && finePointer) document.getElementById('lance-digitado')?.focus()
  }, [over, state.phase, finePointer])

  const wrong = state.phase === 'failed' && state.wrong && view === null ? squares(state.wrong) : null
  return (
    <div className="play">
      <div className="min-w-0">
        <PlayBoard
          position={shown}
          orientation={side}
          interactive={state.phase === 'player' && view === null}
          onMove={(uci) => act({ kind: 'move', uci: uci as Uci })}
          badge={wrong ? { square: wrong.to, kind: 'blunder' } : null}
        />
      </div>
      <div className="min-w-0 play-side">
        <h1 className="display text-2xl md:text-4xl">Puzzles</h1>
        <p className="dek">{ratingLine(rating)}</p>
        <section className="annot mt-6" aria-labelledby="puzzle-onde" data-puzzle={puzzle.id} data-phase={state.phase}>
          <p id="puzzle-onde" className="where">{over ? `Puzzle ${puzzle.rating}` : `Você joga com as ${colorLabel(side)}`}</p>
          {over ? (
            <Result puzzle={puzzle} state={state} line={line} before={before} after={rating} repeat={repeat} />
          ) : (
            <>
              <p className="best">
                {state.phase === 'player'
                  ? state.played.length > 1 ? 'Certo. Continue.' : `Ache o melhor lance para as ${colorLabel(side)}.`
                  : state.played.length === 0 ? `As ${colorLabel(side === 'w' ? 'b' : 'w')} jogam…` : 'Certo.'}
              </p>
              <div className="mt-4 max-w-48">{entry.field}</div>
              {entry.error}
              <p className="caption">Arraste ou toque numa peça, ou digite o lance.</p>
              <button type="button" className="tl tl-quiet mt-3" disabled={state.phase !== 'player'} onClick={() => act({ kind: 'give-up' })}>Ver solução</button>
            </>
          )}
          {error && <p className="mt-2 text-sm" role="alert">{error}</p>}
        </section>
        {over && (
          <>
            <Solution line={line} view={view} setView={setView} />
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-6">
              <button ref={next} type="button" className="btn" onClick={onNext}>Próximo puzzle</button>
              <a href={puzzle.gameUrl} target="_blank" rel="noopener noreferrer" className="tl tl-quiet">Ver a partida no Lichess</a>
            </div>
          </>
        )}
        {filter}
      </div>
    </div>
  )
}

type ResultProps = { puzzle: Puzzle; state: AttemptState; line: Line; before: PlayerRating; after: PlayerRating; repeat: boolean }

function Result({ puzzle, state, line, before, after, repeat }: ResultProps) {
  const solved = state.phase === 'solved'
  const at = state.played.length
  const right = line[at]
  const delta = Math.round(after.rating) - Math.round(before.rating)
  return (
    <div role="status">
      <div className="move">
        <span className="cls" style={{ color: solved ? 'var(--c-best)' : 'var(--c-blunder)' }}>
          {solved ? 'Resolvido' : state.phase === 'failed' && state.wrong ? 'Não é esse' : 'Solução'}
        </span>
      </div>
      {!solved && right && (
        <p className="best">
          {state.phase === 'failed' && state.wrong ? 'O certo era' : 'O lance era'} {moveNumberLabel(right.ply)}<San san={right.san} />.
        </p>
      )}
      <p className="mt-3">
        {repeat ? (
          'Você já tinha feito este puzzle, então ele não conta para o rating.'
        ) : (
          <>
            Seu rating: <span className="num">{Math.round(after.rating)}</span>{' '}
            <span className="num" style={{ color: delta >= 0 ? 'var(--c-best)' : 'var(--c-blunder)' }}>{delta >= 0 ? `+${delta}` : `−${-delta}`}</span>
          </>
        )}
      </p>
      {puzzle.themes.length > 0 && <p className="caption mt-2">{puzzle.themes.map((t) => THEME_LABEL[t]).join(' · ')}</p>}
    </div>
  )
}

type Line = ReturnType<typeof puzzleLine>

/** The whole line, the setup move included, to step through on the board. `view` is how many of its moves are on the board. */
function Solution({ line, view, setView }: { line: Line; view: number | null; setView: (v: number) => void }) {
  const at = view ?? 0
  return (
    <div className="line">
      <h2 className="font-serif font-semibold text-md">Solução</h2>
      <ol className="moves" aria-label="Solução">
        {line.map(({ ply, san }, i) => (
          <li key={i}>
            {(ply % 2 === 0 || i === 0) && <span className="n">{moveNumberLabel(ply)}</span>}
            <button type="button" aria-pressed={view === i + 1} onClick={() => setView(i + 1)}>
              <San san={san} />
            </button>
          </li>
        ))}
      </ol>
      <div className="rvnav pl-0" role="toolbar" aria-label="Navegação da solução">
        <button type="button" className="sqbtn" onClick={() => setView(Math.max(1, at - 1))} disabled={view !== null && at <= 1} aria-label="Lance anterior">
          <span aria-hidden>←</span>
        </button>
        <button type="button" className="sqbtn" onClick={() => setView(Math.min(line.length, at + 1))} disabled={at >= line.length} aria-label="Próximo lance">
          <span aria-hidden>→</span>
        </button>
      </div>
    </div>
  )
}

function squares(uci: string): { from: Square; to: Square } {
  return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square }
}

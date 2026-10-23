import { Chess } from 'chess.js'
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, FlipVertical2, SkipBack, SkipForward } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { perspective } from '../../domain/identity'
import type { Color, Game, GameId, GameReview, Perspective, ReviewState, Square } from '../../domain/types'
import { formatDate, formatEval, formatPct, formatTimeControl, joinKnown, playerLabel, resultLabel, sourceLabel } from '../format'
import { ERROR_CLASSIFICATIONS } from '../labels'
import { heldGame } from '../pending'
import { useServices, useSettings } from '../services'
import { AnalyzingPanel, CancelledPanel, FailedPanel } from './Analyzing'
import { Board } from './Board'
import { EvalBar } from './EvalBar'
import { EvalGraph } from './EvalGraph'
import type { GraphMarker } from './EvalGraph'
import { MoveCard } from './MoveCard'
import { MoveList } from './MoveList'
import { Summary } from './Summary'
import { useReview } from './useReview'

type GameSlot =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'ready'; game: Game; perspective: Perspective | null; ply: number }

export function ReviewScreen({ id }: { id: GameId }) {
  const services = useServices()
  const [slot, setSlot] = useState<GameSlot>(() => {
    const held = heldGame(id)
    return held ? { kind: 'ready', ...held } : { kind: 'loading' }
  })
  useEffect(() => {
    if (slot.kind !== 'loading') return
    let alive = true
    services.library.get(id).then((record) => {
      if (!alive) return
      const parsed = record ? services.gameFromRecord(record) : null
      setSlot(parsed?.ok ? { kind: 'ready', game: parsed.value, perspective: null, ply: 0 } : { kind: 'missing' })
    })
    return () => {
      alive = false
    }
  }, [services, id, slot.kind])

  if (slot.kind === 'loading') {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="skeleton h-8 w-64" />
        <div className="skeleton w-full max-w-[560px] aspect-square" />
      </div>
    )
  }
  if (slot.kind === 'missing') {
    return (
      <div className="card p-6 max-w-lg">
        <h1 className="text-[18px] font-semibold">Partida não encontrada</h1>
        <p className="hint mt-1">Ela não está na biblioteca. Importe-a de novo em Revisar.</p>
        <a href="#/revisar" className="btn btn-primary mt-4">Ir para Revisar</a>
      </div>
    )
  }
  return <Review game={slot.game} held={slot.perspective} startPly={slot.ply} />
}

/** Plies of the best line after the move at `ply`, drawn on the board instead of the game. */
type Preview = { readonly ply: number; readonly plies: number }

function Review({ game, held, startPly }: { game: Game; held: Perspective | null; startPly: number }) {
  const [settings] = useSettings()
  const { run, cancel, restart } = useReview(game)
  const who = useMemo(() => held ?? perspective(settings.identity, game.players, game.source), [held, settings, game])
  const myColor: Color | null = who.kind === 'me' ? who.color : null
  const n = game.moves.length
  const [ply, setPly] = useState(Math.min(startPly, n))
  const [flipped, setFlipped] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const orientation: Color = (myColor ?? 'w') === 'w' ? (flipped ? 'b' : 'w') : flipped ? 'w' : 'b'
  const state: ReviewState | null = run.state
  const review: GameReview | null = state?.phase === 'done' ? state.review : null

  const go = (p: number) => {
    setPreview(null)
    setPly(Math.max(0, Math.min(n, p)))
  }
  const errors = review ? review.moves.filter((r) => ERROR_CLASSIFICATIONS.has(r.classification) && (myColor === null || r.move.mover === myColor)) : []
  const nextError = errors.find((r) => r.move.index + 1 > ply)
  const prevError = errors.findLast((r) => r.move.index + 1 < ply)

  const moveReview = review && ply > 0 ? review.moves[ply - 1] : null
  const line = moveReview?.bestLineSan ?? []
  const shownPreview = preview && preview.ply === ply && moveReview ? preview : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.getAttribute('role') === 'slider')) return
      if (shownPreview && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Escape')) {
        e.preventDefault()
        const plies = e.key === 'Escape' ? 0 : shownPreview.plies + (e.key === 'ArrowRight' ? 1 : -1)
        setPreview(plies <= 0 ? null : { ply, plies: Math.min(plies, line.length) })
        return
      }
      const step = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }[e.key]
      if (step === undefined) return
      e.preventDefault()
      setPreview(null)
      setPly((p) => Math.max(0, Math.min(n, p + step)))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n, ply, shownPreview, line.length])

  const previewBoard = useMemo(() => {
    if (!shownPreview || !moveReview) return null
    const b = new Chess(moveReview.move.before.fen)
    let last: { from: Square; to: Square } | null = null
    for (const san of moveReview.bestLineSan.slice(0, shownPreview.plies)) {
      const m = b.move(san)
      last = { from: m.from, to: m.to }
    }
    return { fen: b.fen(), lastMove: last }
  }, [shownPreview, moveReview])

  const position = game.positions[ply]
  const lastMove = ply > 0 ? game.moves[ply - 1] : null
  const badge = moveReview && !previewBoard ? { square: moveReview.move.to, kind: moveReview.classification } : null
  const bestArrow = moveReview && !previewBoard && moveReview.move.uci !== moveReview.best.pv[0] && moveReview.classification !== 'book'
    ? { from: moveReview.best.pv[0].slice(0, 2) as Square, to: moveReview.best.pv[0].slice(2, 4) as Square }
    : null

  const series = review ? review.graph.map((g) => g.whiteWin) : state && state.phase !== 'done' ? state.series : game.positions.map(() => null)
  const labels = useMemo(() => (review ? review.graph.map((g, i) => formatEval(g.label, game.positions[i])) : null), [review, game])
  const markers: GraphMarker[] = review ? review.keyMoments.map((k) => ({ index: k.move.move.index + 1, kind: k.why })) : []
  const whiteWin = previewBoard ? null : series[ply]
  const evalLabel = previewBoard ? null : labels ? labels[ply] : whiteWin === null || whiteWin === undefined ? null : `${Math.round(whiteWin)}%`

  const status =
    run.kind === 'cancelled' ? <CancelledPanel onRetry={restart} />
    : state?.phase === 'failed' ? <FailedPanel failure={state.failure} onRetry={restart} />
    : state?.phase === 'done' ? <Summary review={state.review} me={myColor} onJump={go} />
    : <AnalyzingPanel state={state?.phase === 'analyzing' ? state : null} onCancel={cancel} />
  const card = <MoveCard review={review} ply={ply} labels={labels} preview={shownPreview?.plies ?? null} onPreview={(plies) => setPreview(plies === null ? null : { ply, plies })} />

  return (
    <div className="flex flex-col gap-4 max-w-[1180px] mx-auto">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[20px] font-semibold tracking-tight">
          {playerLabel(game.players.w)} <span className="text-ink-3 font-normal">vs</span> {playerLabel(game.players.b)}
        </h1>
        <p className="text-[14px] text-ink-3">
          {joinKnown(resultLabel(game.result), formatDate(game.playedAt), formatTimeControl(game.timeControl), sourceLabel(game.source))}
        </p>
      </header>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] items-start">
        <div className="flex flex-col gap-3 min-w-0">
          <ReviewStrip state={run.kind === 'cancelled' ? null : state} review={review} me={myColor} analyzing={run.kind === 'running' && (state === null || state.phase === 'analyzing')} />
          <div className="flex gap-2 items-stretch w-full max-w-[min(752px,calc(100dvh-232px))]">
            <EvalBar whiteWin={whiteWin ?? null} label={evalLabel} orientation={orientation} />
            <div className="flex-1 min-w-0">
              <Board
                fen={previewBoard?.fen ?? position.fen}
                orientation={orientation}
                lastMove={previewBoard ? previewBoard.lastMove : lastMove ? { from: lastMove.from, to: lastMove.to } : null}
                badge={badge}
                bestArrow={bestArrow}
              />
            </div>
          </div>
          <div className="flex items-center gap-1 flex-wrap w-full max-w-[min(752px,calc(100dvh-232px))]" role="toolbar" aria-label="Navegação da partida">
            <button type="button" className="btn btn-icon hidden sm:inline-flex" onClick={() => go(0)} disabled={ply === 0} aria-label="Primeiro lance (Home)" title="Home">
              <ChevronFirst size={18} aria-hidden />
            </button>
            <button type="button" className="btn btn-icon" onClick={() => go(ply - 1)} disabled={ply === 0} aria-label="Lance anterior (seta para a esquerda)" title="←">
              <ChevronLeft size={18} aria-hidden />
            </button>
            <button type="button" className="btn btn-icon" onClick={() => go(ply + 1)} disabled={ply === n} aria-label="Próximo lance (seta para a direita)" title="→">
              <ChevronRight size={18} aria-hidden />
            </button>
            <button type="button" className="btn btn-icon hidden sm:inline-flex" onClick={() => go(n)} disabled={ply === n} aria-label="Último lance (End)" title="End">
              <ChevronLast size={18} aria-hidden />
            </button>
            {review && errors.length === 0 ? (
              <span className="text-[14px] text-ink-3 px-2">{myColor ? 'Nenhum erro seu' : 'Nenhum erro'}</span>
            ) : (
              <>
                <button type="button" className="btn btn-icon sm:w-auto sm:px-3.5" onClick={() => prevError && go(prevError.move.index + 1)} disabled={!prevError} aria-label="Erro anterior" title="Erro anterior">
                  <SkipBack size={16} aria-hidden />
                  <span className="hidden sm:inline">Erro anterior</span>
                </button>
                <button type="button" className="btn" onClick={() => nextError && go(nextError.move.index + 1)} disabled={!nextError} title={myColor ? 'Próxima imprecisão, erro, blunder ou chance perdida sua' : 'Próxima imprecisão, erro, blunder ou chance perdida'}>
                  <SkipForward size={16} aria-hidden />
                  Próximo erro
                </button>
              </>
            )}
            <button type="button" className="btn btn-icon ml-auto" onClick={() => setFlipped((f) => !f)} aria-label="Girar o tabuleiro" aria-pressed={flipped} title="Girar o tabuleiro">
              <FlipVertical2 size={18} aria-hidden />
            </button>
            <span className="sr-only" aria-live="polite">
              {previewBoard ? `Melhor sequência, lance ${shownPreview!.plies}: ${line[shownPreview!.plies - 1]}` : lastMove ? `Lance ${ply}: ${lastMove.san}` : 'Posição inicial'}
            </span>
          </div>
        </div>
        <aside className="flex flex-col gap-4 min-w-0">
          {ply === 0 ? <>{status}{card}</> : <>{card}{status}</>}
          <section className="card p-3" aria-label="Lances">
            <MoveList moves={game.moves} reviews={review?.moves ?? null} ply={ply} onSelect={go} />
          </section>
          <section className="card p-4" aria-label="Gráfico de avaliação">
            <EvalGraph series={series} labels={labels} moves={game.moves} markers={markers} ply={ply} onSelect={go} />
          </section>
        </aside>
      </div>
    </div>
  )
}

/** On a phone the summary sits below the board, so this line keeps progress and the result in view above it. */
function ReviewStrip({ state, review, me, analyzing }: { state: ReviewState | null; review: GameReview | null; me: Color | null; analyzing: boolean }) {
  if (review) {
    const { w, b } = review.players
    const text = me
      ? `Você ${formatPct(review.players[me].accuracy)} · Oponente ${formatPct(review.players[me === 'w' ? 'b' : 'w'].accuracy)}`
      : `Brancas ${formatPct(w.accuracy)} · Pretas ${formatPct(b.accuracy)}`
    return <p className="lg:hidden text-[15px] font-semibold tabular">Precisão: {text}</p>
  }
  if (!analyzing) return null
  const pct = state?.phase === 'analyzing' ? Math.round(Math.min(1, Math.max(0, state.progress)) * 100) : 0
  return (
    <div className="lg:hidden flex items-center gap-3" aria-hidden>
      <span className="text-[14px] font-medium text-ink-2 whitespace-nowrap">Analisando · {pct}%</span>
      <div className="progress flex-1"><span style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

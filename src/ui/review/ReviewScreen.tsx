import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, FlipVertical2, SkipForward } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { perspective } from '../../domain/identity'
import type { Color, Game, GameId, GameReview, ReviewState, Square } from '../../domain/types'
import { formatDate, formatTimeControl, playerLabel, resultLabel, sourceLabel } from '../format'
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

type GameSlot = { kind: 'loading' } | { kind: 'missing' } | { kind: 'ready'; game: Game }

export function ReviewScreen({ id }: { id: GameId }) {
  const services = useServices()
  const [slot, setSlot] = useState<GameSlot>(() => {
    const held = heldGame(id)
    return held ? { kind: 'ready', game: held } : { kind: 'loading' }
  })
  useEffect(() => {
    if (slot.kind !== 'loading') return
    let alive = true
    services.library.get(id).then((record) => {
      if (!alive) return
      const parsed = record ? services.gameFromRecord(record) : null
      setSlot(parsed?.ok ? { kind: 'ready', game: parsed.value } : { kind: 'missing' })
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
        <p className="hint mt-1">Ela não está na biblioteca. Importe-a de novo na tela inicial.</p>
        <a href="#/" className="btn btn-primary mt-4">Ir para o início</a>
      </div>
    )
  }
  return <Review game={slot.game} />
}

function Review({ game }: { game: Game }) {
  const [settings] = useSettings()
  const { run, cancel, restart } = useReview(game)
  const who = useMemo(() => perspective(settings.identity, game.players, game.source), [settings, game])
  const myColor: Color | null = who.kind === 'me' ? who.color : null
  const [ply, setPly] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const n = game.moves.length
  const orientation: Color = (myColor ?? 'w') === 'w' ? (flipped ? 'b' : 'w') : flipped ? 'w' : 'b'
  const state: ReviewState | null = run.state
  const review: GameReview | null = state?.phase === 'done' ? state.review : null

  const go = (p: number) => setPly(Math.max(0, Math.min(n, p)))
  const nextError = () => {
    if (!review) return
    const errors = review.moves.filter((r) => ERROR_CLASSIFICATIONS.has(r.classification) && (myColor === null || r.move.mover === myColor))
    if (errors.length === 0) return
    const next = errors.find((r) => r.move.index >= ply) ?? errors[0]
    setPly(next.move.index + 1)
  }
  const hasErrors = !!review && review.moves.some((r) => ERROR_CLASSIFICATIONS.has(r.classification) && (myColor === null || r.move.mover === myColor))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.getAttribute('role') === 'slider')) return
      const step = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }[e.key]
      if (step === undefined) return
      e.preventDefault()
      setPly((p) => Math.max(0, Math.min(n, p + step)))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n])

  const position = game.positions[ply]
  const lastMove = ply > 0 ? game.moves[ply - 1] : null
  const moveReview = review && ply > 0 ? review.moves[ply - 1] : null
  const badge = moveReview ? { square: moveReview.move.to, kind: moveReview.classification } : null
  const bestArrow = moveReview && moveReview.move.uci !== moveReview.best.pv[0] && moveReview.classification !== 'book'
    ? { from: moveReview.best.pv[0].slice(0, 2) as Square, to: moveReview.best.pv[0].slice(2, 4) as Square }
    : null

  const series = review ? review.graph.map((g) => g.whiteWin) : state && state.phase !== 'done' ? state.series : game.positions.map(() => null)
  const labels = review ? review.graph.map((g) => g.label) : null
  const markers: GraphMarker[] = review ? review.keyMoments.map((k) => ({ index: k.move.move.index + 1, kind: k.why })) : []
  const whiteWin = series[ply]
  const evalLabel = labels ? labels[ply] : whiteWin === null ? null : `${Math.round(whiteWin)}%`

  const status =
    run.kind === 'cancelled' ? <CancelledPanel onRetry={restart} />
    : state?.phase === 'failed' ? <FailedPanel failure={state.failure} onRetry={restart} />
    : state?.phase === 'done' ? <Summary review={state.review} />
    : <AnalyzingPanel state={state?.phase === 'analyzing' ? state : null} onCancel={cancel} />

  return (
    <div className="flex flex-col gap-4 max-w-[1180px] mx-auto">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[20px] font-semibold tracking-tight">
          {playerLabel(game.players.w)} <span className="text-ink-3 font-normal">vs</span> {playerLabel(game.players.b)}
        </h1>
        <p className="text-[14px] text-ink-3">
          {resultLabel(game.result)} · {formatDate(game.playedAt)} · {formatTimeControl(game.timeControl)} · {sourceLabel(game.source)}
        </p>
      </header>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] items-start">
        <div className="flex flex-col gap-3 min-w-0">
          <div className="flex gap-2 items-stretch w-full max-w-[720px] mb-3">
            <EvalBar whiteWin={whiteWin} label={evalLabel} orientation={orientation} />
            <div className="flex-1 min-w-0">
              <Board fen={position.fen} orientation={orientation} lastMove={lastMove ? { from: lastMove.from, to: lastMove.to } : null} badge={badge} bestArrow={bestArrow} />
            </div>
          </div>
          <div className="flex items-center gap-1 flex-wrap max-w-[720px]" role="toolbar" aria-label="Navegação da partida">
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
            <button type="button" className="btn" onClick={nextError} disabled={!hasErrors} title={myColor ? 'Próxima imprecisão, erro, blunder ou chance perdida sua' : 'Próxima imprecisão, erro, blunder ou chance perdida'}>
              <SkipForward size={16} aria-hidden />
              Próximo erro
            </button>
            <button type="button" className="btn btn-icon ml-auto" onClick={() => setFlipped((f) => !f)} aria-label="Girar o tabuleiro" aria-pressed={flipped} title="Girar o tabuleiro">
              <FlipVertical2 size={18} aria-hidden />
            </button>
            <span className="sr-only" aria-live="polite">
              {lastMove ? `Lance ${ply}: ${lastMove.san}` : 'Posição inicial'}
            </span>
          </div>
          <div className="max-w-[720px]">
            <MoveCard review={review} ply={ply} />
          </div>
        </div>
        <aside className="flex flex-col gap-4 min-w-0">
          {status}
          <section className="card p-4" aria-label="Gráfico de avaliação">
            <EvalGraph series={series} labels={labels} moves={game.moves} markers={markers} ply={ply} onSelect={go} />
          </section>
          <section className="card p-3" aria-label="Lances">
            <MoveList moves={game.moves} reviews={review?.moves ?? null} ply={ply} onSelect={go} />
          </section>
        </aside>
      </div>
    </div>
  )
}

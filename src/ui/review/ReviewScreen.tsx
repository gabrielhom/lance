import { Chess } from 'chess.js'
import { useEffect, useMemo, useState } from 'react'
import { perspective } from '../../domain/identity'
import type { Color, Game, GameId, GameReview, ReviewState, Square } from '../../domain/types'
import { formatDate, formatEval, formatAccuracy, formatTimeControl, joinKnown, resultLabel, sourceLabel } from '../format'
import { CopyPgn } from '../CopyPgn'
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
  | { kind: 'ready'; game: Game; ply: number }

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
      setSlot(parsed?.ok ? { kind: 'ready', game: parsed.value, ply: 0 } : { kind: 'missing' })
    })
    return () => {
      alive = false
    }
  }, [services, id, slot.kind])

  if (slot.kind === 'loading') {
    return (
      <p className="caption" aria-busy="true">Abrindo a partida…</p>
    )
  }
  if (slot.kind === 'missing') {
    return (
      <div className="max-w-lg">
        <h1 className="display text-3xl md:text-5xl">Partida não encontrada</h1>
        <p className="text-ink-2 mt-3">Ela não está na biblioteca. Importe-a de novo em Revisar.</p>
        <a href="#/revisar" className="btn mt-6">Ir para Revisar</a>
      </div>
    )
  }
  return <Review game={slot.game} startPly={slot.ply} />
}

/** Plies of the best line after the move at `ply`, drawn on the board instead of the game. */
type Preview = { readonly ply: number; readonly plies: number }

function Review({ game, startPly }: { game: Game; startPly: number }) {
  const [settings] = useSettings()
  const { run, cancel, restart } = useReview(game)
  const who = useMemo(() => perspective(settings.identity, game.players, game.source), [settings, game])
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
    : state?.phase === 'done' ? null
    : <AnalyzingPanel state={state?.phase === 'analyzing' ? state : null} onCancel={cancel} />
  const player = (c: Color) => (
    <>
      {game.players[c].name}
      {game.players[c].rating && <span className="num text-ink-3 text-lg font-normal ml-1.5">{game.players[c].rating}</span>}
    </>
  )

  return (
    <div>
      <header>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="display text-2xl md:text-4xl">{player('w')} – {player('b')}</h1>
          <span className="num text-xl md:text-2xl text-ink-2">{resultLabel(game.result)}</span>
        </div>
        <p className="dek">
          {joinKnown(formatTimeControl(game.timeControl), review?.opening?.name ?? null, formatDate(game.playedAt), sourceLabel(game.source))}
          <span className="sep">·</span>
          <CopyPgn pgn={game.pgn} className="tl tl-quiet p-0" />
        </p>
        {review && <ReviewStrip review={review} me={myColor} />}
      </header>
      <div className="review">
        <div className="rv-left">
          <div className="boardwrap">
            <EvalBar whiteWin={whiteWin ?? null} label={evalLabel} orientation={orientation} />
            <Board
              fen={previewBoard?.fen ?? position.fen}
              orientation={orientation}
              lastMove={previewBoard ? previewBoard.lastMove : lastMove ? { from: lastMove.from, to: lastMove.to } : null}
              badge={badge}
              bestArrow={bestArrow}
            />
          </div>
          <div className="rvnav" role="toolbar" aria-label="Navegação da partida">
            <button type="button" className="sqbtn max-md:hidden" onClick={() => go(0)} disabled={ply === 0} aria-label="Primeiro lance (Home)" title="Home">
              <span aria-hidden>⇤</span>
            </button>
            <button type="button" className="sqbtn" onClick={() => go(ply - 1)} disabled={ply === 0} aria-label="Lance anterior (seta para a esquerda)" title="←">
              <span aria-hidden>←</span>
            </button>
            <button type="button" className="sqbtn" onClick={() => go(ply + 1)} disabled={ply === n} aria-label="Próximo lance (seta para a direita)" title="→">
              <span aria-hidden>→</span>
            </button>
            <button type="button" className="sqbtn max-md:hidden" onClick={() => go(n)} disabled={ply === n} aria-label="Último lance (End)" title="End">
              <span aria-hidden>⇥</span>
            </button>
            <span className="ply">{ply === 0 ? 'posição inicial' : `lance ${ply} de ${n}`}</span>
            <span className="ml-auto flex flex-wrap items-baseline justify-end gap-x-5">
              {review && errors.length === 0 ? (
                <span className="caption">{myColor ? 'Nenhum erro seu' : 'Nenhum erro'}</span>
              ) : (
                <>
                  <button type="button" className="tl tl-quiet max-md:hidden" onClick={() => prevError && go(prevError.move.index + 1)} disabled={!prevError}>
                    Erro anterior
                  </button>
                  <button type="button" className="tl tl-accent" onClick={() => nextError && go(nextError.move.index + 1)} disabled={!nextError} title={myColor ? 'Próxima imprecisão, erro, blunder ou chance perdida sua' : 'Próxima imprecisão, erro, blunder ou chance perdida'}>
                    Próximo erro
                  </button>
                </>
              )}
            </span>
            <span className="sr-only" aria-live="polite">
              {previewBoard ? `Melhor sequência, lance ${shownPreview!.plies}: ${line[shownPreview!.plies - 1]}` : lastMove ? `Lance ${ply}: ${lastMove.san}` : 'Posição inicial'}
            </span>
          </div>
          <div className="rv-flip">
            <button type="button" className="tl tl-quiet" onClick={() => setFlipped((f) => !f)} aria-pressed={flipped}>Girar tabuleiro</button>
            {review && errors.length > 0 && (
              <button type="button" className="tl tl-quiet md:hidden" onClick={() => prevError && go(prevError.move.index + 1)} disabled={!prevError}>
                Erro anterior
              </button>
            )}
          </div>
          <section className="rv-graph" aria-labelledby="grafico-titulo">
            <h3 id="grafico-titulo" className="font-serif font-semibold text-md mb-1.5">Avaliação ao longo da partida</h3>
            <EvalGraph series={series} labels={labels} moves={game.moves} markers={markers} classes={review ? review.moves.map((r) => r.classification) : null} ply={ply} onSelect={go} />
          </section>
        </div>
        <div className="rv-right">
          {status}
          <MoveCard
            move={lastMove}
            review={moveReview}
            opening={review?.opening ?? null}
            labels={labels}
            ply={ply}
            preview={shownPreview?.plies ?? null}
            onPreview={(plies) => setPreview(plies === null ? null : { ply, plies })}
          />
          <section className="rv-sheet" aria-label="Lances">
            <MoveList moves={game.moves} reviews={review?.moves ?? null} ply={ply} onSelect={go} />
          </section>
        </div>
      </div>
      {review && <Summary review={review} me={myColor} onJump={go} />}
    </div>
  )
}

/** On a phone the summary sits at the end of a long page, so the accuracies also show under the title. */
function ReviewStrip({ review, me }: { review: GameReview; me: Color | null }) {
  const { w, b } = review.players
  const text = me
    ? `você ${formatAccuracy(review.players[me].accuracy)}, oponente ${formatAccuracy(review.players[me === 'w' ? 'b' : 'w'].accuracy)}`
    : `brancas ${formatAccuracy(w.accuracy)}, pretas ${formatAccuracy(b.accuracy)}`
  return <p className="lg:hidden mt-1 font-serif italic text-ink-2">Precisão: {text}</p>
}

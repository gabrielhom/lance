import { Chess } from 'chess.js'
import { useEffect, useMemo, useState } from 'react'
import { evalLabel, winPct } from '../../analysis'
import { perspective } from '../../domain/identity'
import type { Color, Game, GameId, GameReview, Position, ReviewState, Square, Uci } from '../../domain/types'
import { failureReason } from '../../engine'
import { boardPosition } from '../../play'
import { TOO_SHORT_NOTE, formatDate, formatEval, formatAccuracy, formatTimeControl, joinKnown, moveNumberLabel, resultLabel, sourceLabel, tooShort } from '../format'
import { CopyPgn } from '../CopyPgn'
import { ERROR_CLASSIFICATIONS } from '../labels'
import { heldGame } from '../pending'
import { useMoveEntry } from '../play/MoveInput'
import { PlayBoard } from '../play/PlayBoard'
import { href } from '../router'
import { useServices, useSettings } from '../services'
import { AnalyzingPanel, CancelledPanel, FailedPanel } from './Analyzing'
import { EvalBar } from './EvalBar'
import { EvalGraph } from './EvalGraph'
import type { GraphMarker } from './EvalGraph'
import { LineCard, type LineEval } from './LineCard'
import { MoveCard } from './MoveCard'
import { MoveList } from './MoveList'
import { Summary } from './Summary'
import { useReview } from './useReview'
import { bestLine, bestLinePlies, gameAt, moveOnBoard, shown, step, type View } from './view'

type GameSlot =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'ready'; game: Game; ply: number }

export function ReviewScreen({ id, ply }: { id: GameId; ply?: number }) {
  const services = useServices()
  const [slot, setSlot] = useState<GameSlot>(() => {
    const held = heldGame(id)
    return held ? { kind: 'ready', game: held.game, ply: ply ?? held.ply } : { kind: 'loading' }
  })
  useEffect(() => {
    if (slot.kind !== 'loading') return
    let alive = true
    services.library.get(id).then((record) => {
      if (!alive) return
      const parsed = record ? services.gameFromRecord(record) : null
      setSlot(parsed?.ok ? { kind: 'ready', game: parsed.value, ply: ply ?? 0 } : { kind: 'missing' })
    })
    return () => {
      alive = false
    }
  }, [services, id, ply, slot.kind])

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

function Review({ game, startPly }: { game: Game; startPly: number }) {
  const [settings] = useSettings()
  const { run, cancel, restart } = useReview(game)
  const who = useMemo(() => perspective(settings.identity, game.players, game.source), [settings, game])
  const myColor: Color | null = who.kind === 'me' ? who.color : null
  const n = game.moves.length
  const [view, setView] = useState<View>(() => gameAt(game, startPly))
  const [flipped, setFlipped] = useState(false)
  const orientation: Color = (myColor ?? 'w') === 'w' ? (flipped ? 'b' : 'w') : flipped ? 'w' : 'b'
  const state: ReviewState | null = run.state
  const review: GameReview | null = state?.phase === 'done' ? state.review : null
  const ply = view.ply
  const line = view.kind === 'line' ? view : null
  const toTrain = useTrainingCount(game.id, state?.phase === 'done' && state.saved)

  const go = (p: number) => setView(gameAt(game, p))
  const errors = review ? review.moves.filter((r) => ERROR_CLASSIFICATIONS.has(r.classification) && (myColor === null || r.move.mover === myColor)) : []
  const nextError = errors.find((r) => r.move.index + 1 > ply)
  const prevError = errors.findLast((r) => r.move.index + 1 < ply)
  const moveReview = review && ply > 0 ? review.moves[ply - 1] : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.getAttribute('role') === 'slider' || t.closest('[role="dialog"]'))) return
      if (e.key === 'Escape') return setView((v) => gameAt(game, v.ply))
      const next = { ArrowLeft: (v: View) => step(v, game, -1), ArrowRight: (v: View) => step(v, game, 1), Home: () => gameAt(game, 0), End: () => gameAt(game, Infinity) }[e.key]
      if (!next) return
      e.preventDefault()
      setView(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [game])

  const { position, lastMove } = shown(view, game)
  const board = useMemo(() => boardPosition(new Chess(position.fen), lastMove && { from: lastMove.from, to: lastMove.to }), [position, lastMove])
  const onMove = (uci: string) => setView((v) => moveOnBoard(v, game, uci as Uci))
  const entry = useMoveEntry({ fen: position.fen, disabled: position.kind !== 'playable', placeholder: 'testar um lance', onMove })
  const lineEval = useLineEval(line ? position : null)
  const known = lineEval?.kind === 'known' ? lineEval.eval : null
  const badge = moveReview && !line ? { square: moveReview.move.to, kind: moveReview.classification } : null
  const arrow = line
    ? known?.kind === 'searched' ? squares(known.lines[0].pv[0]) : null
    : moveReview && moveReview.move.uci !== moveReview.best.pv[0] && moveReview.classification !== 'book' ? squares(moveReview.best.pv[0]) : null

  const series = review ? review.graph.map((g) => g.whiteWin) : state && state.phase !== 'done' ? state.series : game.positions.map(() => null)
  const labels = useMemo(() => (review ? review.graph.map((g, i) => formatEval(g.label, game.positions[i])) : null), [review, game])
  const markers: GraphMarker[] = review ? review.keyMoments.map((k) => ({ index: k.move.move.index + 1, kind: k.why })) : []
  const whiteWin = line ? (known ? winPct(known, 'w') : null) : series[ply]
  const barLabel = line
    ? known ? formatEval(evalLabel(known), position) : null
    : labels ? labels[ply] : whiteWin === null || whiteWin === undefined ? null : `${Math.round(whiteWin)}%`

  const status =
    run.kind === 'cancelled' ? <CancelledPanel onRetry={restart} />
    : state?.phase === 'failed' ? <FailedPanel failure={state.failure} onRetry={restart} />
    : state?.phase === 'done' ? null
    : <AnalyzingPanel state={state?.phase === 'analyzing' ? state : null} pace={run.kind === 'running' ? run.pace : undefined} onCancel={cancel} />
  const player = (c: Color) => (
    <>
      {game.players[c].name}
      {game.players[c].rating && <span className="num text-ink-3 text-lg font-normal ml-1.5">{game.players[c].rating}</span>}
    </>
  )

  return (
    <div>
      <div className="review">
      <header className="rv-head">
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
        {toTrain > 0 && (
          <p className="mt-2">
            <a href={href({ name: 'training', game: game.id })} className="tl tl-accent">Treinar os erros desta partida</a>
            <span className="caption ml-2">{toTrain === 1 ? '1 posição' : `${toTrain} posições`}</span>
          </p>
        )}
      </header>
        <div className="rv-left">
          <div className="boardwrap">
            <EvalBar whiteWin={whiteWin ?? null} label={barLabel} orientation={orientation} />
            <PlayBoard position={board} orientation={orientation} interactive onMove={onMove} badge={badge} arrow={arrow} />
          </div>
          <div className="rvnav" role="toolbar" aria-label="Navegação da partida">
            <button type="button" className="sqbtn max-md:hidden" onClick={() => go(0)} disabled={!line && ply === 0} aria-label="Primeiro lance (Home)" title="Home">
              <span aria-hidden>⇤</span>
            </button>
            <button type="button" className="sqbtn" onClick={() => setView(step(view, game, -1))} disabled={!line && ply === 0} aria-label="Lance anterior (seta para a esquerda)" title="←">
              <span aria-hidden>←</span>
            </button>
            <button type="button" className="sqbtn" onClick={() => setView(step(view, game, 1))} disabled={line ? line.at === line.moves.length : ply === n} aria-label="Próximo lance (seta para a direita)" title="→">
              <span aria-hidden>→</span>
            </button>
            <button type="button" className="sqbtn max-md:hidden" onClick={() => go(n)} disabled={!line && ply === n} aria-label="Último lance (End)" title="End">
              <span aria-hidden>⇥</span>
            </button>
            <span className="ply">{line ? `variante, lance ${line.at} de ${line.moves.length}` : ply === 0 ? 'posição inicial' : `lance ${ply} de ${n}`}</span>
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
              {line && lastMove ? `Variante: ${moveNumberLabel(lastMove.index)} ${lastMove.san}` : lastMove ? `Lance ${ply}: ${lastMove.san}` : 'Posição inicial'}
            </span>
          </div>
          <div className="rv-flip">
            <button type="button" className="tl tl-quiet" onClick={() => setFlipped((f) => !f)} aria-pressed={flipped}>Girar tabuleiro</button>
            {entry.field}
            {review && errors.length > 0 && (
              <button type="button" className="tl tl-quiet md:hidden" onClick={() => prevError && go(prevError.move.index + 1)} disabled={!prevError}>
                Erro anterior
              </button>
            )}
          </div>
          {entry.error}
          <section className="rv-graph" aria-labelledby="grafico-titulo">
            <h3 id="grafico-titulo" className="font-serif font-semibold text-md mb-1.5">Avaliação ao longo da partida</h3>
            <EvalGraph series={series} labels={labels} moves={game.moves} markers={markers} classes={review ? review.moves.map((r) => r.classification) : null} ply={ply} onSelect={go} />
          </section>
        </div>
        <div className="rv-right">
          {line && lineEval && <LineCard line={line} evaluation={lineEval} position={position} onAt={(at) => setView({ ...line, at })} onExit={() => go(ply)} />}
          {status}
          <MoveCard
            move={ply > 0 ? game.moves[ply - 1] : null}
            review={moveReview}
            opening={review?.opening ?? null}
            labels={labels}
            ply={ply}
            preview={moveReview && bestLinePlies(view, moveReview.move, moveReview.best.pv)}
            onPreview={(plies) => setView(plies === null || !moveReview ? gameAt(game, ply) : bestLine(moveReview.move, moveReview.best.pv, plies))}
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

const squares = (uci: Uci) => ({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square })

/** The engine's eval of a position off the game, searched while it is on the board. The search stops when it leaves. */
function useLineEval(position: Position | null): LineEval | null {
  const services = useServices()
  const [found, setFound] = useState<{ position: Position; eval: LineEval } | null>(null)
  useEffect(() => {
    if (position?.kind !== 'playable') return
    const ac = new AbortController()
    services.evaluatePosition(position, ac.signal).then(
      (e) => setFound({ position, eval: { kind: 'known', eval: { kind: 'searched', ...e } } }),
      (e: unknown) => ac.signal.aborted || setFound({ position, eval: { kind: 'failed', reason: failureReason(e) } }),
    )
    return () => ac.abort()
  }, [services, position])
  if (!position) return null
  if (position.kind === 'checkmate') return { kind: 'known', eval: { kind: 'checkmate', loser: position.turn } }
  if (position.kind === 'stalemate') return { kind: 'known', eval: { kind: 'stalemate' } }
  return found?.position === position ? found.eval : { kind: 'searching' }
}

/** How many training items the saved review left for this game. */
function useTrainingCount(game: GameId, saved: boolean): number {
  const services = useServices()
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!saved) return
    let alive = true
    services.training.list().then((items) => alive && setCount(items.filter((i) => i.gameId === game).length))
    return () => {
      alive = false
    }
  }, [services, game, saved])
  return count
}

/** On a phone the summary sits at the end of a long page, so the accuracies also show under the title. */
function ReviewStrip({ review, me }: { review: GameReview; me: Color | null }) {
  const { w, b } = review.players
  const text = me
    ? `você ${formatAccuracy(review.players[me].accuracy)}, oponente ${formatAccuracy(review.players[me === 'w' ? 'b' : 'w'].accuracy)}`
    : `brancas ${formatAccuracy(w.accuracy)}, pretas ${formatAccuracy(b.accuracy)}`
  return (
    <p className="lg:hidden mt-1 font-serif italic text-ink-2">
      Precisão: {text}
      {tooShort(review, me) && <span className="block text-sm">{TOO_SHORT_NOTE}</span>}
    </p>
  )
}

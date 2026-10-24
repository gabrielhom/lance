import { Chess } from 'chess.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { playMove } from '../../domain'
import type { Color, GameId, Square, TrainingItem, Uci, Verdict } from '../../domain/types'
import { EngineFailure } from '../../engine'
import { boardPosition } from '../../play'
import { isRetry, itemPosition, requeue, trainingProgress, trainingQueue, type TrainingProgress } from '../../training'
import { colorLabel, moveNumberLabel } from '../format'
import { CLASSIFICATION_LABEL, engineFailureText } from '../labels'
import { useMoveEntry } from '../play/MoveInput'
import { PlayBoard } from '../play/PlayBoard'
import { href } from '../router'
import { Mark, San } from '../san'
import { useServices } from '../services'
import { useMediaQuery } from '../useMediaQuery'

type Turn =
  | { readonly kind: 'asking'; readonly error: string | null }
  | { readonly kind: 'checking'; readonly move: Uci }
  | { readonly kind: 'answered'; readonly move: Uci; readonly verdict: Verdict }

/** A run over a list of items taken when the run starts, so an answered item never jumps back in, except a miss that `requeue` brings back once. */
type Session = { readonly queue: readonly TrainingItem[]; readonly at: number; readonly turn: Turn }

const ASKING: Turn = { kind: 'asking', error: null }

/** `game` trains that game's items, due ones first. Without it the run takes what is due today. */
export function TrainingScreen({ game }: { game: GameId | null }) {
  const services = useServices()
  // Read with the time it was read, so what is due stays put between renders.
  const [loaded, setLoaded] = useState<{ items: readonly TrainingItem[]; now: number } | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const reload = () => services.training.list().then((items) => setLoaded({ items, now: Date.now() }))

  useEffect(() => {
    let alive = true
    services.training.list().then((all) => {
      if (!alive) return
      const now = Date.now()
      const { due, later } = trainingQueue(game ? all.filter((i) => i.gameId === game) : all, now)
      setLoaded({ items: all, now })
      const queue = game ? [...due, ...later] : due
      if (queue.length > 0) setSession({ queue, at: 0, turn: ASKING })
    })
    return () => {
      alive = false
    }
  }, [services, game])

  if (!loaded) return <p className="caption" aria-busy="true">Abrindo o treino…</p>
  const { items, now } = loaded
  const progress = trainingProgress(items, now)
  const item = session?.queue[session.at]
  if (!session || !item) {
    const mine = game ? items.filter((i) => i.gameId === game) : items
    return <Idle items={mine} now={now} game={game} progress={progress} onStart={(queue) => setSession({ queue, at: 0, turn: ASKING })} />
  }
  return (
    <Question
      key={`${item.id}@${session.at}`}
      item={item}
      position={`${session.at + 1} de ${session.queue.length}`}
      progress={progress}
      practice={item.schedule.due > now ? 'early' : isRetry(session.queue, session.at) ? 'retry' : null}
      turn={session.turn}
      setTurn={(turn) => setSession((s) => s && { ...s, turn })}
      onAnswered={(correct) => {
        setSession((s) => s && { ...s, queue: requeue(s.queue, s.at, correct) })
        reload()
      }}
      onNext={() => setSession((s) => s && { ...s, at: s.at + 1, turn: ASKING })}
    />
  )
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function progressLine(p: TrainingProgress): string {
  const due = p.due === 0 ? 'Nada para hoje' : `${plural(p.due, 'posição', 'posições')} para hoje`
  return p.done === 0 ? due : `${due} · ${plural(p.done, 'feita', 'feitas')} hoje, ${plural(p.right, 'certa', 'certas')}`
}

type IdleProps = { items: readonly TrainingItem[]; now: number; game: GameId | null; progress: TrainingProgress; onStart: (queue: readonly TrainingItem[]) => void }

function Idle({ items, now, game, progress, onStart }: IdleProps) {
  const { due, later } = trainingQueue(items, now)
  const title = game ? 'Treino desta partida' : 'Treino'
  if (items.length === 0) {
    return (
      <div className="max-w-lg">
        <h1 className="display text-3xl md:text-5xl">{title}</h1>
        {game ? (
          <p className="text-ink-2 mt-3">Esta partida não tem erros seus para treinar.</p>
        ) : (
          <>
            <p className="text-ink-2 mt-3">
              Seus erros, blunders e chances perdidas nas partidas revisadas viram posições para treinar aqui. Para partidas de fora, informe seus usuários em Configurações.
            </p>
            <a href="#/revisar" className="btn mt-6">Revisar uma partida</a>
          </>
        )}
      </div>
    )
  }
  return (
    <div className="max-w-lg">
      <h1 className="display text-3xl md:text-5xl">{title}</h1>
      <p className="dek" role="status">{progressLine(progress)}</p>
      {due.length > 0 ? (
        <button type="button" className="btn mt-6" onClick={() => onStart(game ? [...due, ...later] : due)}>Começar</button>
      ) : (
        <>
          <p className="mt-6 font-serif text-xl">{progress.done > 0 ? 'Pronto por hoje.' : 'Nada para treinar hoje.'}</p>
          <p className="text-ink-2 mt-1">Treinar antes da hora não muda quando cada posição volta.</p>
          <button type="button" className="btn mt-6" onClick={() => onStart(later)}>Treinar mesmo assim</button>
        </>
      )}
    </div>
  )
}

type QuestionProps = {
  item: TrainingItem
  position: string
  progress: TrainingProgress
  /** Not due yet, or due but asked again after a miss in this session, which set it due tomorrow. Either way the answer leaves the schedule alone. */
  practice: 'retry' | 'early' | null
  turn: Turn
  setTurn: (t: Turn) => void
  onAnswered: (correct: boolean) => void
  onNext: () => void
}

function Question({ item, position, progress, practice, turn, setTurn, onAnswered, onNext }: QuestionProps) {
  const services = useServices()
  const before = useMemo(() => itemPosition(item), [item])
  const mover: Color = before.turn
  const answer = useMemo(() => (turn.kind === 'asking' ? null : playMove(before, turn.move)), [before, turn])
  const board = useMemo(() => {
    // The answer stands on the board while it is checked; once answered, the board goes back to the question with the answer and the engine's arrow drawn.
    if (turn.kind === 'checking' && answer) return boardPosition(new Chess(answer.after.fen), squares(answer.uci))
    const last = turn.kind === 'asking' ? item.lastMove : answer?.uci
    return boardPosition(new Chess(before.fen), last ? squares(last) : null)
  }, [before, item.lastMove, turn.kind, answer])

  // Leaving the screen or the item stops a search that is still running.
  const search = useRef<AbortController | null>(null)
  useEffect(() => () => search.current?.abort(), [])

  const submit = (uci: string) => {
    const move = uci as Uci
    const ac = new AbortController()
    search.current = ac
    setTurn({ kind: 'checking', move })
    services.training
      .check(item, move, ac.signal)
      .then(async (verdict) => {
        await services.training.answer(item.id, verdict !== 'wrong', Date.now())
        if (ac.signal.aborted) return
        setTurn({ kind: 'answered', move, verdict })
        onAnswered(verdict !== 'wrong')
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return
        const why = e instanceof EngineFailure ? engineFailureText(e.reason).title : 'A engine não respondeu'
        setTurn({ kind: 'asking', error: `${why}. Tente o lance de novo.` })
      })
  }
  const entry = useMoveEntry({ fen: before.fen, disabled: turn.kind !== 'asking', placeholder: 'seu lance', onMove: submit })

  const next = useRef<HTMLButtonElement>(null)
  const finePointer = useMediaQuery('(pointer: fine)')
  useEffect(() => {
    if (turn.kind === 'answered') next.current?.focus()
    // On a phone the field would open the keyboard over the board, so it takes focus only with a mouse or trackpad.
    else if (turn.kind === 'asking' && finePointer) document.getElementById('lance-digitado')?.focus()
  }, [turn.kind, finePointer])

  const where = `Lance ${Math.floor(item.index / 2) + 1} das ${colorLabel(mover)}`
  const best = item.best.pv[0]
  return (
    <div className="play">
      <div className="min-w-0">
        <PlayBoard position={board} orientation={mover} interactive={turn.kind === 'asking'} onMove={submit} arrow={turn.kind === 'answered' ? squares(best) : null} />
      </div>
      <div className="min-w-0 play-side">
        <h1 className="display text-2xl md:text-4xl">Treino</h1>
        <p className="dek">{progressLine(progress)}</p>
        <section className="annot mt-6" aria-labelledby="treino-onde">
          <p id="treino-onde" className="where">{where}<span className="sep mx-1.5">·</span>{position}</p>
          {turn.kind === 'answered' ? (
            <Answer item={item} san={answer?.san ?? turn.move} verdict={turn.verdict} />
          ) : (
            <>
              <p className="best">Você errou aqui. Ache um lance melhor para as {colorLabel(mover)}.</p>
              <div className="mt-4 max-w-48">{entry.field}</div>
              {turn.kind === 'checking' ? (
                <p className="caption mt-2" role="status" aria-busy="true">Conferindo o lance…</p>
              ) : (
                <>
                  {turn.error ? <p className="mt-2 text-sm" role="alert">{turn.error}</p> : entry.error}
                  <p className="caption">Arraste ou toque numa peça, ou digite o lance.</p>
                </>
              )}
              {practice === 'retry' && <p className="caption mt-3">Outra tentativa. Esta posição já volta amanhã, acertando ou não.</p>}
              {practice === 'early' && <p className="caption mt-3">Treino extra: esta posição só volta para a agenda no dia marcado.</p>}
            </>
          )}
        </section>
        {turn.kind === 'answered' && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-6">
            <button ref={next} type="button" className="btn" onClick={onNext}>Próxima</button>
            <a href={href({ name: 'review', id: item.gameId, ply: item.index + 1 })} className="tl tl-quiet">Ver o lance na revisão</a>
          </div>
        )}
      </div>
    </div>
  )
}

const VERDICT: Readonly<Record<Verdict, { label: string; color: string }>> = {
  best: { label: 'Certo', color: 'var(--c-best)' },
  close: { label: 'Certo', color: 'var(--c-excellent)' },
  wrong: { label: 'Não é esse', color: 'var(--c-blunder)' },
}

function Answer({ item, san: yours, verdict }: { item: TrainingItem; san: string; verdict: Verdict }) {
  const number = moveNumberLabel(item.index)
  const best = <>{number}<San san={item.bestLineSan[0] ?? item.best.pv[0]} /></>
  const { played } = item
  return (
    <div role="status">
      <div className="move">
        <span className="san">{number}<San san={yours} /></span>
        <span className="cls" style={{ color: VERDICT[verdict].color }}>{VERDICT[verdict].label}</span>
      </div>
      <p className="best">
        {verdict === 'best' ? 'É o lance da engine.' : verdict === 'close' ? <>Quase tão bom quanto {best}, o lance da engine.</> : <>O melhor era {best}.</>}
      </p>
      <p className="mt-3">
        Na partida você jogou {number}<San san={played.san} /><Mark kind={played.classification} />, {CLASSIFICATION_LABEL[played.classification].toLowerCase()}.
      </p>
      {item.bestLineSan.length > 1 && (
        <div className="line">
          <h2 className="font-serif font-semibold text-md">Melhor sequência</h2>
          <ol className="moves" aria-label="Melhor sequência">
            {item.bestLineSan.map((san, i) => {
              const idx = item.index + i
              return (
                <li key={i}>
                  {(idx % 2 === 0 || i === 0) && <span className="n">{moveNumberLabel(idx)}</span>}
                  <San san={san} />
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </div>
  )
}

function squares(uci: string): { from: Square; to: Square } {
  return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square }
}

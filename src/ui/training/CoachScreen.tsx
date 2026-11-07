import { useEffect, useMemo, useRef, useState } from 'react'
import type { BookPosition, Coach, Color, OpeningTree, Square, Uci } from '../../domain'
import { COACH_START, coachAt, coachSummary, coachTurn, explain, stepCoach, type CoachEvent, type CoachState, type Explanation } from '../../openings'
import { DEFAULT_LEVEL_ID, levelById, loadChoice, playFrom, playPosition } from '../../play'
import { colorLabel, moveNumberLabel } from '../format'
import { useMoveEntry } from '../play/MoveInput'
import { PlayBoard, type BoardArrow } from '../play/PlayBoard'
import { openingName } from '../openingNames'
import { ConfirmDialog } from '../play/ConfirmDialog'
import { levelLabel } from '../play/names'
import { href, navigate } from '../router'
import { San } from '../san'
import { useServices } from '../services'
import { useMediaQuery } from '../useMediaQuery'
import { continuationText, engineText, factsText, lineName, moveText, placeText, suggestionsText, theoryText } from './coachText'
import { Trouble } from './OpeningScreen'
import { usePositionEvals } from './usePositionEvals'

/** How long the coach's move waits, so the player sees the position change. The first one waits longer. */
const SETUP_MS = 700
const REPLY_MS = 450

/** A family played against the coach with one color. Nothing is stored: the drill keeps the schedule. */
export function CoachScreen({ family: name, color }: { family: string; color: Color }) {
  const services = useServices()
  const [tree, setTree] = useState<OpeningTree | 'failed' | null>(null)
  const load = () => {
    services.openings.tree().then(setTree, () => setTree('failed'))
  }
  useEffect(load, [services])

  const family = tree && tree !== 'failed' ? tree.family(name) : null
  const coach = useMemo<Coach | null>(() => (tree && tree !== 'failed' && family ? { book: tree.book(family), color } : null), [tree, family, color])
  if (tree === null) return <p className="caption" aria-busy="true">Abrindo as aberturas…</p>
  if (tree === 'failed') {
    return (
      <Trouble title={name} text="Não deu para abrir as aberturas. Na primeira vez elas precisam de internet.">
        <button
          type="button"
          className="btn mt-6"
          onClick={() => {
            setTree(null)
            load()
          }}
        >
          Tentar de novo
        </button>
      </Trouble>
    )
  }
  if (!coach) {
    return (
      <Trouble title={name} text="Nenhuma abertura com esse nome na base.">
        <a href={href({ name: 'openings' })} className="btn mt-6">Ver as aberturas</a>
      </Trouble>
    )
  }
  return <Round tree={tree} coach={coach} />
}

function Round({ tree, coach }: { tree: OpeningTree; coach: Coach }) {
  const { book, color } = coach
  const services = useServices()
  const family = book.family
  const engine = usePositionEvals()
  const [state, setState] = useState<CoachState>(COACH_START)
  /** Where earlier rounds ended, so the coach heads elsewhere next. */
  const [seen, setSeen] = useState<ReadonlySet<BookPosition>>(() => new Set())
  /** The ply whose explanation the move list opened; null shows the latest moves. */
  const [picked, setPicked] = useState<number | null>(null)
  /** The ply at which "Mostrar a teoria" was opened, so it closes with the next move. */
  const [theoryAt, setTheoryAt] = useState<number | null>(null)
  const step = (event: CoachEvent) => {
    setPicked(null)
    setState((s) => stepCoach(coach, s, event))
  }

  const explained = useMemo(() => explain(coach, state, engine.evals), [coach, state, engine.evals])
  const { want } = engine
  useEffect(() => want(explained.wanted), [want, explained.wanted])

  const turn = coachTurn(coach, state)
  const at = coachAt(coach, state)
  const plies = state.plies.length
  useEffect(() => {
    if (turn !== 'theirs') return
    const t = setTimeout(() => {
      setPicked(null)
      setState((s) => stepCoach(coach, s, { kind: 'reply', roll: Math.random(), seen }))
    }, plies === 0 ? SETUP_MS : REPLY_MS)
    return () => clearTimeout(t)
  }, [coach, turn, plies, seen])

  const moves = useMemo(() => [...state.plies.map((p) => p.uci), ...(state.departure ? [state.departure.uci] : [])], [state])
  const board = useMemo(() => playPosition(moves), [moves])
  const entry = useMoveEntry({ fen: board.fen, disabled: turn !== 'mine', placeholder: 'seu lance', onMove: (uci) => step({ kind: 'move', uci: uci as Uci }) })

  const showTheory = turn === 'departed' || theoryAt === plies
  // `wanted` starts with the board's position, the one the engine's choice is read from.
  const searched = showTheory && explained.wanted.length > 0 ? engine.evals(explained.wanted[0]) : null
  const best = searched?.kind === 'done' ? searched.eval.lines[0].pv[0] : null
  const arrows: BoardArrow[] = showTheory ? at.moves.slice(0, 3).filter((m) => m.uci !== best).map((m) => squares(m.uci)) : []
  if (best) arrows.push({ ...squares(best), color: 'var(--c-best)' })

  const again = useRef<HTMLButtonElement>(null)
  const retry = useRef<HTMLButtonElement>(null)
  const finePointer = useMediaQuery('(pointer: fine)')
  useEffect(() => {
    if (turn === 'done') again.current?.focus()
    else if (turn === 'departed') retry.current?.focus()
    // On a phone the field would open the keyboard over the board, so it takes focus only with a mouse or trackpad.
    else if (turn === 'mine' && finePointer) document.getElementById('lance-digitado')?.focus()
  }, [turn, finePointer])

  const lastCoach = state.plies.findLastIndex((_, i) => (i % 2 === 0 ? 'w' : 'b') !== color)
  const notes =
    picked !== null ? [explained.plies[picked]]
    : explained.departure ? [explained.departure]
    : explained.plies.slice(-2)
  const summary = turn === 'done' ? coachSummary(coach, state) : null
  const drill = summary && tree.variation(summary.reached.id, color)
  const other = () => {
    setSeen((s) => new Set(s).add(at))
    setPicked(null)
    setTheoryAt(null)
    setState(COACH_START)
  }

  const [replacing, setReplacing] = useState(false)
  const choice = loadChoice()
  const level = levelById(choice.opponent.kind === 'engine' ? choice.opponent.levelId : DEFAULT_LEVEL_ID)
  const carryOn = () => {
    if (!level) return
    const setup = { opponent: { kind: 'engine' as const, levelId: level.id }, you: color, time: choice.time }
    services.savePlay(playFrom(setup, state.plies.map((p) => p.uci), Date.now()))
    navigate({ name: 'play' })
  }
  const askCarryOn = () => {
    const running = services.loadPlay()
    if (running?.phase === 'playing' && running.moves.length > 0) setReplacing(true)
    else carryOn()
  }

  return (
    <div className="play">
      <div className="min-w-0">
        <PlayBoard position={board} orientation={color} interactive={turn === 'mine'} onMove={(uci) => step({ kind: 'move', uci: uci as Uci })} arrows={arrows} />
      </div>
      <div className="min-w-0 play-side">
        <a href={href({ name: 'opening', family: family.name, color })} className="tl tl-quiet text-sm">{openingName(family.name)}</a>
        <h1 className="display text-2xl md:text-4xl mt-1">Com o treinador</h1>
        <p className="dek">{openingName(family.name)} de {colorLabel(color)}. O treinador joga as {colorLabel(color === 'w' ? 'b' : 'w')} pela teoria e explica cada lance.</p>
        <section
          className="annot mt-6"
          aria-labelledby="treinador-onde"
          data-turn={turn}
          data-moves={state.plies.map((p) => p.uci).join(' ')}
          data-book={at.moves.map((m) => m.uci).join(' ')}
          data-coach-move={lastCoach < 0 ? '' : state.plies[lastCoach].uci}
          data-departure={state.departure ? (state.departure.opening ? 'other-opening' : 'off-book') : ''}
        >
          <p id="treinador-onde" className="where">{plies === 0 ? 'Posição inicial' : placeText(at)}</p>
          {summary ? (
            <div role="status">
              <div className="move"><span className="cls" style={{ color: 'var(--c-best)' }}>Fim da teoria</span></div>
              <p className="best">A teoria desta abertura acaba aqui, em {lineName(summary.reached)}.</p>
              <p className="mt-2">
                {summary.firstTry} de {summary.myMoves} {summary.myMoves === 1 ? 'lance seu' : 'lances seus'} de primeira
                {summary.offBook + summary.otherOpening > 0 && `, ${summary.offBook + summary.otherOpening} fora da teoria`}.
              </p>
            </div>
          ) : turn === 'departed' ? (
            <p className="best">Volte o lance e tente um da teoria.</p>
          ) : turn === 'theirs' ? (
            <p className="best">{plies === 0 ? `As ${colorLabel(color === 'w' ? 'b' : 'w')} jogam…` : 'O treinador responde…'}</p>
          ) : (
            <>
              <p className="best">{plies === 0 ? 'Jogue o primeiro lance da abertura.' : 'Sua vez. Jogue um lance da teoria.'}</p>
              <div className="mt-4 max-w-48">{entry.field}</div>
              {entry.error}
              <p className="caption">Arraste ou toque numa peça, ou digite o lance.</p>
            </>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            {turn === 'departed' && <button ref={retry} type="button" className="btn" onClick={() => step({ kind: 'retry' })}>Tentar de novo</button>}
            {turn === 'mine' && (
              <button type="button" className="tl tl-quiet text-sm" aria-expanded={showTheory} onClick={() => setTheoryAt(showTheory ? null : plies)}>
                {showTheory ? 'Esconder a teoria' : 'Mostrar a teoria'}
              </button>
            )}
            {summary && (
              <>
                <button ref={again} type="button" className="btn" onClick={other}>Outra rodada</button>
                <button type="button" className="btn" onClick={askCarryOn}>Continuar contra a engine</button>
                {drill && <a href={href({ name: 'opening', family: family.name, color, ...(drill.path[0] ? { group: drill.path[0] } : null) })} className="tl tl-quiet">Estudar esta variação</a>}
              </>
            )}
          </div>
          {summary && level && <p className="caption mt-3">Contra o Stockfish no nível {levelLabel(level)}{choice.opponent.kind === 'engine' ? ', o último que você escolheu em Jogar' : ''}.</p>}
          {turn === 'mine' && showTheory && (
            <p className="caption mt-3">
              A teoria joga aqui {at.moves.map((m) => continuationText(m, plies)).join(', ')}.
            </p>
          )}
          {notes.map((e) => (
            <Note key={`${e.move.index}${e.move.uci}`} e={e} onRetry={engine.retry} />
          ))}
        </section>
        {plies > 0 && (
          <div className="line">
            <h2 className="font-serif font-semibold text-md">Lances da rodada</h2>
            <ol className="moves" aria-label="Lances da rodada">
              {state.plies.map((p, i) => (
                <li key={i}>
                  <button type="button" aria-pressed={picked === i} onClick={() => setPicked(picked === i ? null : i)}>
                    {(i % 2 === 0 || i === 0) && <span className="n">{moveNumberLabel(i)}</span>}
                    <San san={p.san} />
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={replacing}
        title="Começar esta partida?"
        body="Há uma partida em andamento. Começar esta no lugar dela?"
        confirm="Descartar e começar"
        onConfirm={carryOn}
        onClose={() => setReplacing(false)}
      />
    </div>
  )
}

/** One move explained: whose it is, its theory and the position it reached, what it does, and what the engine says. */
function Note({ e, onRetry }: { e: Explanation; onRetry: () => void }) {
  const departed = e.theory.kind === 'off-book' || e.theory.kind === 'other-opening'
  const facts = factsText(e.facts)
  const suggestions = suggestionsText(e)
  return (
    <article className="coach-note" aria-label={`${e.by === 'me' ? 'Seu lance' : 'Lance do treinador'} ${moveText(e.move.index, e.move.san)}`}>
      <p className="caption">{e.by === 'me' ? 'Seu lance' : 'Lance do treinador'}</p>
      <div className="move">
        <span className="san">{moveNumberLabel(e.move.index)}<San san={e.move.san} /></span>
        <span className="cls" style={{ color: departed ? 'var(--c-mistake)' : 'var(--c-book)' }}>
          {e.theory.kind === 'off-book' ? 'Fora da teoria' : e.theory.kind === 'other-opening' ? 'Outra abertura' : 'Teoria'}
        </span>
      </div>
      <p>
        {theoryText(e)}
        {(e.theory.kind === 'book' || e.theory.kind === 'transposition') && ` ${placeText(e.theory.reached)}`}
      </p>
      {facts && <p className="mt-2">{facts}</p>}
      <p className="mt-2" role="status" aria-busy={e.engine.kind === 'pending'}>{engineText(e)}</p>
      {e.engine.kind === 'failed' && <button type="button" className="tl tl-quiet text-sm mt-1" onClick={onRetry}>Avaliar de novo</button>}
      {suggestions && <p className="mt-2">{suggestions}</p>}
    </article>
  )
}

function squares(uci: string): { from: Square; to: Square } {
  return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square }
}

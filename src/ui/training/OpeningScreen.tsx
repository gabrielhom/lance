import { Chess } from 'chess.js'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Color, Drill, DrillOutcome, Fen, LineProgress, OpeningTree, Square, Uci, Variation } from '../../domain/types'
import {
  DRILL_START,
  drillHint,
  drillNames,
  drillOutcome,
  drillTurn,
  familyStudy,
  requeueStep,
  stepDrill,
  stepFor,
  studyQueue,
  type DrillEvent,
  type DrillState,
  type DrillTurn,
  type FamilyStudy,
  type LineState,
  type Pass,
  type StudyLine,
  type StudyStep,
} from '../../openings'
import { playPosition } from '../../play'
import { colorLabel, moveNumberLabel } from '../format'
import { useMoveEntry } from '../play/MoveInput'
import { PlayBoard } from '../play/PlayBoard'
import { href } from '../router'
import { San } from '../san'
import { useServices } from '../services'
import { useMediaQuery } from '../useMediaQuery'

type Loaded = { readonly tree: OpeningTree; readonly progress: readonly LineProgress[]; readonly now: number }
/** A run over steps taken when it starts; a learned or missed line comes back once at the end through `requeueStep`. */
type Session = { readonly steps: readonly StudyStep[]; readonly at: number }

const DAY = 86_400_000
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** One family studied with one color: its variations with their state, and the session that drills them. */
export function OpeningScreen({ family: name, color }: { family: string; color: Color }) {
  const services = useServices()
  // Read with the time it was read, so what is due stays put between renders.
  const [loaded, setLoaded] = useState<Loaded | 'failed' | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const load = () => {
    Promise.all([services.openings.tree(), services.openings.progress()]).then(
      ([tree, progress]) => setLoaded({ tree, progress, now: Date.now() }),
      () => setLoaded('failed'),
    )
  }
  useEffect(load, [services])

  if (loaded === null) return <p className="caption" aria-busy="true">Abrindo as aberturas…</p>
  if (loaded === 'failed') {
    return (
      <Trouble title={name} text="Não deu para abrir as aberturas. Na primeira vez elas precisam de internet.">
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
      </Trouble>
    )
  }
  const family = loaded.tree.family(name)
  if (!family) {
    return (
      <Trouble title={name} text="Nenhuma abertura com esse nome na base.">
        <a href={href({ name: 'openings' })} className="btn mt-6">Ver as aberturas</a>
      </Trouble>
    )
  }
  const study = familyStudy(family, color, loaded.progress, loaded.now)
  const step = session?.steps[session.at]
  if (!session || !step) return <Overview study={study} now={loaded.now} onStart={(steps) => setSession({ steps, at: 0 })} />
  return (
    <DrillView
      key={`${step.variation.line.id}@${session.at}`}
      tree={loaded.tree}
      step={step}
      color={color}
      position={`${session.at + 1} de ${session.steps.length}`}
      onDone={async (outcome) => {
        setSession((s) => s && { ...s, steps: requeueStep(s.steps, s.at, outcome) })
        await services.openings.record(color, step.variation.line.id, outcome, Date.now())
        const progress = await services.openings.progress()
        setLoaded((l) => (l && l !== 'failed' ? { ...l, progress, now: Date.now() } : l))
      }}
      onNext={() => setSession((s) => s && { ...s, at: s.at + 1 })}
    />
  )
}

function Trouble({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <div className="max-w-lg">
      <a href={href({ name: 'openings' })} className="tl tl-quiet text-sm">Aberturas</a>
      <h1 className="display text-3xl md:text-5xl mt-2">{title}</h1>
      <p className="text-ink-2 mt-3" role="alert">{text}</p>
      {children}
    </div>
  )
}

type OverviewProps = { study: FamilyStudy; now: number; onStart: (steps: readonly StudyStep[]) => void }

/** The due and new lines when there are any, else every line as practice, which leaves the schedule alone. */
function sessionFor(lines: readonly StudyLine[]): readonly StudyStep[] {
  const queue = studyQueue(lines)
  return queue.length ? queue : lines.map(stepFor)
}

function Overview({ study: { family, color, lines, groups, learned, due }, now, onStart }: OverviewProps) {
  const queue = studyQueue(lines)
  return (
    <div>
      <a href={href({ name: 'openings' })} className="tl tl-quiet text-sm">Aberturas</a>
      <h1 className="display text-3xl md:text-5xl mt-2">{family.name}</h1>
      <nav aria-label="Cor" className="modes mt-4">
        {(['w', 'b'] as const).map((c) => (
          <a key={c} href={href({ name: 'opening', family: family.name, color: c })} className="choice" aria-current={c === color ? 'page' : undefined}>
            {c === 'w' ? 'Brancas' : 'Pretas'}
          </a>
        ))}
      </nav>
      <p className="dek" role="status">
        {family.eco} · {learned} de {plural(lines.length, 'variação aprendida', 'variações aprendidas')}
        {due > 0 && ` · ${due} para revisar hoje`}
      </p>
      {lines.length === 0 ? (
        <p className="text-ink-2 mt-6">Esta abertura não tem lance das {colorLabel(color)} para estudar.</p>
      ) : (
        <>
          <button type="button" className="btn mt-6" onClick={() => onStart(sessionFor(lines))}>{queue.length ? 'Estudar' : 'Treinar mesmo assim'}</button>
          {queue.length === 0 && <p className="caption mt-3">Tudo aprendido e nada para hoje. Treinar antes da hora não muda quando cada variação volta.</p>}
        </>
      )}
      {groups.map((g) => {
        const title = g.name ?? family.name
        return (
          <details key={title} className="advanced mt-8" open={g.lines.some((l) => l.state.kind === 'due')}>
            <summary className="sec">
              {title} <span className="font-sans text-sm font-normal text-ink-2">· {plural(g.lines.length, 'variação', 'variações')}</span>
            </summary>
            {g.lines.length > 1 && <button type="button" className="tl tl-quiet text-sm" onClick={() => onStart(sessionFor(g.lines))}>Estudar só estas</button>}
            <ul className="rows mt-2" aria-label={title}>
              {g.lines.map((l) => <Line key={l.variation.line.id} line={l} fallback={title} now={now} onDrill={() => onStart([stepFor(l)])} />)}
            </ul>
          </details>
        )
      })}
    </div>
  )
}

function Line({ line: { variation, state }, fallback, now, onDrill }: { line: StudyLine; fallback: string; now: number; onDrill: () => void }) {
  const { path, distinctFrom, line } = variation
  return (
    <li className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1" data-line={line.id}>
      <span className="font-semibold">{path.slice(1).join(', ') || fallback}</span>
      {distinctFrom !== null && <span className="caption text-ink-2"><Tail sans={line.sans} from={distinctFrom} /></span>}
      <Badge state={state} now={now} />
      <button type="button" className="tl tl-quiet text-sm ml-auto" onClick={onDrill}>Treinar</button>
    </li>
  )
}

/** The moves that tell a line from the others with its name. */
function Tail({ sans, from }: { sans: readonly string[]; from: number }) {
  return sans.slice(from).map((san, i) => {
    const ply = from + i
    return (
      <span key={ply} className="mr-1">
        {(ply % 2 === 0 || i === 0) && moveNumberLabel(ply)}
        <San san={san} />
      </span>
    )
  })
}

function Badge({ state, now }: { state: LineState; now: number }) {
  if (state.kind === 'new') return <span className="verdict">Nova</span>
  if (state.kind === 'due') return <span className="verdict verdict-strong">Para hoje</span>
  const days = Math.ceil((state.due - now) / DAY)
  return <span className="verdict">{days <= 1 ? 'Volta amanhã' : `Volta em ${days} dias`}</span>
}

type DrillProps = {
  tree: OpeningTree
  step: StudyStep
  color: Color
  position: string
  onDone: (outcome: DrillOutcome) => Promise<void>
  onNext: () => void
}

/** How long the opponent's move waits, so the player sees the position change. The first one waits longer. */
const SETUP_MS = 700
const REPLY_MS = 450

const PASS_LABEL: Readonly<Record<Pass, string>> = { learn: 'Variação nova', review: 'Revisão', practice: 'Treino extra', again: 'Outra tentativa' }
const PASS_NOTE: Readonly<Record<Pass, string | null>> = {
  learn: 'Variação nova: o lance dela aparece como seta.',
  review: null,
  practice: 'Treino extra: esta variação só volta para a agenda no dia marcado.',
  again: 'Outra tentativa. A agenda não muda com ela.',
}

function DrillView({ tree, step, color, position, onDone, onNext }: DrillProps) {
  const drill = useMemo(() => tree.drill(step.variation, color, step.pass === 'learn'), [tree, step, color])
  const [state, setState] = useState<DrillState>(DRILL_START)
  const [error, setError] = useState<string | null>(null)
  const { line } = drill.variation
  const turn = drillTurn(drill, state)
  const outcome = drillOutcome(drill, state)
  const advance = (event: DrillEvent) => setState((s) => stepDrill(drill, s, event))

  useEffect(() => {
    if (turn !== 'theirs') return
    const t = setTimeout(() => setState((s) => stepDrill(drill, s, { kind: 'reply' })), state.ply === 0 ? SETUP_MS : REPLY_MS)
    return () => clearTimeout(t)
  }, [drill, turn, state.ply])

  // Whichever move ends the line, mine or the opponent's reply, the outcome is saved once.
  const saved = useRef(false)
  useEffect(() => {
    if (!outcome || saved.current) return
    saved.current = true
    onDone(outcome).catch(() => setError('Não deu para salvar o progresso neste navegador.'))
  }, [outcome, onDone])

  const board = useMemo(() => playPosition(line.moves.slice(0, state.ply)), [line, state.ply])
  const hint = drillHint(drill, state)
  const entry = useMoveEntry({ fen: board.fen, disabled: turn !== 'mine', placeholder: 'seu lance', onMove: (uci) => advance({ kind: 'move', uci: uci as Uci }) })

  const next = useRef<HTMLButtonElement>(null)
  const finePointer = useMediaQuery('(pointer: fine)')
  useEffect(() => {
    if (turn === 'done') next.current?.focus()
    // On a phone the field would open the keyboard over the board, so it takes focus only with a mouse or trackpad.
    else if (turn === 'mine' && finePointer) document.getElementById('lance-digitado')?.focus()
  }, [turn, finePointer])

  const names = drillNames(drill, state).map((o) => shortName(o.name, line.family))
  return (
    <div className="play">
      <div className="min-w-0">
        <PlayBoard position={board} orientation={color} interactive={turn === 'mine'} onMove={(uci) => advance({ kind: 'move', uci: uci as Uci })} arrow={hint ? squares(hint) : null} />
      </div>
      <div className="min-w-0 play-side">
        <h1 className="display text-2xl md:text-4xl">{line.family}</h1>
        <p className="dek">{variationTitle(drill.variation)} · de {colorLabel(color)}</p>
        <section className="annot mt-6" aria-labelledby="abertura-onde" data-line={line.id} data-turn={turn} data-hint={hint ?? ''}>
          <p id="abertura-onde" className="where">{PASS_LABEL[step.pass]}<span className="sep mx-1.5">·</span>{position}</p>
          <p className="caption mt-1" aria-label="Posições com nome">{names.length ? names.join(' › ') : 'Posição inicial'}</p>
          {turn === 'done' && outcome ? (
            <Finished outcome={outcome} pass={step.pass} />
          ) : (
            <>
              <p className="best"><Prompt drill={drill} state={state} turn={turn} fen={board.fen} /></p>
              <div className="mt-4 max-w-48">{entry.field}</div>
              {entry.error}
              <p className="caption">Arraste ou toque numa peça, ou digite o lance.</p>
              {PASS_NOTE[step.pass] && <p className="caption mt-3">{PASS_NOTE[step.pass]}</p>}
            </>
          )}
          {error && <p className="mt-2 text-sm" role="alert">{error}</p>}
        </section>
        {turn === 'done' && (
          <div className="mt-6">
            <button ref={next} type="button" className="btn" onClick={onNext}>Próxima</button>
          </div>
        )}
      </div>
    </div>
  )
}

/** What to do now, or what the last move that did not advance the line was. */
function Prompt({ drill, state: { feedback, ply }, turn, fen }: { drill: Drill; state: DrillState; turn: DrillTurn; fen: Fen }) {
  const { line } = drill.variation
  if (feedback) {
    const yours = <>{moveNumberLabel(ply)}<San san={sanOf(fen, feedback.move)} /></>
    if (feedback.kind === 'variation') {
      return <>{yours} é teoria, {feedback.book.opening.name}. Não é a variação que você está estudando: tente outro lance.</>
    }
    return (
      <>
        Não é esse: {yours}{feedback.book && <> é {feedback.book.opening.name}</>}. O lance da variação é {moveNumberLabel(ply)}<San san={line.sans[ply]} />. Jogue-o para continuar.
      </>
    )
  }
  if (turn === 'theirs') return ply === 0 ? `As ${colorLabel(drill.color === 'w' ? 'b' : 'w')} jogam…` : 'Certo.'
  return drill.learn ? 'Jogue o lance da seta.' : ply === 0 ? 'Jogue o primeiro lance da variação.' : 'Qual é o lance da variação?'
}

const FINISHED: Readonly<Record<Pass, Readonly<Partial<Record<DrillOutcome, string>>>>> = {
  learn: { learned: 'Ela volta mais uma vez no fim desta sessão, e amanhã, de memória.' },
  review: { clean: 'A próxima revisão fica mais longe.', missed: 'Ela volta mais uma vez no fim desta sessão, e amanhã.' },
  practice: { clean: 'Treino extra: a agenda não muda.', missed: 'Ela volta mais uma vez no fim desta sessão. A agenda não muda.' },
  again: { clean: 'A agenda não muda com a outra tentativa.', missed: 'A agenda não muda com a outra tentativa.' },
}

function Finished({ outcome, pass }: { outcome: DrillOutcome; pass: Pass }) {
  return (
    <div role="status">
      <div className="move">
        <span className="cls" style={{ color: outcome === 'missed' ? 'var(--c-blunder)' : 'var(--c-best)' }}>
          {outcome === 'learned' ? 'Aprendida' : outcome === 'clean' ? 'Sem erro' : 'Com erro'}
        </span>
      </div>
      <p className="best">{FINISHED[pass][outcome]}</p>
    </div>
  )
}

function variationTitle({ path, line }: Variation): string {
  return path.length ? path.join(', ') : line.name
}

/** 'Sicilian Defense: Najdorf Variation' reads as 'Najdorf Variation' along a Sicilian line. */
function shortName(name: string, family: string): string {
  return name.startsWith(`${family}: `) ? name.slice(family.length + 2) : name
}

/** The move is one the board or the move field already played against `fen`, so it is legal. */
function sanOf(fen: Fen, uci: Uci): string {
  return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined }).san
}

function squares(uci: string): { from: Square; to: Square } {
  return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square }
}

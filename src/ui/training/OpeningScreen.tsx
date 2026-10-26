import { Chess } from 'chess.js'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import type { Color, Drill, DrillOutcome, Fen, LineProgress, OpeningLine, OpeningTree, Square, Uci, Variation } from '../../domain/types'
import {
  DRILL_START,
  drillHint,
  drillNames,
  drillOutcome,
  drillTurn,
  familyStudy,
  groupsOf,
  requeueStep,
  startsWith,
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
  type VariationGroup,
} from '../../openings'
import { playPosition } from '../../play'
import { colorLabel, moveNumberLabel } from '../format'
import { useMoveEntry } from '../play/MoveInput'
import { PlayBoard } from '../play/PlayBoard'
import { MiniBoard, PieceSprite } from '../MiniBoard'
import { openingName } from '../openingNames'
import { href } from '../router'
import { Moves, San } from '../san'
import { useServices } from '../services'
import { useMediaQuery } from '../useMediaQuery'
import { saveStudyColor } from './studyColor'

type Loaded = { readonly tree: OpeningTree; readonly progress: readonly LineProgress[]; readonly now: number }
/** A run over steps taken when it starts; a learned or missed line comes back once at the end through `requeueStep`. */
type Session = { readonly steps: readonly StudyStep[]; readonly at: number }

const DAY = 86_400_000
const LIST = new Intl.ListFormat('pt-BR', { type: 'conjunction' })
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** One family studied with one color: its variations with their state, and the session that drills them. `group` is a
 *  group of variations to open first, the system the weaknesses report links from. */
export function OpeningScreen({ family: name, color, group }: { family: string; color: Color; group?: string }) {
  const services = useServices()
  // Read with the time it was read, so what is due stays put between renders.
  const [loaded, setLoaded] = useState<Loaded | 'failed' | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [view, setView] = useState<View>({ filter: null, more: false })
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
  if (!session || !step) return <Overview study={study} group={group} now={loaded.now} view={view} onView={setView} onStart={(steps) => setSession({ steps, at: 0 })} />
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
      <h1 className="display text-3xl md:text-5xl mt-2">{openingName(title)}</h1>
      <p className="text-ink-2 mt-3" role="alert">{text}</p>
      {children}
    </div>
  )
}

type Filter = 'main' | 'all'
/** What the overview shows, kept across a session so the list is where it was when the session ends. `filter` is null
 *  until the player picks one. */
type View = { readonly filter: Filter | null; readonly more: boolean }
type OverviewProps = { study: FamilyStudy; group?: string; now: number; view: View; onView: (view: View) => void; onStart: (steps: readonly StudyStep[]) => void }

/** The main lines are the list a family opens on once there are this many of them. */
const MIN_MAIN = 8
/** Groups shown before the button that shows the rest. */
const GROUPS = 6

/** The due and new lines when there are any, else every line as practice, which leaves the schedule alone. */
function sessionFor(lines: readonly StudyLine[]): readonly StudyStep[] {
  const queue = studyQueue(lines)
  return queue.length ? queue : lines.map(stepFor)
}

function Overview({ study: { family, color, lines, main, learned, due }, group, now, view, onView, onStart }: OverviewProps) {
  const name = openingName(family.name)
  const filtered = main.length > 0 && main.length < lines.length
  const linkedElsewhere = group !== undefined && !main.some((l) => l.variation.path[0] === group)
  const filter: Filter = !filtered ? 'all' : (view.filter ?? (linkedElsewhere || main.length < MIN_MAIN ? 'all' : 'main'))
  const shown = filter === 'main' ? main : lines
  const groups = groupsOf(shown)
  const more = view.more || groups.slice(GROUPS).some((g) => g.name === group)
  // The linked group can be below the fold on a family with many systems, and the shell has just scrolled to the top.
  const linked = useRef<HTMLElement>(null)
  useEffect(() => {
    linked.current?.scrollIntoView()
  }, [group])
  return (
    <div>
      <PieceSprite />
      <a href={href({ name: 'openings' })} className="tl tl-quiet text-sm">Aberturas</a>
      <div className="ohead">
        <MiniBoard moves={family.trunk.moves} orientation={color} />
        <div className="min-w-0">
          <h1 className="display text-3xl md:text-5xl">{name}</h1>
          <p className="ohead-sub">{name === family.name ? family.eco : `${family.name} · ${family.eco}`}</p>
          <p className="ohead-moves"><Moves sans={family.trunk.sans} /></p>
        </div>
        <div className="ohead-side">
          <nav aria-label="Cor" className="seg">
            <div className="seg-options">
              {(['w', 'b'] as const).map((c) => (
                <a key={c} href={href({ name: 'opening', family: family.name, color: c, group })} aria-current={c === color ? 'page' : undefined} onClick={() => saveStudyColor(c)}>
                  {c === 'w' ? 'Brancas' : 'Pretas'}
                </a>
              ))}
            </div>
          </nav>
          {lines.length > 0 && (
            <div className="ohead-progress">
              <div className="meter" aria-hidden><span style={{ width: `${(learned / lines.length) * 100}%` }} /></div>
              <p className="learned mt-1.5" role="status">
                {learned} de {plural(lines.length, 'variação aprendida', 'variações aprendidas')}
                {due > 0 && <span className="learned-due"> · {due} para hoje</span>}
              </p>
            </div>
          )}
        </div>
      </div>
      {lines.length === 0 ? (
        <p className="text-ink-2 mt-8">Esta abertura não tem lance das {colorLabel(color)} para estudar.</p>
      ) : (
        <>
          <NextStep family={name} shown={shown} lines={lines} main={filter === 'main'} onStart={onStart} onAll={() => onView({ ...view, filter: 'all' })} />
          <div className="vhead">
            <h2 className="sec">Variações</h2>
            {filtered && (
              <fieldset className="seg">
                <legend className="sr-only">Mostrar</legend>
                <div className="seg-options seg-small">
                  {(['main', 'all'] as const).map((f) => (
                    <label key={f}>
                      <input type="radio" name="variacoes" className="sr-only" checked={filter === f} onChange={() => onView({ filter: f, more: false })} />
                      {f === 'main' ? 'Principais' : 'Todas'}
                      <span className="seg-note">{f === 'main' ? main.length : lines.length}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
          <p className="caption mt-2 max-w-2xl">
            {filter === 'main'
              ? 'As principais têm ao menos 1% das partidas de jogadores fortes nesta abertura. As que você já estuda ficam sempre aqui.'
              : 'Em cada grupo, das mais jogadas por jogadores fortes às raras.'}
          </p>
          {(more ? groups : groups.slice(0, GROUPS)).map((g) => (
            <Group key={g.name} group={g} title={g.name ?? name} trunk={family.trunk} now={now} onStart={onStart} ref={g.name === group ? linked : undefined} />
          ))}
          {!more && groups.length > GROUPS && (
            <button type="button" className="tl tl-accent mt-6" onClick={() => onView({ ...view, more: true })}>
              Mostrar mais {plural(groups.length - GROUPS, 'grupo', 'grupos')}
            </button>
          )}
        </>
      )}
    </div>
  )
}

/** The one thing to do now: review what is due and learn the next new lines, or practice when nothing is left. */
function NextStep({ family, shown, lines, main, onStart, onAll }: { family: string; shown: readonly StudyLine[]; lines: readonly StudyLine[]; main: boolean; onStart: (steps: readonly StudyStep[]) => void; onAll: () => void }) {
  const queue = studyQueue(shown)
  const reviews = queue.filter((s) => s.pass === 'review').length
  const fresh = queue.filter((s) => s.pass === 'learn')
  const groups = [...new Set(fresh.map((s) => s.variation.path[0] ?? family))]
  const elsewhere = main ? lines.filter((l) => l.state.kind === 'new').length - shown.filter((l) => l.state.kind === 'new').length : 0
  const nouns = (n: number) => plural(n, 'variação', 'variações')
  const [title, button] =
    reviews && fresh.length
      ? [`Revisar ${nouns(reviews)} de hoje e aprender ${fresh.length === 1 ? '1 nova' : `${fresh.length} novas`}`, 'Começar']
      : reviews
        ? [`Revisar ${nouns(reviews)} de hoje`, 'Revisar']
        : fresh.length
          ? [fresh.length === 1 ? `Aprender a próxima variação${main ? ' principal' : ''}` : `Aprender as próximas ${fresh.length} variações${main ? ' principais' : ''}`, 'Aprender']
          : [main ? 'As principais estão aprendidas e nada é para hoje' : 'Tudo aprendido e nada para hoje', 'Treinar mesmo assim']
  return (
    <section className="next" aria-labelledby="proximo-passo">
      <h2 id="proximo-passo" className="next-title">{title}</h2>
      <p className="next-detail">
        {fresh.length > 0
          ? `${fresh.length === 1 ? 'A nova é' : 'As novas são'} ${groups.length === 1 ? 'do grupo' : 'dos grupos'} ${LIST.format(groups)}, com uma seta em cada lance seu.`
          : queue.length === 0
            ? 'Treinar antes da hora não muda quando cada variação volta.'
            : 'Sem seta, de memória. Uma variação com erro volta amanhã.'}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <button type="button" className="btn" onClick={() => onStart(sessionFor(shown))}>{button}</button>
        {queue.length === 0 && elsewhere > 0 && (
          <button type="button" className="tl tl-accent" onClick={onAll}>Ver as outras {nouns(elsewhere)} novas</button>
        )}
      </div>
    </section>
  )
}

type GroupProps = { group: VariationGroup; title: string; trunk: OpeningLine; now: number; onStart: (steps: readonly StudyStep[]) => void; ref?: Ref<HTMLElement> }

/** A group of variations under the moves they share, each row with the moves that are its own. */
function Group({ group: { lines, shared }, title, trunk, now, onStart, ref }: GroupProps) {
  const id = useId()
  const first = lines[0].variation.line
  const afterTrunk = (line: OpeningLine) => (startsWith(line.moves, trunk.moves) && line.moves.length > trunk.moves.length ? trunk.moves.length : 0)
  const head = lines.length > 1 ? afterTrunk(first) : shared
  const learned = lines.filter((l) => l.state.kind !== 'new').length
  return (
    <section ref={ref} className="vgroup" aria-labelledby={id}>
      <div className="vgroup-head">
        <h3 id={id} className="vgroup-name">{title}</h3>
        <span className="vgroup-count">{learned ? `${learned} de ${lines.length} aprendidas` : plural(lines.length, 'variação', 'variações')}</span>
        {lines.length > 1 && <button type="button" className="tl tl-quiet text-sm ml-auto" onClick={() => onStart(sessionFor(lines))}>Estudar só estas</button>}
      </div>
      {head < shared && <p className="vgroup-moves"><Moves sans={first.sans} from={head} to={shared} /></p>}
      <ul className="vrows" aria-label={title}>
        {lines.map((l) => {
          const { line } = l.variation
          const from = Math.max(afterTrunk(line), lines.length > 1 && startsWith(line.moves, first.moves, shared) ? shared : 0)
          return <Line key={line.id} line={l} from={from} now={now} onDrill={() => onStart([stepFor(l)])} />
        })}
      </ul>
    </section>
  )
}

function Line({ line: { variation, state }, from, now, onDrill }: { line: StudyLine; from: number; now: number; onDrill: () => void }) {
  const { path, line } = variation
  return (
    <li className="vrow" data-line={line.id}>
      <p className="min-w-0">
        <span className="vrow-moves"><Moves sans={line.sans} from={from} /></span>
        {path.length > 1 && <span className="vrow-name">{path.slice(1).join(', ')}</span>}
      </p>
      <Badge state={state} now={now} />
      <button type="button" className="tl tl-quiet text-sm" onClick={onDrill}>Treinar</button>
    </li>
  )
}

function Badge({ state, now }: { state: LineState; now: number }) {
  if (state.kind === 'new') return null
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
        <h1 className="display text-2xl md:text-4xl">{openingName(line.family)}</h1>
        <p className="dek">{variationTitle(drill.variation)} · de {colorLabel(color)}</p>
        <section className="annot mt-6" aria-labelledby="abertura-onde" data-line={line.id} data-turn={turn} data-hint={hint ?? ''}>
          <p id="abertura-onde" className="where">{PASS_LABEL[step.pass]}<span className="sep mx-1.5">·</span>{position}</p>
          <p className="caption mt-1" aria-label="Posições com nome">{names.length ? names.join(' › ') : 'Posição inicial'}</p>
          {outcome ? (
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
        {outcome && (
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

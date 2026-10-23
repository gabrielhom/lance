import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Color, EngineInput, PlayEvent, PlayState, TimeControl, Uci } from '../../domain/types'
import { EngineFailure } from '../../engine'
import { clockRunning, levelById, newPlay, playPosition, reducePlay, turnOf } from '../../play'
import type { PlayPosition } from '../../play'
import { colorLabel, joinKnown } from '../format'
import { engineFailureText } from '../labels'
import { useServices, useSettings } from '../services'
import { ConfirmDialog } from './ConfirmDialog'
import { GameOver } from './GameOver'
import { useMoveEntry } from './MoveInput'
import { Scoresheet } from '../Scoresheet'
import { San } from '../san'
import { seats } from './names'
import { resultTitle } from './result'
import { PlayBoard } from './PlayBoard'
import { PlayerBar } from './PlayerBar'
import type { ClockProps } from './PlayerBar'
import { playSound, setMuted, unlockAudio, useMuted } from './sound'

type SetPlay = Dispatch<SetStateAction<PlayState | null>>
type Failure = { readonly moves: PlayState['moves']; readonly error: unknown }

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w')
const timeLabel = (t: TimeControl) => (t.kind === 'none' ? 'sem relógio' : `${t.initialMs / 60_000}+${t.incrementMs / 1000}`)

/** Asks the engine for a move whenever it is its turn. Any change to the game (a takeback, a resignation, a new game) aborts the search. */
function useEngineReply(state: PlayState, input: EngineInput, setPlay: SetPlay) {
  const services = useServices()
  const [failure, setFailure] = useState<Failure | null>(null)
  const [attempt, setAttempt] = useState(0)
  const level = state.setup.opponent.kind === 'engine' ? levelById(state.setup.opponent.levelId) : null
  const engineToMove = state.phase === 'playing' && level !== null && turnOf(state) !== state.setup.you
  useEffect(() => {
    if (!engineToMove || !level) return
    const ac = new AbortController()
    services.engineMove(input, level, ac.signal).then(
      (uci) => {
        if (ac.signal.aborted) return
        const next = reducePlay(state, { kind: 'move', uci, at: Date.now() })
        if (next === state) setFailure({ moves: state.moves, error: new Error(`a engine respondeu um lance ilegal: ${uci}`) })
        else setPlay((s) => (s === state ? next : s))
      },
      (error: unknown) => {
        if (!ac.signal.aborted) setFailure({ moves: state.moves, error })
      },
    )
    return () => ac.abort()
  }, [services, state, input, level, engineToMove, attempt, setPlay])
  const failed = failure && failure.moves === state.moves ? failure.error : null
  return {
    thinking: engineToMove && !failed,
    failed,
    retry: () => {
      setFailure(null)
      setAttempt((a) => a + 1)
    },
  }
}

/** Plays the sound for what just happened, and stays quiet for a game restored on load. */
function useMoveSounds(state: PlayState, position: PlayPosition) {
  const seen = useRef({ id: state.id, moves: state.moves.length, phase: state.phase })
  useEffect(() => {
    const before = seen.current
    seen.current = { id: state.id, moves: state.moves.length, phase: state.phase }
    if (before.id !== state.id) return
    const san = position.sans.at(-1)
    if (state.moves.length === before.moves + 1 && san) playSound(san.includes('x') ? 'capture' : san.includes('+') ? 'check' : 'move')
    if (state.phase === 'over' && before.phase === 'playing') playSound('end')
  }, [state, position])
}

function failureText(error: unknown): { title: string; detail: string } {
  if (error instanceof EngineFailure) return engineFailureText(error.reason)
  return { title: 'A engine não respondeu', detail: error instanceof Error ? error.message : String(error) }
}

export function GameView({ state, setPlay, onNew }: { state: PlayState; setPlay: SetPlay; onNew: () => void }) {
  const [settings] = useSettings()
  const position = useMemo(() => playPosition(state.moves), [state.moves])
  const engine = useEngineReply(state, position.input, setPlay)
  useMoveSounds(state, position)
  const muted = useMuted()
  const [flipped, setFlipped] = useState(false)
  const [confirm, setConfirm] = useState<'resign' | 'new' | null>(null)

  const { setup } = state
  const vsEngine = setup.opponent.kind === 'engine'
  const seat = useMemo(() => seats(setup, settings.identity), [setup, settings.identity])
  const bottom: Color = flipped ? other(setup.you) : setup.you
  const playing = state.phase === 'playing'
  const myTurn = playing && (!vsEngine || position.turn === setup.you)
  const mine = setup.you === 'w' ? 0 : 1
  const canTakeBack = vsEngine && playing && state.moves.some((_, i) => i % 2 === mine)
  const resigner: Color = vsEngine ? setup.you : position.turn

  const dispatch = (e: PlayEvent) => setPlay((s) => (s ? reducePlay(s, e) : s))
  const move = (uci: string) => dispatch({ kind: 'move', uci: uci as Uci, at: Date.now() })

  const clock = (c: Color): ClockProps | null =>
    state.clocks && {
      baseMs: state.clocks[c],
      since: clockRunning(state) && state.phase === 'playing' && position.turn === c ? state.turnStartedAt : null,
      onFlag: () => dispatch({ kind: 'flag', at: Date.now() }),
      warn: !seat[c].engine,
    }
  const lead = (c: Color) => position.material[c] - position.material[other(c)]
  const status = (c: Color) => {
    if (seat[c].engine && engine.thinking) {
      return (
        <span className="text-accent font-medium">
          pensando<span className="thinking-dots" aria-hidden />
        </span>
      )
    }
    if (seat[c].detail) return seat[c].detail
    if (!playing || position.turn !== c) return null
    return vsEngine ? 'Sua vez' : `Vez das ${colorLabel(c)}`
  }
  const bar = (c: Color) => <PlayerBar seat={seat[c]} color={c} toMove={playing && position.turn === c} status={status(c)} lead={lead(c)} clock={clock(c)} />
  const lastSan = position.sans.at(-1)
  const entryAt = vsEngine && !myTurn ? position.sans.length + 1 : position.sans.length
  const entry = useMoveEntry({ fen: position.fen, disabled: !myTurn, placeholder: vsEngine ? 'seu lance' : 'lance', onMove: move })
  const failure = engine.failed === null ? null : failureText(engine.failed)

  return (
    <div className="-mx-4 -mt-3 sm:mx-0 sm:mt-0 lg:grid lg:grid-cols-[auto_minmax(320px,380px)] lg:gap-6 lg:justify-center lg:items-start" onPointerDown={unlockAudio}>
      <div className="flex flex-col w-full max-w-[calc(100dvh-250px)] mx-auto lg:mx-0 lg:max-w-none lg:w-[min(760px,calc(100dvh-210px))]">
        {bar(other(bottom))}
        <PlayBoard position={position} orientation={bottom} interactive={myTurn} onMove={move} />
        {bar(bottom)}
      </div>
      <aside className="flex flex-col gap-3 px-4 sm:px-0 mt-2 lg:mt-0 min-w-0">
        <header className="sr-only lg:not-sr-only lg:h-12 lg:flex lg:flex-col lg:justify-center">
          <h1 className="text-[18px] font-semibold leading-tight">{vsEngine ? `Contra ${seat[other(setup.you)].name}` : 'Dois jogadores'}</h1>
          <p className="text-[13px] text-ink-3">{joinKnown(vsEngine ? seat[other(setup.you)].detail : 'neste aparelho', timeLabel(setup.time))}</p>
        </header>
        {state.phase === 'over' && <GameOver state={state} seats={seat} onNew={onNew} onRematch={() => setPlay(newPlay({ ...setup, you: other(setup.you) }, Date.now()))} />}
        {failure && (
          <div role="alert" className="flex gap-2 items-start">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[14px]">{failure.title}</p>
              <p className="text-[13px] text-ink-2">{failure.detail}</p>
              <button type="button" className="btn btn-sm btn-primary mt-2" onClick={engine.retry}>Tentar de novo</button>
            </div>
          </div>
        )}
        {playing && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Ações da partida">
            {vsEngine && (
              <button type="button" className="btn btn-ghost" onClick={() => dispatch({ kind: 'takeback', at: Date.now() })} disabled={!canTakeBack}>
                Desfazer
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm('resign')}>
              Abandonar
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => (state.moves.length > 0 ? setConfirm('new') : onNew())}>
              Nova partida
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setFlipped((f) => !f)} aria-pressed={flipped}>
              Girar
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setMuted(!muted)} aria-pressed={!muted} aria-label="Som">
              <span aria-hidden>{muted ? 'Sem som' : 'Som'}</span>
            </button>
          </div>
        )}
        <Scoresheet
          label="Lances da partida"
          count={position.sans.length}
          move={(i) => <span className="mv" aria-current={i === position.sans.length - 1 ? 'true' : undefined}><San san={position.sans[i]} /></span>}
          extra={playing ? { [entryAt]: entry.field, ...(entryAt > position.sans.length ? { [position.sans.length]: <span className="waiting" aria-hidden>…</span> } : null) } : undefined}
          focus={playing ? entryAt : position.sans.length - 1}
          minRows={10}
        />
        {playing && entry.error}
        <p className="sr-only" aria-live="polite">
          {lastSan ? `${state.moves.length % 2 === 1 ? 'Brancas' : 'Pretas'} jogaram ${lastSan}.` : ''}
          {engine.thinking ? ' Stockfish está pensando.' : ''}
          {state.phase === 'over' ? ` ${resultTitle(state, vsEngine ? setup.you : null).title}.` : ''}
        </p>
      </aside>
      <ConfirmDialog
        open={confirm === 'resign'}
        title="Abandonar a partida?"
        body={vsEngine ? 'A partida termina como derrota sua.' : `As ${colorLabel(resigner)} perdem a partida.`}
        confirm="Abandonar"
        onConfirm={() => dispatch({ kind: 'resign', by: resigner, at: Date.now() })}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'new'}
        title="Começar outra partida?"
        body="Esta partida será descartada e não entra no histórico."
        confirm="Descartar e começar"
        onConfirm={onNew}
        onClose={() => setConfirm(null)}
      />
    </div>
  )
}

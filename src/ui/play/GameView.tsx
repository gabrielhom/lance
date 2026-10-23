import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Color, EngineInput, PlayEvent, PlayState, Uci } from '../../domain/types'
import { EngineFailure } from '../../engine'
import { clockRunning, levelById, newPlay, playPosition, reducePlay, turnOf } from '../../play'
import type { PlayPosition } from '../../play'
import { colorLabel, formatClock } from '../format'
import { engineFailureText } from '../labels'
import { useServices, useSettings } from '../services'
import { ConfirmDialog } from './ConfirmDialog'
import { GameOver } from './GameOver'
import { useMoveEntry } from './MoveInput'
import { Scoresheet } from '../Scoresheet'
import { San } from '../san'
import { levelLabel, seats } from './names'
import { resultTitle } from './result'
import { PlayBoard } from './PlayBoard'
import { PlayerBar } from './PlayerBar'
import type { ClockProps } from './PlayerBar'
import { playSound, setMuted, unlockAudio, useMuted } from './sound'

type SetPlay = Dispatch<SetStateAction<PlayState | null>>
type Failure = { readonly moves: PlayState['moves']; readonly error: unknown }

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w')

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
  const level = setup.opponent.kind === 'engine' ? levelById(setup.opponent.levelId) : null
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
    if (seat[c].engine && engine.thinking) return <span className="text-ink-2">pensando<span className="thinking-dots" aria-hidden /></span>
    if (!playing || position.turn !== c || seat[c].engine) return null
    return vsEngine ? 'sua vez' : `vez das ${colorLabel(c)}`
  }
  const bar = (c: Color, edge: 'top' | 'bottom') => <PlayerBar seat={seat[c]} color={c} status={status(c)} lead={lead(c)} clock={clock(c)} edge={edge} />
  const lastSan = position.sans.at(-1)
  const count = position.sans.length
  const entryAt = vsEngine && !myTurn ? count + 1 : count
  const entry = useMoveEntry({ fen: position.fen, disabled: !myTurn, placeholder: vsEngine ? 'seu lance' : `lance das ${colorLabel(position.turn)}`, onMove: move })
  const failure = engine.failed === null ? null : failureText(engine.failed)
  const board = <PlayBoard position={position} orientation={bottom} interactive={myTurn} onMove={move} />

  return (
    <div onPointerDown={unlockAudio}>
      {state.phase === 'over' ? (
        <GameOver state={state} seats={seat} sans={position.sans} board={board} onNew={onNew} onRematch={() => setPlay(newPlay({ ...setup, you: other(setup.you) }, Date.now()))} />
      ) : (
        <div className="play">
          <div className="min-w-0">
            {bar(other(bottom), 'top')}
            {board}
            {bar(bottom, 'bottom')}
          </div>
          <div className="min-w-0">
            <h1 className="display text-2xl md:text-4xl">{seat.w.name} – {seat.b.name}</h1>
            <p className="dek">{level ? levelLabel(level) : 'Neste aparelho'}<span className="sep">·</span>{formatClock(setup.time)}</p>
            {failure && (
              <div role="alert" className="note">
                <p className="font-semibold">{failure.title}</p>
                <p className="text-ink-2">{failure.detail}</p>
                <button type="button" className="tl" onClick={engine.retry}>Tentar de novo</button>
              </div>
            )}
            <Scoresheet
              label="Lances da partida"
              className="play-sheet"
              count={count}
              move={(i) => <span className="mv" aria-current={i === count - 1 ? 'true' : undefined}><San san={position.sans[i]} /></span>}
              extra={{ [entryAt]: entry.field, ...(entryAt > count ? { [count]: <span className="waiting" aria-hidden>…</span> } : null) }}
              focus={entryAt}
              minRows={10}
            />
            {entry.error}
            <div className="actions" role="group" aria-label="Ações da partida">
              <div className="grp">
                {vsEngine && (
                  <button type="button" className="tl" onClick={() => dispatch({ kind: 'takeback', at: Date.now() })} disabled={!canTakeBack}>
                    Desfazer
                  </button>
                )}
                <button type="button" className="tl tl-danger" onClick={() => setConfirm('resign')}>Abandonar</button>
                <button type="button" className="tl" onClick={() => (state.moves.length > 0 ? setConfirm('new') : onNew())}>Nova partida</button>
              </div>
              <div className="grp">
                <button type="button" className="tl tl-quiet" onClick={() => setFlipped((f) => !f)} aria-pressed={flipped}>Girar tabuleiro</button>
                <button type="button" className="tl tl-quiet" onClick={() => setMuted(!muted)} aria-pressed={!muted}>
                  Som<span aria-hidden>{muted ? ' desligado' : ' ligado'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {lastSan ? `${state.moves.length % 2 === 1 ? 'Brancas' : 'Pretas'} jogaram ${lastSan}.` : ''}
        {engine.thinking ? ' Stockfish está pensando.' : ''}
        {state.phase === 'over' ? ` ${resultTitle(state, vsEngine ? setup.you : null).title}.` : ''}
      </p>
      <ConfirmDialog
        open={confirm === 'resign'}
        title="Abandonar a partida?"
        body={vsEngine ? 'A partida termina como derrota sua.' : `As ${colorLabel(resigner)} perdem a partida.`}
        confirm="Abandonar"
        danger
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

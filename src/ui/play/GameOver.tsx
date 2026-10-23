import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { gameFromPgn } from '../../domain'
import type { ByColor, Color, Game, GameResult, PlayState, San as SanText } from '../../domain/types'
import { levelById, toPgn } from '../../play'
import { formatClock, moveNumberLabel } from '../format'
import { engineFailureText } from '../labels'
import { holdGame } from '../pending'
import { navigate } from '../router'
import { San } from '../san'
import { useSettings } from '../services'
import { CopyPgn } from '../CopyPgn'
import { Accuracies, ClassTables } from '../review/Summary'
import { useReview } from '../review/useReview'
import type { Seat } from './names'
import { levelLabel, pgnNames } from './names'
import { resultTitle } from './result'

type Over = Extract<PlayState, { phase: 'over' }>
type Props = { state: Over; seats: ByColor<Seat>; sans: readonly SanText[]; board: ReactNode; onNew: () => void; onRematch: () => void }

const KICKER: Readonly<Record<GameResult, string>> = { '1-0': 'Brancas vencem, 1–0', '0-1': 'Pretas vencem, 0–1', '1/2-1/2': 'Empate, ½–½', '*': 'Partida em aberto' }

export function GameOver({ state, seats, sans, board, onNew, onRematch }: Props) {
  const [settings] = useSettings()
  const you = state.setup.opponent.kind === 'engine' ? state.setup.you : null
  const pgn = useMemo(() => toPgn(state, pgnNames(state.setup, settings.identity)), [state, settings.identity])
  const game = useMemo(() => {
    const r = gameFromPgn(pgn, { kind: 'played', id: state.id, you: state.setup.you })
    return r.ok ? r.value : null
  }, [pgn, state.id, state.setup.you])
  const { title, detail } = resultTitle(state, you)
  const level = state.setup.opponent.kind === 'engine' ? levelById(state.setup.opponent.levelId) : null
  const moves = Math.ceil(state.moves.length / 2)
  const where = level ? `contra Stockfish no nível ${levelLabel(level)}` : 'neste aparelho'
  const open = (ply = 0) => {
    if (!game) return
    holdGame(game, ply)
    navigate({ name: 'review', id: game.id })
  }

  // The result replaces the board at the top; a phone scrolled down to the board would land past it.
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [])

  const last = sans.length - 1
  return (
    <div className="over">
      <figure className="over-board">
        {board}
        {last >= 0 && (
          <figcaption className="caption board-caption">
            Posição final, depois de {moveNumberLabel(last)}<San san={sans[last]} />
          </figcaption>
        )}
      </figure>
      <section ref={ref} aria-labelledby="fim-titulo" className="min-w-0 scroll-mt-4">
        <p className="kicker">{KICKER[state.result]}</p>
        <h1 id="fim-titulo" className="display text-4xl md:text-6xl mt-1.5 mb-3.5 max-w-[12em]">{title}</h1>
        <p className="text-ink-2">
          {detail ? `${detail} ` : ''}Em {moves} {moves === 1 ? 'lance' : 'lances'}, {where}, {formatClock(state.setup.time)}.
        </p>
        {game ? <Reviewed game={game} me={you} seats={seats} onJump={open} /> : <p className="mt-6 italic font-serif text-ink-2">Sem lances, nada para revisar.</p>}
        <div className="over-actions">
          <button type="button" className="btn" onClick={() => open()} disabled={!game}>Ver revisão completa</button>
          <button type="button" className="tl" onClick={onRematch}>Revanche</button>
          <button type="button" className="tl" onClick={onNew}>Nova partida</button>
          <CopyPgn pgn={pgn} />
        </div>
      </section>
    </div>
  )
}

/** The finished game is reviewed right away, so the accuracy is there before the player decides what to do next. */
function Reviewed({ game, me, seats, onJump }: { game: Game; me: Color | null; seats: ByColor<Seat>; onJump: (ply: number) => void }) {
  const { run, restart } = useReview(game)
  const state = run.state
  const review = state?.phase === 'done' ? state.review : null
  if (review) {
    return (
      <>
        <Accuracies review={review} me={me} names={{ w: seats.w.name, b: seats.b.name }} size="hero" />
        <h2 className="sec">{me ? 'Seus lances' : 'Lances'}</h2>
        <ClassTables review={review} columns={me ? [me] : ['w', 'b']} heads={me ? null : { w: seats.w.name, b: seats.b.name }} onJump={onJump} />
      </>
    )
  }
  if (state?.phase === 'failed') {
    const t = engineFailureText(state.failure)
    return (
      <div role="alert" className="note mt-7">
        <p className="font-semibold">{t.title}</p>
        <p className="text-ink-2">{t.detail}</p>
        <button type="button" className="tl" onClick={restart}>Tentar de novo</button>
      </div>
    )
  }
  const pct = state?.phase === 'analyzing' ? Math.round(Math.min(1, Math.max(0, state.progress)) * 100) : 0
  return (
    <div className="acc acc-hero">
      <div className="col-span-3">
        <p className="flex items-baseline justify-between gap-4 font-serif italic text-ink-2">
          {me ? 'Calculando sua precisão' : 'Calculando a precisão'}
          <span className="num not-italic text-2xl text-ink">{pct}%</span>
        </p>
        <div className="meter mt-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progresso da análise">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}

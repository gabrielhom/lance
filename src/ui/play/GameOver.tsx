import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { gameFromPgn } from '../../domain'
import type { ByColor, Color, Game, GameReview, PlayState } from '../../domain/types'
import { toPgn } from '../../play'
import { formatPct } from '../format'
import { engineFailureText } from '../labels'
import { holdGame } from '../pending'
import { navigate } from '../router'
import { useSettings } from '../services'
import { Summary } from '../review/Summary'
import { useReview } from '../review/useReview'
import type { Seat } from './names'
import { pgnNames } from './names'
import { resultTitle } from './result'

type Over = Extract<PlayState, { phase: 'over' }>
type Props = { state: Over; seats: ByColor<Seat>; onNew: () => void; onRematch: () => void }

export function GameOver({ state, seats, onNew, onRematch }: Props) {
  const [settings] = useSettings()
  const you = state.setup.opponent.kind === 'engine' ? state.setup.you : null
  const pgn = useMemo(() => toPgn(state, pgnNames(state.setup, settings.identity)), [state, settings.identity])
  const game = useMemo(() => {
    const r = gameFromPgn(pgn, { kind: 'played', id: state.id, you: state.setup.you })
    return r.ok ? r.value : null
  }, [pgn, state.id, state.setup.you])
  const { title, detail } = resultTitle(state, you)
  const opponent = you ? seats[you === 'w' ? 'b' : 'w'] : null
  const open = (ply = 0) => {
    if (!game) return
    holdGame(game, ply)
    navigate({ name: 'review', id: game.id })
  }

  // On a phone the panel starts below the board, so bring the result and the accuracy into view.
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && el.getBoundingClientRect().bottom > window.innerHeight) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [])

  const head = (
    <div>
      <div className="min-w-0">
        <h2 id="fim-titulo" className="text-[18px] font-semibold leading-tight">{title}</h2>
        <p className="text-[13px] text-ink-3 mt-0.5">
          {detail ?? (opponent ? `contra ${opponent.name}${opponent.detail ? ` · ${opponent.detail}` : ''}` : 'partida local')} · {Math.ceil(state.moves.length / 2)} lances
        </p>
      </div>
    </div>
  )
  const actions = (
    <div className="grid grid-cols-2 gap-2">
      <button type="button" className="btn btn-primary col-span-2 min-h-11" onClick={() => open()} disabled={!game}>
        Ver revisão completa
      </button>
      <button type="button" className="btn" onClick={onRematch}>
        Revanche
      </button>
      <button type="button" className="btn" onClick={onNew}>
        Nova partida
      </button>
      <CopyPgn pgn={pgn} />
    </div>
  )
  const card = (body: ReactNode) => (
    <section ref={ref} className="flex flex-col gap-3" aria-labelledby="fim-titulo">
      {head}
      {body}
      {actions}
    </section>
  )
  if (!game) return card(<p className="hint">Sem lances, nada para revisar.</p>)
  return <Reviewed game={game} me={you} seats={seats} card={card} onJump={open} />
}

/** The finished game is reviewed right away, so the accuracy is there before the player decides what to do next. */
function Reviewed({ game, me, seats, card, onJump }: { game: Game; me: Color | null; seats: ByColor<Seat>; card: (body: ReactNode) => ReactNode; onJump: (ply: number) => void }) {
  const { run, restart } = useReview(game)
  const state = run.state
  const review = state?.phase === 'done' ? state.review : null
  let body: ReactNode
  if (review) body = <Accuracies review={review} me={me} seats={seats} />
  else if (state?.phase === 'failed') {
    const t = engineFailureText(state.failure)
    body = (
      <div role="alert" className="flex gap-2 rounded-lg bg-bad-soft p-3 text-[14px]">
        <div>
          <p className="font-semibold">{t.title}</p>
          <p className="text-ink-2 mt-0.5">{t.detail}</p>
          <button type="button" className="btn btn-sm mt-2" onClick={restart}>Tentar de novo</button>
        </div>
      </div>
    )
  } else {
    const pct = state?.phase === 'analyzing' ? Math.round(Math.min(1, Math.max(0, state.progress)) * 100) : 0
    body = (
      <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3">
        <div className="flex items-center gap-2 text-[14px] font-medium">
          {me ? 'Calculando sua precisão' : 'Calculando a precisão'}
          <span className="ml-auto tabular">{pct}%</span>
        </div>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progresso da análise">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }
  return (
    <>
      {card(body)}
      {review && <Summary review={review} me={me} onJump={onJump} title="Classificação" variant="counts" />}
    </>
  )
}

function Accuracies({ review, me, seats }: { review: GameReview; me: Color | null; seats: ByColor<Seat> }) {
  const order: readonly Color[] = me === 'b' ? ['b', 'w'] : ['w', 'b']
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Precisão">
      {order.map((c) => {
        const mine = me === c
        return (
          <div key={c} className={`rounded-lg px-3 py-2.5 ${mine ? 'bg-accent-soft' : 'bg-surface-2'}`}>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-3 truncate">{mine ? 'Sua precisão' : seats[c].name}</p>
            <p className={`text-[28px] leading-tight font-semibold tabular ${mine ? 'text-accent' : ''}`}>{formatPct(review.players[c].accuracy)}</p>
          </div>
        )
      })}
    </div>
  )
}

function CopyPgn({ pgn }: { pgn: string }) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  useEffect(() => {
    if (copied === 'idle') return
    const t = setTimeout(() => setCopied('idle'), 2500)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <button
      type="button"
      className="btn btn-ghost col-span-2"
      onClick={() => (navigator.clipboard?.writeText(pgn) ?? Promise.reject(new Error('sem área de transferência'))).then(() => setCopied('done'), () => setCopied('failed'))}
    >
      <span aria-live="polite">{copied === 'done' ? 'PGN copiado' : copied === 'failed' ? 'Não deu para copiar' : 'Copiar PGN'}</span>
    </button>
  )
}

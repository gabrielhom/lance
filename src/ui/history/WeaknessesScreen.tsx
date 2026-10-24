import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { MIN_MOVES_OUTSIDE_THEORY, PHASES, type GameId, type Phase, type TrainingItem } from '../../domain/types'
import { INSIGHTS, weaknesses, type OpeningStats, type PhaseStats, type Weaknesses } from '../../review'
import { colorLabel, formatAccuracy } from '../format'
import { PHASE_LABEL } from '../labels'
import { href } from '../router'
import { useServices, useSettings } from '../services'
import { ErrorsChart } from './ErrorsChart'
import { useLibrary } from './useLibrary'

const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
const percent = (x: number) => `${Math.round(x * 100)}%`
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const PHASE_NOUN: Readonly<Record<Phase, string>> = { opening: 'a abertura', middlegame: 'o meio de jogo', endgame: 'o final' }
const PHASE_IN: Readonly<Record<Phase, string>> = { opening: 'na abertura', middlegame: 'no meio de jogo', endgame: 'no final' }

/** What to say and where to go for one finding. */
type Action = { readonly label: string; readonly href: string }

export function WeaknessesScreen() {
  const services = useServices()
  const [settings] = useSettings()
  const { records } = useLibrary()
  const [items, setItems] = useState<readonly TrainingItem[]>([])
  useEffect(() => {
    let alive = true
    services.training.list().then((l) => alive && setItems(l))
    return () => {
      alive = false
    }
  }, [services, records])
  const report = useMemo(() => (records ? weaknesses(records, settings.identity) : null), [records, settings])
  const positions = useMemo(() => {
    const perGame = new Map<GameId, number>()
    for (const i of items) perGame.set(i.gameId, (perGame.get(i.gameId) ?? 0) + 1)
    return (games: readonly GameId[]) => games.reduce((n, g) => n + (perGame.get(g) ?? 0), 0)
  }, [items])

  /** Train the games' positions when they have any, else open the newest of them. */
  const trainOrReview = (games: readonly GameId[], what: string, review: string): Action => {
    const n = positions(games)
    return n > 0
      ? { label: `Treinar ${n === 1 ? 'a posição' : `as ${n} posições`} ${what}`, href: href({ name: 'training', games }) }
      : { label: review, href: href({ name: 'review', id: games[0] }) }
  }
  const openingAction = (o: OpeningStats) => trainOrReview(o.games, 'dessas partidas', o.games.length === 1 ? 'Revisar a partida' : 'Revisar a última partida')
  const phaseAction = (p: Phase, s: PhaseStats): Action | null => {
    if (!s.worst) return null
    return {
      label: `Rever ${PHASE_NOUN[p]} contra ${s.worst.opponent}, precisão ${formatAccuracy(s.worst.accuracy)}`,
      href: href({ name: 'review', id: s.worst.gameId, ply: s.worst.ply }),
    }
  }

  return (
    <div className="flex flex-col gap-10 md:gap-12">
      <div>
        <a href={href({ name: 'history' })} className="tl tl-quiet text-sm">Histórico</a>
        <h1 className="display text-3xl md:text-5xl mt-2">Seus pontos fracos</h1>
        {report && report.games > 0 && (
          <p className="dek">
            Tirado de {plural(report.games, 'partida sua revisada', 'partidas suas revisadas')}.
            {report.shortGames > 0 && ` ${plural(report.shortGames, 'partida curta ficou', 'partidas curtas ficaram')} de fora: menos de ${MIN_MOVES_OUTSIDE_THEORY} lances fora da teoria.`}
          </p>
        )}
      </div>
      {report === null ? (
        <p className="caption" aria-busy="true">Carregando…</p>
      ) : report.games === 0 ? (
        <div>
          <p className="font-semibold">Nenhuma partida sua com lances suficientes foi revisada ainda.</p>
          <p className="text-ink-2 mt-1">Jogue ou revise algumas partidas e volte aqui para ver onde você perde pontos.</p>
        </div>
      ) : (
        <>
          <Leads report={report} openingAction={openingAction} phaseAction={phaseAction} lossesAction={report.errors.lossesWithBlunder.length ? trainOrReview(report.errors.lossesWithBlunder, 'dessas derrotas', 'Revisar a última dessas derrotas') : null} />
          <Openings report={report} action={openingAction} />
          <Phases report={report} action={phaseAction} />
          <Errors report={report} />
        </>
      )}
    </div>
  )
}

type LeadsProps = {
  report: Weaknesses
  openingAction: (o: OpeningStats) => Action
  phaseAction: (p: Phase, s: PhaseStats) => Action | null
  lossesAction: Action | null
}

/** The findings worth acting on first, each with one thing to do. */
function Leads({ report, openingAction, phaseAction, lossesAction }: LeadsProps) {
  const { openings, phases, errors } = report
  const leads: { key: string; text: ReactNode; action: Action | null }[] = []
  for (const o of openings.groups.filter((g) => g.verdict === 'weak').slice(0, 2)) {
    leads.push({ key: `${o.name}|${o.color}`, text: <>{openingTitle(o)}: {openingLine(o)}.</>, action: openingAction(o) })
  }
  if (phases.weakest) {
    const weakest = phases.weakest
    const best = PHASES.filter((p) => p !== weakest && phases.byPhase[p].games >= INSIGHTS.minPhaseGames).reduce((a, b) => (phases.byPhase[b].percentile! > phases.byPhase[a].percentile! ? b : a))
    leads.push({
      key: 'phase',
      text: (
        <>
          <strong>{PHASE_LABEL[weakest]}</strong> é sua fase mais fraca: nela suas partidas ficam à frente de {Math.round(phases.byPhase[weakest].percentile!)}% dos jogadores do Lichess, contra{' '}
          {Math.round(phases.byPhase[best].percentile!)}% {PHASE_IN[best]}.
        </>
      ),
      action: phaseAction(weakest, phases.byPhase[weakest]),
    })
  }
  if (errors.lossesWithBlunder.length > 0) {
    leads.push({
      key: 'losses',
      text: (
        <>
          <strong>{plural(errors.lossesWithBlunder.length, 'derrota', 'derrotas')}</strong> de {errors.losses} {errors.lossesWithBlunder.length === 1 ? 'teve' : 'tiveram'} ao menos um blunder seu.
        </>
      ),
      action: lossesAction,
    })
  }
  return (
    <section aria-labelledby="leads-titulo">
      <h2 id="leads-titulo" className="sec">Por onde começar</h2>
      <div className="ruled">
        {leads.length === 0 ? (
          <p className="text-ink-2 py-2">
            Poucos jogos ainda para apontar um ponto fraco. Uma abertura precisa de {INSIGHTS.minOpeningGames} partidas suas com a mesma cor, e as fases de {INSIGHTS.minPhaseGames} partidas.
          </p>
        ) : (
          <ol className="rows">
            {leads.map((l) => (
              <li key={l.key} className="py-3">
                <p>{l.text}</p>
                {l.action && <a href={l.action.href} className="tl tl-accent inline-block mt-1">{l.action.label}</a>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}

function openingTitle(o: OpeningStats): ReactNode {
  return <><strong>{o.name}</strong> de {colorLabel(o.color)}</>
}

function openingLine(o: OpeningStats): string {
  const parts = [o.score === null ? null : `${percent(o.score)} dos pontos em ${plural(o.games.length, 'partida', 'partidas')}`, `precisão ${formatAccuracy(o.accuracy)}`]
  if (o.bookExit.worse > 0) parts.push(`já pior ao sair da teoria em ${o.bookExit.worse} de ${o.bookExit.known}`)
  return parts.filter((p) => p !== null).join(', ')
}

function Openings({ report, action }: { report: Weaknesses; action: (o: OpeningStats) => Action }) {
  const { groups, unnamed } = report.openings
  return (
    <section aria-labelledby="aberturas-titulo">
      <h2 id="aberturas-titulo" className="sec">Aberturas</h2>
      <div className="ruled">
        <ul className="rows" aria-label="Aberturas">
          {groups.map((o) => {
            const a = action(o)
            return (
              <li key={`${o.name}|${o.color}`} className="py-3">
                <p className="row-title">
                  <span>{o.name}</span>
                  <span className="outcome">de {colorLabel(o.color)}</span>
                  <Verdict verdict={o.verdict === 'weak' ? 'Ponto fraco' : o.verdict === 'few' ? 'Poucos jogos ainda' : null} strong={o.verdict === 'weak'} />
                </p>
                <p className="row-meta">
                  {[
                    `${plural(o.games.length, 'partida', 'partidas')} · ${o.eco}`,
                    o.score === null ? null : `${percent(o.score)} dos pontos`,
                    `precisão ${formatAccuracy(o.accuracy)}`,
                    o.bookExit.known > 0 ? `pior ao sair da teoria em ${o.bookExit.worse} de ${o.bookExit.known}` : null,
                  ].filter((p) => p !== null).join(' · ')}
                </p>
                <a href={a.href} className="tl tl-accent inline-block mt-1 text-sm">{a.label}</a>
              </li>
            )
          })}
        </ul>
        <p className="caption mt-3">
          Ponto fraco: {Math.round(INSIGHTS.weakScore * 100)}% dos pontos ou menos, ou precisão {INSIGHTS.weakAccuracyGap} pontos abaixo da sua média, com {INSIGHTS.minOpeningGames} partidas ou mais.
          {' '}Pior ao sair da teoria: com menos de {INSIGHTS.worseAtBookExit}% de chance de vitória, cerca de um peão a menos.
          {unnamed > 0 && ` ${plural(unnamed, 'partida sem abertura conhecida ficou', 'partidas sem abertura conhecida ficaram')} de fora.`}
        </p>
      </div>
    </section>
  )
}

function Verdict({ verdict, strong }: { verdict: string | null; strong: boolean }) {
  if (!verdict) return null
  return <span className={strong ? 'verdict verdict-strong' : 'verdict'}>{verdict}</span>
}

function Phases({ report, action }: { report: Weaknesses; action: (p: Phase, s: PhaseStats) => Action | null }) {
  const { byPhase, weakest, withoutPhases, withoutPhaseErrors } = report.phases
  return (
    <section aria-labelledby="fases-titulo">
      <h2 id="fases-titulo" className="sec">Fases</h2>
      <div className="ruled">
        <ul className="rows" aria-label="Fases">
          {PHASES.map((p) => {
            const s = byPhase[p]
            const a = action(p, s)
            const errors = s.errors && s.errors.perGame.mistake + s.errors.perGame.blunder + s.errors.perGame.miss
            return (
              <li key={p} className="py-3">
                <p className="row-title">
                  <span>{PHASE_LABEL[p]}</span>
                  <Verdict verdict={p === weakest ? 'Mais fraca' : s.games > 0 && s.games < INSIGHTS.minPhaseGames ? 'Poucos jogos ainda' : null} strong={p === weakest} />
                </p>
                <p className="row-meta">
                  {s.games === 0
                    ? 'Nenhuma partida sua com lances suficientes nesta fase.'
                    : [
                        `${plural(s.games, 'partida', 'partidas')} · precisão ${formatAccuracy(s.accuracy)}`,
                        `à frente de ${Math.round(s.percentile!)}% dos jogadores do Lichess`,
                        s.trend ? `últimas ${INSIGHTS.window}: ${formatAccuracy(s.trend.recent)}, antes ${formatAccuracy(s.trend.previous)}` : null,
                        errors === null ? null : `${decimal.format(errors)} erros por partida, ${decimal.format(s.errors!.perGame.blunder)} blunders`,
                      ].filter((x) => x !== null).join(' · ')}
                </p>
                {a && <a href={a.href} className="tl tl-accent inline-block mt-1 text-sm">{a.label}</a>}
              </li>
            )
          })}
        </ul>
        <p className="caption mt-3">
          A precisão de cada fase cai e sobe por natureza: a abertura costuma ser a mais alta. Por isso a mais fraca é a que fica pior entre os jogadores do Lichess, e não a de menor precisão.
          {withoutPhases > 0 && ` ${plural(withoutPhases, 'partida revisada antes das fases ficou', 'partidas revisadas antes das fases ficaram')} de fora.`}
          {withoutPhaseErrors > withoutPhases && ` Os erros por fase contam só as partidas revisadas a partir desta versão.`}
          {withoutPhaseErrors > 0 && ' Abrir a revisão de uma partida antiga atualiza os dados dela.'}
        </p>
      </div>
    </section>
  )
}

function Errors({ report }: { report: Weaknesses }) {
  const { points, trend, withBlunder, losses, lossesWithBlunder } = report.errors
  const last = points[points.length - 1]
  return (
    <section aria-labelledby="erros-titulo">
      <h2 id="erros-titulo" className="sec">Erros por partida</h2>
      <div className="stats">
        <Stat label={points.length < INSIGHTS.window ? 'Média por partida' : `Média das últimas ${INSIGHTS.window}`} value={decimal.format(last.rolling)} />
        <Stat label={trend ? `Nas ${INSIGHTS.window} anteriores` : 'Tendência'} value={trend ? decimal.format(trend.previous) : '–'} />
        <Stat label="Partidas com blunder" value={`${withBlunder} de ${points.length}`} />
        <Stat label="Derrotas com blunder" value={`${lossesWithBlunder.length} de ${losses}`} />
      </div>
      <div className="mt-6">
        <ErrorsChart points={points} />
        <p className="caption mt-3">
          Erros somam erros, blunders e chances perdidas. A linha é a média das últimas {INSIGHTS.window} partidas.
          {!trend && ` A tendência aparece com ${2 * INSIGHTS.window} partidas.`}
        </p>
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="v">{value}</p>
      <p className="l">{label}</p>
    </div>
  )
}

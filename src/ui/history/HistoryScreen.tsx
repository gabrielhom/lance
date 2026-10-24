import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { MIN_MOVES_OUTSIDE_THEORY, PHASES, type AccuracyHistory, type LibraryRecord } from '../../domain/types'
import { formatAccuracy } from '../format'
import { PHASE_LABEL } from '../labels'
import { LibraryList } from '../import/GameList'
import { finishedReviews, subscribeReviews } from '../review/runs'
import { useServices, useSettings } from '../services'
import { AccuracyChart } from './AccuracyChart'

const EMPTY: AccuracyHistory = {
  points: [],
  shortGames: 0,
  phases: { opening: { accuracy: null, games: 0 }, middlegame: { accuracy: null, games: 0 }, endgame: { accuracy: null, games: 0 } },
}

export function HistoryScreen() {
  const services = useServices()
  const [settings] = useSettings()
  const [records, setRecords] = useState<readonly LibraryRecord[] | null>(null)
  const [unreadable, setUnreadable] = useState(0)
  // A game played just before keeps being reviewed in the background and lands in the library when it finishes.
  const finished = useSyncExternalStore(subscribeReviews, finishedReviews)
  useEffect(() => {
    let alive = true
    services.library.list().then((l) => alive && setRecords(l))
    services.library.unreadable().then((n) => alive && setUnreadable(n))
    return () => {
      alive = false
    }
  }, [services, finished])
  const { points, shortGames, phases }: AccuracyHistory = useMemo(() => (records ? services.accuracyHistory(records, settings.identity) : EMPTY), [services, records, settings])
  const elo = useMemo(() => new Map(points.flatMap((p) => (p.elo ? [[p.gameId, p.elo] as const] : []))), [points])
  const avg = points.length ? points.reduce((s, p) => s + p.accuracy, 0) / points.length : null
  const wins = points.filter((p) => (p.result === '1-0') === (p.color === 'w') && p.result !== '1/2-1/2' && p.result !== '*').length
  const draws = points.filter((p) => p.result === '1/2-1/2').length
  const losses = points.length - wins - draws
  const noIdentity = settings.identity.accounts.length === 0

  return (
    <div className="flex flex-col gap-10 md:gap-12">
      <div className="flex flex-col gap-6">
        <h1 className="display text-3xl md:text-5xl">Histórico</h1>
        {noIdentity && (
          <p className="text-ink-2">
            As partidas jogadas aqui já contam. Para contar as importadas, informe seus nomes de usuário em{' '}
            <a href="#/config" className="tl text-ink">Configurações</a>.
          </p>
        )}
        {unreadable > 0 && (
          <p className="font-semibold" role="status">
            {unreadable === 1 ? '1 partida salva não pôde ser lida' : `${unreadable} partidas salvas não puderam ser lidas`} por esta versão do app.
            Exportar a biblioteca em <a href="#/config" className="tl">Configurações</a> guarda uma cópia.
          </p>
        )}
      </div>
      <section className="stats" aria-label="Resumo">
        <Stat label="Precisão média" value={avg === null ? '–' : formatAccuracy(avg)} />
        <Stat label="Partidas revisadas" value={records ? String(records.length) : '–'} />
        <Stat label="Suas partidas" value={records ? String(points.length) : '–'} />
        <Stat label="Vitórias, empates, derrotas" value={records ? `${wins} · ${draws} · ${losses}` : '–'} />
      </section>
      {points.length > 0 && (
        <section aria-labelledby="fases-titulo">
          <h2 id="fases-titulo" className="sec">Precisão média por fase</h2>
          <div className="stats">
            {PHASES.map((p) => (
              <Stat key={p} label={`${PHASE_LABEL[p]}, ${phases[p].games === 1 ? '1 partida' : `${phases[p].games} partidas`}`} value={formatAccuracy(phases[p].accuracy)} />
            ))}
          </div>
        </section>
      )}
      <section aria-labelledby="grafico-titulo">
        <h2 id="grafico-titulo" className="sec">Precisão ao longo do tempo</h2>
        <div className="ruled">
          {records === null ? (
            <p className="caption" aria-busy="true">Carregando…</p>
          ) : points.length === 0 ? (
            <p className="caption py-6">{shortGames > 0 ? 'Nenhuma partida sua com lances suficientes foi revisada ainda.' : 'Nenhuma partida sua foi revisada ainda.'}</p>
          ) : (
            <AccuracyChart points={points} />
          )}
          {records !== null && shortGames > 0 && (
            <p className="caption mt-3" data-testid="short-games">
              {shortGames === 1 ? '1 partida curta ficou de fora' : `${shortGames} partidas curtas ficaram de fora`}: menos de {MIN_MOVES_OUTSIDE_THEORY} lances fora da teoria.
            </p>
          )}
        </div>
      </section>
      <section aria-labelledby="lista-titulo">
        <h2 id="lista-titulo" className="sec">Partidas</h2>
        <div className="ruled">
          <LibraryList records={records} identity={settings.identity} elo={elo} />
        </div>
      </section>
    </div>
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

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { AccuracyPoint, LibraryRecord } from '../../domain/types'
import { formatAccuracy } from '../format'
import { LibraryList } from '../import/GameList'
import { finishedReviews, subscribeReviews } from '../review/runs'
import { useServices, useSettings } from '../services'
import { AccuracyChart } from './AccuracyChart'

export function HistoryScreen() {
  const services = useServices()
  const [settings] = useSettings()
  const [records, setRecords] = useState<readonly LibraryRecord[] | null>(null)
  // A game played just before keeps being reviewed in the background and lands in the library when it finishes.
  const finished = useSyncExternalStore(subscribeReviews, finishedReviews)
  useEffect(() => {
    let alive = true
    services.library.list().then((l) => alive && setRecords(l))
    return () => {
      alive = false
    }
  }, [services, finished])
  const points: readonly AccuracyPoint[] = useMemo(() => (records ? services.accuracyHistory(records, settings.identity) : []), [services, records, settings])
  const avg = points.length ? points.reduce((s, p) => s + p.accuracy, 0) / points.length : null
  const wins = points.filter((p) => (p.result === '1-0') === (p.color === 'w') && p.result !== '1/2-1/2' && p.result !== '*').length
  const draws = points.filter((p) => p.result === '1/2-1/2').length
  const losses = points.length - wins - draws
  const noIdentity = settings.identity.accounts.length === 0

  return (
    <div className="flex flex-col gap-10 md:gap-12">
      <h1 className="display text-3xl md:text-5xl">Histórico</h1>
      {noIdentity && (
        <p className="-mt-4 md:-mt-6 text-ink-2">
          As partidas jogadas aqui já contam. Para contar as importadas, informe seus nomes de usuário em{' '}
          <a href="#/config" className="tl text-ink">Configurações</a>.
        </p>
      )}
      <section className="stats" aria-label="Resumo">
        <Stat label="Precisão média" value={avg === null ? '–' : formatAccuracy(avg)} />
        <Stat label="Partidas revisadas" value={records ? String(records.length) : '–'} />
        <Stat label="Suas partidas" value={records ? String(points.length) : '–'} />
        <Stat label="Vitórias, empates, derrotas" value={records ? `${wins} · ${draws} · ${losses}` : '–'} />
      </section>
      <section aria-labelledby="grafico-titulo">
        <h2 id="grafico-titulo" className="sec">Precisão ao longo do tempo</h2>
        <div className="ruled">
          {records === null ? (
            <p className="caption" aria-busy="true">Carregando…</p>
          ) : points.length === 0 ? (
            <p className="caption py-6">Nenhuma partida sua foi revisada ainda.</p>
          ) : (
            <AccuracyChart points={points} />
          )}
        </div>
      </section>
      <section aria-labelledby="lista-titulo">
        <h2 id="lista-titulo" className="sec">Partidas</h2>
        <div className="ruled">
          <LibraryList records={records} identity={settings.identity} />
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

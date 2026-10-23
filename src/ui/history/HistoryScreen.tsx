import { useEffect, useMemo, useState } from 'react'
import type { AccuracyPoint, LibraryRecord } from '../../domain/types'
import { formatPct } from '../format'
import { LibraryList } from '../import/GameList'
import { useServices, useSettings } from '../services'
import { AccuracyChart } from './AccuracyChart'

export function HistoryScreen() {
  const services = useServices()
  const [settings] = useSettings()
  const [records, setRecords] = useState<readonly LibraryRecord[] | null>(null)
  useEffect(() => {
    let alive = true
    services.library.list().then((l) => alive && setRecords(l))
    return () => {
      alive = false
    }
  }, [services])
  const points: readonly AccuracyPoint[] = useMemo(() => (records ? services.accuracyHistory(records, settings.identity) : []), [services, records, settings])
  const avg = points.length ? points.reduce((s, p) => s + p.accuracy, 0) / points.length : null
  const wins = points.filter((p) => (p.result === '1-0') === (p.color === 'w') && p.result !== '1/2-1/2' && p.result !== '*').length
  const draws = points.filter((p) => p.result === '1/2-1/2').length
  const losses = points.length - wins - draws
  const noIdentity = settings.identity.accounts.length === 0

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">Histórico</h1>
        <p className="hint">Sua precisão nas partidas revisadas, da mais antiga para a mais recente.</p>
      </header>
      {noIdentity && (
        <div className="card p-4 flex flex-wrap items-center gap-3 justify-between">
          <p className="text-[14px]">Informe seus nomes de usuário para o histórico saber quais lances são seus.</p>
          <a href="#/config" className="btn btn-sm">Configurações</a>
        </div>
      )}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3" aria-label="Resumo">
        <Stat label="Precisão média" value={avg === null ? '–' : formatPct(avg)} />
        <Stat label="Partidas revisadas" value={records ? String(records.length) : '–'} />
        <Stat label="Suas partidas" value={records ? String(points.length) : '–'} />
        <Stat label="V · E · D" value={records ? `${wins} · ${draws} · ${losses}` : '–'} />
      </section>
      <section className="card p-4" aria-labelledby="grafico-titulo">
        <h2 id="grafico-titulo" className="text-[16px] font-semibold mb-3">Precisão ao longo do tempo</h2>
        {records === null ? (
          <div className="skeleton h-[200px]" aria-busy="true" />
        ) : points.length === 0 ? (
          <p className="hint py-8 text-center">Nenhuma partida sua foi revisada ainda.</p>
        ) : (
          <AccuracyChart points={points} />
        )}
      </section>
      <section aria-labelledby="lista-titulo">
        <h2 id="lista-titulo" className="text-[16px] font-semibold mb-3">Partidas</h2>
        <LibraryList records={records} identity={settings.identity} />
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3 sm:p-4">
      <p className="text-[12px] text-ink-3 font-medium">{label}</p>
      <p className="text-[24px] sm:text-[28px] font-semibold leading-tight mt-1 whitespace-nowrap">{value}</p>
    </div>
  )
}

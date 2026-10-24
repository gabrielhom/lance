import { useMemo } from 'react'
import { MIN_MOVES_OUTSIDE_THEORY, type AccuracyHistory, type LibraryRecord } from '../../domain/types'
import { weaknesses } from '../../review'
import { colorLabel, formatAccuracy } from '../format'
import { PHASE_LABEL } from '../labels'
import { LibraryList } from '../import/GameList'
import { href } from '../router'
import { useServices, useSettings } from '../services'
import { AccuracyChart } from './AccuracyChart'
import { useLibrary } from './useLibrary'

const EMPTY: AccuracyHistory = { points: [], shortGames: 0 }

export function HistoryScreen() {
  const services = useServices()
  const [settings] = useSettings()
  const { records, unreadable } = useLibrary()
  const { points, shortGames }: AccuracyHistory = useMemo(() => (records ? services.accuracyHistory(records, settings.identity) : EMPTY), [services, records, settings])
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
      {records && points.length > 0 && <WeaknessesTeaser records={records} />}
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

/** The report's headline, and the way to it. */
function WeaknessesTeaser({ records }: { records: readonly LibraryRecord[] }) {
  const [settings] = useSettings()
  const { openings, phases } = useMemo(() => weaknesses(records, settings.identity), [records, settings])
  const weak = openings.groups.find((g) => g.verdict === 'weak')
  const lines = [
    weak ? `Abertura mais fraca: ${weak.name} de ${colorLabel(weak.color)}.` : null,
    phases.weakest ? `Fase mais fraca: ${PHASE_LABEL[phases.weakest].toLowerCase()}.` : null,
  ].filter((l) => l !== null)
  return (
    <section aria-labelledby="pontos-titulo">
      <h2 id="pontos-titulo" className="sec">Seus pontos fracos</h2>
      <div className="ruled">
        <p>{lines.length ? lines.join(' ') : 'Aberturas, fases e erros de todas as suas partidas, cada um com o que treinar.'}</p>
        <a href={href({ name: 'weaknesses' })} className="tl tl-accent inline-block mt-1">Ver seus pontos fracos</a>
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

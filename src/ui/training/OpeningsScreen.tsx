import { useEffect, useMemo, useState } from 'react'
import type { Color, LineProgress, OpeningTree } from '../../domain/types'
import { catalog, searchCatalog, type CatalogEntry } from '../../openings'
import { weaknesses } from '../../review'
import { colorLabel } from '../format'
import { useLibrary } from '../history/useLibrary'
import { href } from '../router'
import { useServices, useSettings } from '../services'

type Loaded = { readonly tree: OpeningTree; readonly progress: readonly LineProgress[]; readonly now: number }

/** Every family of the book, the ones with a line due or that I play first, each with what is learned per color. */
export function OpeningsScreen() {
  const services = useServices()
  const [settings] = useSettings()
  const { records } = useLibrary()
  const [loaded, setLoaded] = useState<Loaded | 'failed' | null>(null)
  const [query, setQuery] = useState('')
  const load = () => {
    Promise.all([services.openings.tree(), services.openings.progress()]).then(
      ([tree, progress]) => setLoaded({ tree, progress, now: Date.now() }),
      () => setLoaded('failed'),
    )
  }
  useEffect(load, [services])
  const played = useMemo(
    () => (records ? weaknesses(records, settings.identity).openings.groups.map((g) => ({ family: g.name, color: g.color, games: g.games.length })) : []),
    [records, settings],
  )
  const entries = useMemo(() => (loaded && loaded !== 'failed' ? catalog(loaded.tree, loaded.progress, played, loaded.now) : []), [loaded, played])
  const shown = useMemo(() => searchCatalog(entries, query), [entries, query])

  if (loaded === null) return <p className="caption" aria-busy="true">Abrindo as aberturas…</p>
  if (loaded === 'failed') {
    return (
      <div className="max-w-lg">
        <h1 className="display text-3xl md:text-5xl">Aberturas</h1>
        <p className="text-ink-2 mt-3" role="alert">Não deu para abrir as aberturas. Na primeira vez elas precisam de internet.</p>
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
      </div>
    )
  }
  return (
    <div>
      <h1 className="display text-3xl md:text-5xl">Aberturas</h1>
      <p className="dek max-w-lg">
        As {entries.length} aberturas da base aberta do Lichess, agrupadas como no relatório de pontos fracos. Escolha uma e a cor para estudar cada variação dela.
      </p>
      <div className="mt-6 max-w-64">
        <label htmlFor="abertura-busca" className="label">Buscar</label>
        <input id="abertura-busca" type="search" className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Sicilian, Caro-Kann…" autoComplete="off" />
      </div>
      <div className="ruled mt-6">
        {shown.length === 0 ? (
          <p className="text-ink-2 py-2">Nenhuma abertura com esse nome.</p>
        ) : (
          <ul className="rows" aria-label="Aberturas">
            {shown.map((e) => <Entry key={e.family.name} entry={e} />)}
          </ul>
        )}
      </div>
    </div>
  )
}

function Entry({ entry: { family, colors, games } }: { entry: CatalogEntry }) {
  const line = (c: Color) => {
    const { total, learned, due } = colors[c]
    return [`${learned} de ${total}`, due > 0 ? `${due} para hoje` : null, games[c] > 0 ? `${games[c]} ${games[c] === 1 ? 'partida' : 'partidas'}` : null].filter((p) => p !== null).join(', ')
  }
  return (
    <li className="py-3">
      <p className="row-title">
        <span>{family.name}</span>
        <span className="outcome">{family.eco}</span>
      </p>
      <p className="row-meta">
        {(['w', 'b'] as const).map(
          (c) =>
            colors[c].total > 0 && (
              <span key={c} className="inline-block mr-5">
                <a href={href({ name: 'opening', family: family.name, color: c })} className="tl tl-accent" aria-label={`${family.name} de ${colorLabel(c)}`}>
                  {c === 'w' ? 'Brancas' : 'Pretas'}
                </a>{' '}
                {line(c)}
              </span>
            ),
        )}
      </p>
    </li>
  )
}

import { useEffect, useId, useMemo, useState } from 'react'
import type { Color, LineProgress, OpeningTree } from '../../domain/types'
import { catalog, searchCatalog, shelves, studyFamily, type CatalogEntry } from '../../openings'
import { weaknesses } from '../../review'
import { useLibrary } from '../history/useLibrary'
import { MiniBoard, PieceSprite } from '../MiniBoard'
import { openingName } from '../openingNames'
import { href } from '../router'
import { Moves } from '../san'
import { useServices, useSettings } from '../services'
import { readStudyColor, saveStudyColor } from './studyColor'

type Loaded = { readonly tree: OpeningTree; readonly progress: readonly LineProgress[]; readonly now: number }

/** The most played families shown before the whole list. */
const POPULAR = 12

/** The families to study with one color: the ones due today, mine, the most played, and all of them A to Z. */
export function OpeningsScreen() {
  const services = useServices()
  const [settings] = useSettings()
  const { records } = useLibrary()
  const [loaded, setLoaded] = useState<Loaded | 'failed' | null>(null)
  const [color, setColor] = useState<Color>(readStudyColor)
  const [query, setQuery] = useState('')
  const [everything, setEverything] = useState(false)
  const load = () => {
    Promise.all([services.openings.tree(), services.openings.progress()]).then(
      ([tree, progress]) => setLoaded({ tree, progress, now: Date.now() }),
      () => setLoaded('failed'),
    )
  }
  useEffect(load, [services])
  const played = useMemo(
    () => (records ? weaknesses(records, settings.identity).openings.groups.map((g) => ({ family: studyFamily(g.name), color: g.color, games: g.games.length })) : []),
    [records, settings],
  )
  const entries = useMemo(() => (loaded && loaded !== 'failed' ? catalog(loaded.tree, loaded.progress, played, loaded.now) : []), [loaded, played])
  const shelf = useMemo(() => shelves(entries, color), [entries, color])

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
  const ordered = [...shelf.due, ...shelf.mine, ...shelf.rest]
  const due = { w: 0, b: 0 }
  for (const e of entries) for (const c of ['w', 'b'] as const) due[c] += e.colors[c].due
  const searching = query.trim() !== ''
  return (
    <div>
      <PieceSprite />
      <h1 className="display text-3xl md:text-5xl">Aberturas</h1>
      <p className="dek max-w-xl">Escolha a cor e a abertura. As variações de cada uma vêm das mais jogadas às raras.</p>
      <div className="catalog-bar">
        <fieldset className="seg">
          <legend className="label">Estudar de</legend>
          <div className="seg-options">
            {(['w', 'b'] as const).map((c) => (
              <label key={c}>
                <input
                  type="radio"
                  name="abertura-cor"
                  className="sr-only"
                  checked={color === c}
                  onChange={() => {
                    setColor(c)
                    saveStudyColor(c)
                  }}
                />
                {c === 'w' ? 'Brancas' : 'Pretas'}
                {due[c] > 0 && <span className="seg-note">{due[c]} para hoje</span>}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="catalog-search">
          <label htmlFor="abertura-busca" className="label">Buscar</label>
          <input id="abertura-busca" type="search" className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Siciliana, Caro-Kann, Najdorf…" autoComplete="off" />
        </div>
      </div>
      {searching ? (
        <Shelf title="Resultado da busca" entries={searchCatalog(ordered, query, openingName)} color={color} empty="Nenhuma abertura com esse nome, em português ou em inglês." />
      ) : (
        <>
          {shelf.due.length > 0 && <Shelf title="Para revisar hoje" entries={shelf.due} color={color} />}
          {shelf.mine.length > 0 && <Shelf title="Suas aberturas" entries={shelf.mine} color={color} />}
          {shelf.rest.length > 0 && <Shelf title="Mais jogadas" entries={shelf.rest.slice(0, POPULAR)} color={color} note="Pelas partidas de jogadores fortes, com média de rating 2200 ou mais." />}
          {everything ? (
            <Shelf title="Todas as aberturas" entries={[...ordered].sort((a, b) => openingName(a.family.name).localeCompare(openingName(b.family.name), 'pt-BR'))} color={color} index />
          ) : (
            <button type="button" className="tl tl-accent mt-8" onClick={() => setEverything(true)}>Ver todas as {ordered.length}, de A a Z</button>
          )}
        </>
      )}
    </div>
  )
}

/** `index` lists the families in two lines each, without a board: the whole book is for finding a name. */
function Shelf({ title, entries, color, note, empty, index = false }: { title: string; entries: readonly CatalogEntry[]; color: Color; note?: string; empty?: string; index?: boolean }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="mt-8 md:mt-10">
      <h2 id={id} className="sec">{title}</h2>
      {note && <p className="caption -mt-1 mb-2">{note}</p>}
      <div className="ruled">
        {entries.length === 0 ? (
          <p className="text-ink-2 py-2">{empty}</p>
        ) : (
          <ul className={index ? 'shelf shelf-index' : 'shelf'} aria-label={title}>
            {entries.map((e) => (index ? <IndexRow key={e.family.name} entry={e} color={color} /> : <Card key={e.family.name} entry={e} color={color} />))}
          </ul>
        )}
      </div>
    </section>
  )
}

function Card({ entry: { family, colors, games }, color }: { entry: CatalogEntry; color: Color }) {
  const { total, learned } = colors[color]
  const name = openingName(family.name)
  return (
    <li className="ocard">
      <MiniBoard moves={family.trunk.moves} orientation={color} />
      <div className="min-w-0">
        <a href={href({ name: 'opening', family: family.name, color })} className="ocard-name">{name}</a>
        {name !== family.name && <p className="ocard-en">{family.name}</p>}
        <p className="ocard-moves"><Moves sans={family.trunk.sans} /></p>
        {learned > 0 && <div className="meter mt-2" aria-hidden><span style={{ width: `${(learned / total) * 100}%` }} /></div>}
        <p className={`learned ${learned > 0 ? 'mt-1' : 'mt-1.5'}`}><Counts {...colors[color]} games={games[color]} /></p>
      </div>
    </li>
  )
}

function IndexRow({ entry: { family, colors, games }, color }: { entry: CatalogEntry; color: Color }) {
  const name = openingName(family.name)
  return (
    <li className="ocard">
      <p className="truncate">
        <a href={href({ name: 'opening', family: family.name, color })} className="ocard-name">{name}</a>
        {name !== family.name && <span className="ocard-en ml-2">{family.name}</span>}
      </p>
      <p className="learned">
        <span className="ocard-moves"><Moves sans={family.trunk.sans} /></span>
        {' · '}
        <Counts {...colors[color]} games={games[color]} />
      </p>
    </li>
  )
}

/** What I learned of a family with one color, or how many variations it has before that. My reviewed games with the
 *  color say why a family I never studied is among mine. */
function Counts({ total, learned, due, games }: { total: number; learned: number; due: number; games: number }) {
  return (
    <>
      <span className="whitespace-nowrap">{learned ? `${learned} de ${total} aprendidas` : total === 1 ? '1 variação' : `${total} variações`}</span>
      {due > 0 && <> <span className="learned-due whitespace-nowrap">· {due} para hoje</span></>}
      {games > 0 && <> <span className="whitespace-nowrap">· {games === 1 ? '1 partida sua' : `${games} partidas suas`}</span></>}
    </>
  )
}

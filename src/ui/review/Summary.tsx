import { useId } from 'react'
import type { ByColor, Classification, Color, GameReview } from '../../domain/types'
import { CLASSIFICATIONS } from '../../domain/types'
import { colorLabel, formatAccuracy } from '../format'
import { CLASSIFICATION_LABEL } from '../labels'
import { Mark } from '../san'

/** Brilliant to good, then book to miss: the two halves print side by side. */
const HALVES: readonly (readonly Classification[])[] = [CLASSIFICATIONS.slice(0, 5), CLASSIFICATIONS.slice(5)]
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w')

type TablesProps = {
  review: GameReview
  columns: readonly Color[]
  /** Column heads; without them the heads are only read, not shown. */
  heads: Partial<ByColor<string>> | null
  /** With it, a count is a button to that player's first move of the class. */
  onJump?: (ply: number) => void
}

export function ClassTables({ review, columns, heads, onJump }: TablesProps) {
  const first = (c: Color, k: Classification) => review.moves.find((r) => r.move.mover === c && r.classification === k)
  return (
    <div className="ctables">
      {HALVES.map((half, h) => (
        <table key={h} className="ctable">
          <caption className="sr-only">Lances por classificação{h ? ', continuação' : ''}</caption>
          <thead className={heads ? (h ? 'max-md:sr-only' : '') : 'sr-only'}>
            <tr>
              <th scope="col">Classe</th>
              {columns.map((c) => <th key={c} scope="col">{heads?.[c] ?? (c === 'w' ? 'Brancas' : 'Pretas')}</th>)}
            </tr>
          </thead>
          <tbody>
            {half.map((k) => (
              <tr key={k}>
                <th scope="row">
                  <span className="sw" style={{ background: `var(--c-${k})` }} aria-hidden />
                  <span className="mk-slot"><Mark kind={k} /></span>
                  {CLASSIFICATION_LABEL[k]}
                </th>
                {columns.map((c) => {
                  const n = review.players[c].counts[k]
                  const target = onJump && n > 0 ? first(c, k) : undefined
                  return (
                    <td key={c} className={n ? undefined : 'zero'}>
                      {target ? (
                        <button
                          type="button"
                          className="count"
                          onClick={() => onJump!(target.move.index + 1)}
                          aria-label={`${n} ${CLASSIFICATION_LABEL[k].toLowerCase()} das ${colorLabel(c)}. Ir para o primeiro.`}
                        >
                          {n}
                        </button>
                      ) : (
                        n
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  )
}

/** Both accuracies, the reader's own first and in full ink. */
export function Accuracies({ review, me, names, size }: { review: GameReview; me: Color | null; names: ByColor<string>; size: 'hero' | 'summary' }) {
  const order: readonly Color[] = me ? [me, other(me)] : ['w', 'b']
  return (
    <div className={`acc acc-${size}`} role="group" aria-label="Precisão">
      {order.map((c) => (
        <div key={c} className={me && c !== me ? 'them' : undefined}>
          <p className="v">{formatAccuracy(review.players[c].accuracy)}</p>
          <p className="l">{me === c ? (size === 'hero' ? <b>Sua precisão</b> : 'Você, precisão') : names[c]}</p>
        </div>
      ))}
    </div>
  )
}

type Props = { review: GameReview; me: Color | null; onJump: (ply: number) => void }

/** The review's closing table: both accuracies, then every class counted for both players. */
export function Summary({ review, me, onJump }: Props) {
  const id = useId()
  const name = (c: Color) => review.players[c].player.name
  const columns: readonly Color[] = me ? [me, other(me)] : ['w', 'b']
  const heads = me ? { [me]: 'Você', [other(me)]: name(other(me)) } : { w: name('w'), b: name('b') }
  const names: ByColor<string> = me ? { w: name('w'), b: name('b') } : { w: `${name('w')}, brancas`, b: `${name('b')}, pretas` }
  return (
    <section className="summary" aria-labelledby={`${id}-t`}>
      <div>
        <h2 id={`${id}-t`} className="font-serif font-semibold text-2xl mb-3">Resumo</h2>
        <Accuracies review={review} me={me} names={names} size="summary" />
      </div>
      <ClassTables review={review} columns={columns} heads={heads} onJump={onJump} />
    </section>
  )
}

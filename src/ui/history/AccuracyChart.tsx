import { useId, useState } from 'react'
import type { AccuracyPoint } from '../../domain/types'
import { OUTCOME_LABEL, colorLabel, formatAccuracy, formatShortDate, outcomeFor } from '../format'
import type { Outcome } from '../format'
import { href } from '../router'
import { useElementWidth } from '../useElementWidth'

const H = 220
const PAD = { top: 12, right: 12, bottom: 28, left: 36 }
/** Keeps the first and last dots clear of the tick labels and the edge. */
const INSET = 12
const R = 4.5

/** The result rides on the dot's fill, as a scorebook marks it: full for a win, half for a draw, empty for a loss. */
function Dot({ cx, cy, outcome, r = R }: { cx: number; cy: number; outcome: Outcome; r?: number }) {
  if (outcome === 'win') return <circle cx={cx} cy={cy} r={r} fill="var(--ink)" stroke="var(--paper)" strokeWidth={2} />
  if (outcome === 'loss') return <circle cx={cx} cy={cy} r={r - 0.75} fill="var(--paper)" stroke="var(--ink)" strokeWidth={1.5} />
  return (
    <g>
      <circle cx={cx} cy={cy} r={r - 0.75} fill="var(--paper)" stroke="var(--ink)" strokeWidth={1.5} />
      <path d={`M ${cx} ${cy - r + 0.75} A ${r - 0.75} ${r - 0.75} 0 0 0 ${cx} ${cy + r - 0.75} Z`} fill="var(--ink)" />
    </g>
  )
}

/** One series, my accuracy per game in play order, with the result in each dot and in the legend. */
export function AccuracyChart({ points }: { points: readonly AccuracyPoint[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const id = useId()
  const n = points.length
  const innerW = Math.max(0, width - PAD.left - PAD.right - 2 * INSET)
  const lo = Math.max(0, Math.floor((Math.min(...points.map((p) => p.accuracy)) - 5) / 10) * 10)
  const x = (i: number) => PAD.left + INSET + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (a: number) => PAD.top + ((100 - a) / (100 - lo)) * (H - PAD.top - PAD.bottom)
  const ticks: number[] = []
  for (let t = lo; t <= 100; t += 10) ticks.push(t)
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.accuracy).toFixed(1)}`).join(' L ')
  const dateTicks = n <= 6 ? points.map((_, i) => i) : [0, Math.floor(n / 2), n - 1]

  const nearest = (clientX: number, el: HTMLElement) => {
    const px = clientX - el.getBoundingClientRect().left
    let best = 0
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i
    return best
  }
  const p = hover === null ? null : points[hover]

  return (
    <div className="graph">
      <div ref={ref} className="relative w-full" style={{ height: H }} onPointerMove={(e) => setHover(nearest(e.clientX, e.currentTarget))} onPointerLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-labelledby={`${id}-title`} className="block overflow-visible">
            <title id={`${id}-title`}>Precisão por partida, de {formatShortDate(points[0].playedAt)} a {formatShortDate(points[n - 1].playedAt)}</title>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--rule)" />
                <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end">{t}</text>
              </g>
            ))}
            {dateTicks.map((i) => (
              <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{formatShortDate(points[i].playedAt)}</text>
            ))}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--ink-3)" />}
            {n > 1 && <path d={`M ${line}`} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            {points.map((pt, i) => <Dot key={pt.gameId} cx={x(i)} cy={y(pt.accuracy)} outcome={outcomeFor(pt.result, pt.color)} r={hover === i ? 6 : R} />)}
          </svg>
        )}
        {p && hover !== null && (
          <div className="graph-tip" style={{ left: Math.min(Math.max(x(hover) + 10, 0), Math.max(0, width - 200)) }}>
            <span className="num font-semibold">{formatAccuracy(p.accuracy)}</span>
            <span className="text-ink-2"> · {OUTCOME_LABEL[outcomeFor(p.result, p.color)]} de {colorLabel(p.color)}</span>
            <br />
            <span className="text-ink-2">vs {p.opponent.name} · {formatShortDate(p.playedAt)}</span>
          </div>
        )}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-sm text-ink-2" aria-label="Legenda">
        {(['win', 'draw', 'loss'] as const).map((o) => (
          <li key={o} className="inline-flex items-center gap-1.5">
            <svg width={12} height={12} aria-hidden><Dot cx={6} cy={6} outcome={o} /></svg>
            {OUTCOME_LABEL[o]}
          </li>
        ))}
      </ul>
      <details className="mt-3">
        <summary className="tl tl-quiet inline-block">Ver como tabela</summary>
        <table className="ctable mt-2">
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col" className="text-left!">Adversário</th>
              <th scope="col" className="text-left!">Resultado</th>
              <th scope="col">Precisão</th>
            </tr>
          </thead>
          <tbody>
            {points.map((pt) => (
              <tr key={pt.gameId}>
                <th scope="row" className="num">{formatShortDate(pt.playedAt)}</th>
                <td className="text-left! font-sans! text-base!"><a href={href({ name: 'review', id: pt.gameId })} className="tl">{pt.opponent.name}</a></td>
                <td className="text-left! font-sans! text-base!">{OUTCOME_LABEL[outcomeFor(pt.result, pt.color)]}</td>
                <td>{formatAccuracy(pt.accuracy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

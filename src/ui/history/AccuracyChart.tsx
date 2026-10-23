import { useId, useState } from 'react'
import type { AccuracyPoint } from '../../domain/types'
import { OUTCOME_LABEL, colorLabel, formatShortDate, outcomeFor } from '../format'
import { href } from '../router'
import { useElementWidth } from '../useElementWidth'

const H = 220
const PAD = { top: 12, right: 12, bottom: 28, left: 36 }
const OUTCOME_FILL = { win: 'var(--good)', loss: 'var(--bad)', draw: 'var(--ink-3)', unknown: 'var(--ink-3)' } as const

/** One series (my accuracy per game, in play order) with result carried by the dot fill and the legend. */
export function AccuracyChart({ points }: { points: readonly AccuracyPoint[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const id = useId()
  const n = points.length
  const innerW = Math.max(0, width - PAD.left - PAD.right)
  const lo = Math.max(0, Math.floor((Math.min(...points.map((p) => p.accuracy)) - 5) / 10) * 10)
  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (a: number) => PAD.top + ((100 - a) / (100 - lo)) * (H - PAD.top - PAD.bottom)
  const ticks: number[] = []
  for (let t = lo; t <= 100; t += 10) ticks.push(t)
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.accuracy).toFixed(1)}`).join(' L ')
  const dateTicks = n <= 6 ? points.map((_, i) => i) : [0, Math.floor(n / 2), n - 1]

  const nearest = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const px = clientX - r.left
    let best = 0
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i
    return best
  }
  const shown = hover
  const p = shown === null ? null : points[shown]

  return (
    <div className="flex flex-col gap-2">
      <div ref={ref} className="relative w-full" style={{ height: H }} onPointerMove={(e) => setHover(nearest(e.clientX, e.currentTarget))} onPointerLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-labelledby={`${id}-title`} className="block">
            <title id={`${id}-title`}>Precisão por partida, de {formatShortDate(points[0].playedAt)} a {formatShortDate(points[n - 1].playedAt)}</title>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
                <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--ink-3)" className="tabular">{t}</text>
              </g>
            ))}
            {dateTicks.map((i) => (
              <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={11} fill="var(--ink-3)">{formatShortDate(points[i].playedAt)}</text>
            ))}
            {n > 1 && <path d={`M ${line}`} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            {points.map((pt, i) => (
              <circle key={pt.gameId} cx={x(i)} cy={y(pt.accuracy)} r={hover === i ? 6 : 4.5} fill={OUTCOME_FILL[outcomeFor(pt.result, pt.color)]} stroke="var(--surface)" strokeWidth={2} />
            ))}
            {shown !== null && <line x1={x(shown)} x2={x(shown)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--accent)" strokeWidth={1} opacity={0.5} />}
          </svg>
        )}
        {p && shown !== null && (
          <div className="pointer-events-none absolute top-1 rounded-md bg-surface border border-border shadow-card px-2 py-1 text-[12px] whitespace-nowrap" style={{ left: Math.min(Math.max(x(shown) + 10, 0), Math.max(0, width - 190)) }}>
            <span className="font-semibold text-[14px] tabular">{p.accuracy.toFixed(1)}%</span>
            <span className="text-ink-2"> · {OUTCOME_LABEL[outcomeFor(p.result, p.color)]} de {colorLabel(p.color)}</span>
            <br />
            <span className="text-ink-3">vs {p.opponent.name} · {formatShortDate(p.playedAt)}</span>
          </div>
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2" aria-label="Legenda">
        {(['win', 'draw', 'loss'] as const).map((o) => (
          <li key={o} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: OUTCOME_FILL[o] }} />
            {OUTCOME_LABEL[o]}
          </li>
        ))}
      </ul>
      <details className="text-[13px]">
        <summary className="cursor-pointer text-ink-2 font-medium">Ver como tabela</summary>
        <table className="w-full mt-2">
          <thead>
            <tr className="text-left text-ink-3 text-[12px]">
              <th scope="col" className="py-1 font-medium">Data</th>
              <th scope="col" className="py-1 font-medium">Adversário</th>
              <th scope="col" className="py-1 font-medium">Resultado</th>
              <th scope="col" className="py-1 font-medium text-right">Precisão</th>
            </tr>
          </thead>
          <tbody>
            {points.map((pt) => (
              <tr key={pt.gameId} className="border-t border-border">
                <td className="py-1 tabular">{formatShortDate(pt.playedAt)}</td>
                <td className="py-1"><a href={href({ name: 'review', id: pt.gameId })} className="text-accent">{pt.opponent.name}</a></td>
                <td className="py-1">{OUTCOME_LABEL[outcomeFor(pt.result, pt.color)]}</td>
                <td className="py-1 text-right tabular">{pt.accuracy.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

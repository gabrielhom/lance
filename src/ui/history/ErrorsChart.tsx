import { useId, useState } from 'react'
import type { ErrorPoint } from '../../review'
import { formatShortDate } from '../format'
import { useElementWidth } from '../useElementWidth'

const H = 180
const PAD = { top: 12, right: 12, bottom: 28, left: 28 }
const INSET = 12
const R = 3.5
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

const total = (p: ErrorPoint) => p.errors.mistake + p.errors.blunder + p.errors.miss

/** My errors in each game as dots, and their rolling average as the line, in play order. */
export function ErrorsChart({ points }: { points: readonly ErrorPoint[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const id = useId()
  const n = points.length
  const top = Math.max(4, Math.ceil(Math.max(...points.map(total))))
  const innerW = Math.max(0, width - PAD.left - PAD.right - 2 * INSET)
  const x = (i: number) => PAD.left + INSET + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v: number) => PAD.top + ((top - v) / top) * (H - PAD.top - PAD.bottom)
  const step = top <= 6 ? 1 : 2
  const ticks: number[] = []
  for (let t = 0; t <= top; t += step) ticks.push(t)
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.rolling).toFixed(1)}`).join(' L ')
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
            <title id={`${id}-title`}>Erros por partida e média das últimas partidas, de {formatShortDate(points[0].playedAt)} a {formatShortDate(points[n - 1].playedAt)}</title>
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
            {points.map((pt, i) => (
              <circle key={pt.gameId} cx={x(i)} cy={y(total(pt))} r={hover === i ? R + 1.5 : R} fill="var(--paper)" stroke="var(--ink-3)" strokeWidth={1.5} />
            ))}
            {n > 1 && <path d={`M ${line}`} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          </svg>
        )}
        {p && hover !== null && (
          <div className="graph-tip" style={{ left: Math.min(Math.max(x(hover) + 10, 0), Math.max(0, width - 200)) }}>
            <span className="num font-semibold">{total(p)} {total(p) === 1 ? 'erro' : 'erros'}</span>
            <span className="text-ink-2"> · {formatShortDate(p.playedAt)}</span>
            <br />
            <span className="text-ink-2">{p.errors.blunder} blunders, {p.errors.mistake} erros, {p.errors.miss} chances perdidas</span>
            <br />
            <span className="text-ink-2">Média: {decimal.format(p.rolling)}</span>
          </div>
        )}
      </div>
      <details className="mt-3">
        <summary className="tl tl-quiet inline-block">Ver como tabela</summary>
        <table className="ctable mt-2">
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Blunders</th>
              <th scope="col">Erros</th>
              <th scope="col">Chances perdidas</th>
              <th scope="col">Média</th>
            </tr>
          </thead>
          <tbody>
            {points.map((pt) => (
              <tr key={pt.gameId}>
                <th scope="row" className="num">{formatShortDate(pt.playedAt)}</th>
                <td>{pt.errors.blunder}</td>
                <td>{pt.errors.mistake}</td>
                <td>{pt.errors.miss}</td>
                <td>{decimal.format(pt.rolling)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

import { useId, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type { Classification, PartialSeries, PlayedMove } from '../../domain/types'
import { CLASSIFICATION_LABEL, CLASSIFICATION_MARK } from '../labels'
import { moveNumberLabel } from '../format'
import { useElementWidth } from '../useElementWidth'

export type GraphMarker = { index: number; kind: Classification | 'turning-point' }

type Props = {
  series: PartialSeries
  labels: readonly string[] | null
  moves: readonly PlayedMove[]
  markers: readonly GraphMarker[]
  /** The class of each move, once reviewed, for the cursor's mark. */
  classes: readonly Classification[] | null
  ply: number
  onSelect: (ply: number) => void
}

const H = 150
const PAD = { top: 8, right: 4, bottom: 22, left: 28 }

/** White's winning chance per ply, drawn as one ink line over a wash, with the key moments dotted on it. */
export function EvalGraph({ series, labels, moves, markers, classes, ply, onSelect }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const id = useId()
  const n = series.length
  const right = Math.max(PAD.left, width - PAD.right)
  const x = (i: number) => (n <= 1 ? PAD.left : PAD.left + (i / (n - 1)) * (right - PAD.left))
  const y = (w: number) => PAD.top + ((100 - w) / 100) * (H - PAD.top - PAD.bottom)
  const mid = y(50)

  const segments: { d: string; from: number; to: number }[] = []
  let current: number[] = []
  const flush = () => {
    if (current.length >= 1) {
      const pts = current.map((i) => `${x(i).toFixed(1)},${y(series[i] as number).toFixed(1)}`)
      segments.push({ d: pts.join(' L '), from: current[0], to: current[current.length - 1] })
    }
    current = []
  }
  for (let i = 0; i < n; i++) {
    if (series[i] === null) flush()
    else current.push(i)
  }
  flush()
  const areaPath = segments.map((s) => `M ${x(s.from).toFixed(1)},${mid} L ${s.d} L ${x(s.to).toFixed(1)},${mid} Z`).join(' ')
  const linePath = segments.map((s) => `M ${s.d}`).join(' ')

  // Move numbers on the x axis, every 10 moves, or 5 in a short game and 20 in a long one.
  const lastMove = Math.ceil((n - 1) / 2)
  const step = lastMove <= 24 ? 5 : lastMove <= 80 ? 10 : 20
  const ticks: number[] = []
  for (let m = step; m <= lastMove; m += step) ticks.push(m)

  const plyFromX = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (clientX - r.left - PAD.left) / Math.max(1, right - PAD.left)))
    return Math.round(t * (n - 1))
  }
  const onPointer = (e: PointerEvent<HTMLDivElement>) => setHover(plyFromX(e.clientX, e.currentTarget))
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1, Home: -ply, End: n - 1 - ply }[e.key]
    if (step === undefined) return
    e.preventDefault()
    onSelect(Math.max(0, Math.min(n - 1, ply + step)))
  }

  const describe = (i: number) => {
    const w = series[i]
    const move = i > 0 ? moves[i - 1] : null
    const head = move ? `${moveNumberLabel(move.index)} ${move.san}` : 'Posição inicial'
    const val = w === null ? 'sem avaliação' : labels ? labels[i] : `${Math.round(w)}% brancas`
    return `${head} · ${val}`
  }
  const done = series.every((v) => v !== null)
  const cls = ply > 0 ? classes?.[ply - 1] : undefined
  const mark = cls ? CLASSIFICATION_MARK[cls] : ''
  const tone = mark && cls ? `var(--c-${cls})` : 'var(--ink-3)'
  const at = series[ply]

  return (
    <div className="graph">
      <div
        ref={ref}
        className="relative w-full cursor-crosshair"
        style={{ height: H }}
        role="slider"
        tabIndex={0}
        aria-label="Gráfico de avaliação. Use as setas para percorrer os lances."
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={ply}
        aria-valuetext={describe(ply)}
        aria-describedby={`${id}-legend`}
        onPointerMove={onPointer}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(e) => onSelect(plyFromX(e.clientX, e.currentTarget))}
        onKeyDown={onKey}
      >
        {width > 0 && (
          <svg width={width} height={H} aria-hidden className="block overflow-visible">
            <line x1={PAD.left} x2={right} y1={y(100)} y2={y(100)} stroke="var(--rule)" />
            <line x1={PAD.left} x2={right} y1={y(0)} y2={y(0)} stroke="var(--rule)" />
            <path d={areaPath} fill="var(--graph-fill)" />
            <line x1={PAD.left} x2={right} y1={mid} y2={mid} stroke="var(--ink-3)" />
            <path d={linePath} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <text x={PAD.left - 6} y={y(100) + 4} textAnchor="end">100</text>
            <text x={PAD.left - 6} y={mid + 4} textAnchor="end">50</text>
            <text x={PAD.left - 6} y={y(0) + 4} textAnchor="end">0</text>
            {ticks.map((m) => (
              <text key={m} x={x(Math.min(n - 1, 2 * m - 1))} y={H - 4} textAnchor="middle">{m}</text>
            ))}
            {markers.map((m) => {
              const w = series[m.index]
              if (w === null || m.index === ply) return null
              return <circle key={m.index} cx={x(m.index)} cy={y(w)} r={4} fill={m.kind === 'turning-point' ? 'var(--ink-2)' : `var(--c-${m.kind})`} stroke="var(--paper)" strokeWidth={2} />
            })}
            {n > 1 && hover !== null && hover !== ply && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--ink-3)" strokeWidth={1} />}
            {n > 1 && (
              <g>
                <line x1={x(ply)} x2={x(ply)} y1={PAD.top} y2={H - PAD.bottom} stroke={tone} strokeWidth={1.25} />
                {at !== null && <circle cx={x(ply)} cy={y(at)} r={4.5} fill={mark ? tone : 'var(--ink)'} stroke="var(--paper)" strokeWidth={2} />}
                {at !== null && ply > 0 && (
                  <text x={x(ply) + (x(ply) > width - 60 ? -8 : 8)} y={y(at) - 7 < PAD.top + 10 ? y(at) + 17 : y(at) - 7} textAnchor={x(ply) > width - 60 ? 'end' : 'start'} className="cursor-label">
                    {moveNumberLabel(ply - 1)}{mark}
                  </text>
                )}
              </g>
            )}
          </svg>
        )}
        {hover !== null && width > 0 && (
          <div className="graph-tip" style={{ left: Math.min(Math.max(x(hover) + 8, 4), Math.max(4, width - 170)) }}>
            {describe(hover)}
          </div>
        )}
      </div>
      <p id={`${id}-legend`} className="caption ml-0 mt-1">
        {done ? 'Chance de vitória das brancas, em %. Toque no gráfico para ir ao lance.' : 'Preenche enquanto a análise avança.'}
        {markers.length > 0 && done && (
          <span className="sr-only">
            {` Pontos marcam momentos-chave (${[...new Set(markers.map((m) => (m.kind === 'turning-point' ? 'virada' : CLASSIFICATION_LABEL[m.kind].toLowerCase())))].join(', ')}).`}
          </span>
        )}
      </p>
    </div>
  )
}

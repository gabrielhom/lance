import { useId, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type { Classification, PartialSeries, PlayedMove } from '../../domain/types'
import { CLASSIFICATION_LABEL } from '../labels'
import { moveNumberLabel } from '../format'
import { useElementWidth } from '../useElementWidth'

export type GraphMarker = { index: number; kind: Classification | 'turning-point' }

type Props = {
  series: PartialSeries
  labels: readonly string[] | null
  moves: readonly PlayedMove[]
  markers: readonly GraphMarker[]
  ply: number
  onSelect: (ply: number) => void
}

const H = 140
const PAD = { top: 8, bottom: 8 }

/** White win% over plies. White's share is drawn above the midline in the light tone, Black's below in the dark tone. */
export function EvalGraph({ series, labels, moves, markers, ply, onSelect }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const id = useId()
  const n = series.length
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * width)
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

  const areaPath = segments
    .map((s) => `M ${x(s.from).toFixed(1)},${mid} L ${s.d} L ${x(s.to).toFixed(1)},${mid} Z`)
    .join(' ')
  const linePath = segments.map((s) => `M ${s.d}`).join(' ')

  const plyFromX = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
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
  const shown = hover ?? ply
  const done = series.every((v) => v !== null)

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={ref}
        className="relative w-full rounded-lg overflow-hidden cursor-crosshair"
        style={{ height: H, background: 'var(--graph-bg)' }}
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
          <svg width={width} height={H} aria-hidden className="block">
            <defs>
              <clipPath id={`${id}-top`}>
                <rect x={0} y={0} width={width} height={mid} />
              </clipPath>
              <clipPath id={`${id}-bottom`}>
                <rect x={0} y={mid} width={width} height={H - mid} />
              </clipPath>
            </defs>
            <path d={areaPath} fill="var(--graph-white)" clipPath={`url(#${id}-top)`} />
            <path d={areaPath} fill="var(--graph-black)" clipPath={`url(#${id}-bottom)`} />
            <line x1={0} x2={width} y1={mid} y2={mid} stroke="var(--graph-grid)" strokeWidth={1} />
            <path d={linePath} fill="none" stroke="var(--graph-line)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity={0.6} />
            {markers.map((m) => {
              const w = series[m.index]
              if (w === null) return null
              return (
                <circle key={m.index} cx={x(m.index)} cy={y(w)} r={4.5} fill={m.kind === 'turning-point' ? 'var(--accent)' : `var(--badge-${m.kind})`} stroke="var(--graph-bg)" strokeWidth={2} />
              )
            })}
            {n > 1 && (
              <g>
                <line x1={x(shown)} x2={x(shown)} y1={0} y2={H} stroke="var(--accent)" strokeWidth={hover === null ? 2 : 1.5} opacity={hover === null ? 1 : 0.8} />
                {series[shown] !== null && <circle cx={x(shown)} cy={y(series[shown] as number)} r={5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />}
              </g>
            )}
          </svg>
        )}
        {hover !== null && width > 0 && (
          <div
            className="pointer-events-none absolute top-2 rounded-md bg-surface text-ink text-[12px] font-medium px-2 py-1 shadow-card border border-border whitespace-nowrap"
            style={{ left: Math.min(Math.max(x(hover) + 8, 4), Math.max(4, width - 150)) }}
          >
            {describe(hover)}
          </div>
        )}
      </div>
      <p id={`${id}-legend`} className="hint text-[12px]">
        {done ? 'Chance de vitória das brancas ao longo da partida. Clique para ir ao lance.' : 'Preenche enquanto a análise avança.'}
        {markers.length > 0 && done && ` Pontos marcam momentos-chave (${[...new Set(markers.map((m) => (m.kind === 'turning-point' ? 'virada' : CLASSIFICATION_LABEL[m.kind].toLowerCase())))].join(', ')}).`}
      </p>
    </div>
  )
}

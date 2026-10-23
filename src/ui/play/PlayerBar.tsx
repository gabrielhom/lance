import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Color } from '../../domain/types'
import type { Seat } from './names'
import { playSound } from './sound'

const LOW_MS = 20_000

export type ClockProps = {
  /** Remaining ms when this side's turn started, or the frozen value when it is not running. */
  readonly baseMs: number
  /** Date.now() stamp the clock has been running since, or null when it is stopped. */
  readonly since: number | null
  readonly onFlag: () => void
  /** Ticks a warning when this clock goes low. Only for the player's own clock. */
  readonly warn: boolean
}

type Props = {
  seat: Seat
  color: Color
  toMove: boolean
  /** The line under the name: the level, "pensando", whose turn it is. */
  status: ReactNode
  /** Material ahead of the other side, in pawns; shown when positive. */
  lead: number
  clock: ClockProps | null
}

export function PlayerBar({ seat, toMove, status, lead, clock }: Props) {
  return (
    <div className="flex items-center gap-2.5 px-3 sm:px-0 h-12">
      <div className="min-w-0 flex-1 leading-tight">
        <p className="text-[14px] font-semibold truncate">
          {seat.name}
          {lead > 0 && <span className="ml-1.5 text-[13px] font-medium text-ink-3 tabular">+{lead}</span>}
        </p>
        <p className="text-[12px] text-ink-3 truncate min-h-[1lh]">{status}</p>
      </div>
      {clock && <Clock {...clock} active={toMove} />}
    </div>
  )
}

function format(ms: number): string {
  if (ms < 10_000) return `0:0${(Math.floor(ms / 100) / 10).toFixed(1)}`
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Clock({ baseMs, since, onFlag, warn, active }: ClockProps & { active: boolean }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (since === null) return
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [since])
  const ms = since === null ? baseMs : Math.max(0, baseMs - Math.max(0, now - since))
  const out = since !== null && ms <= 0
  const low = ms < LOW_MS
  const hurry = low && warn && since !== null

  const flag = useRef(onFlag)
  useEffect(() => {
    flag.current = onFlag
  })
  useEffect(() => {
    if (out) flag.current()
  }, [out])
  useEffect(() => {
    if (hurry) playSound('lowtime')
  }, [hurry])

  return (
    <span
      className={`clock tabular ${active ? 'clock-active' : ''} ${low ? 'clock-low' : ''}`}
      role="timer"
      aria-live="off"
      aria-label={`Relógio: ${format(ms)}`}
    >
      {format(ms)}
    </span>
  )
}

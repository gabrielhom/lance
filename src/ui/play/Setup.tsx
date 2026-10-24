import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Color, PlaySetup, TimeControl } from '../../domain/types'
import { LEVELS, levelById, loadChoice, resolveChoice, saveChoice } from '../../play'
import type { SetupChoice } from '../../play'
import { formatClock } from '../format'
import { DueToday } from '../training/DueToday'
import { levelLabel } from './names'
import { unlockAudio } from './sound'

const MIN = 60_000
const TIMES: readonly TimeControl[] = [
  { kind: 'none' },
  { kind: 'clock', initialMs: 3 * MIN, incrementMs: 2000 },
  { kind: 'clock', initialMs: 5 * MIN, incrementMs: 0 },
  { kind: 'clock', initialMs: 10 * MIN, incrementMs: 0 },
  { kind: 'clock', initialMs: 15 * MIN, incrementMs: 10_000 },
  { kind: 'clock', initialMs: 30 * MIN, incrementMs: 0 },
]
const COLORS: readonly { value: Color | 'random'; label: string; note: string }[] = [
  { value: 'w', label: 'Brancas', note: 'brancas' },
  { value: 'random', label: 'Aleatório', note: 'cor sorteada' },
  { value: 'b', label: 'Pretas', note: 'pretas' },
]

const sameTime = (a: TimeControl, b: TimeControl) =>
  a.kind === b.kind && (a.kind === 'none' || (b.kind === 'clock' && a.initialMs === b.initialMs && a.incrementMs === b.incrementMs))

function summary(choice: SetupChoice): string {
  const level = choice.opponent.kind === 'engine' ? levelById(choice.opponent.levelId) : null
  const who = level ? [levelLabel(level), COLORS.find((c) => c.value === choice.color)?.note] : ['Dois jogadores']
  return [...who, formatClock(choice.time)].join(', ')
}

export function Setup({ onStart }: { onStart: (setup: PlaySetup) => void }) {
  const [choice, setChoice] = useState<SetupChoice>(loadChoice)
  const set = (patch: Partial<SetupChoice>) => setChoice((c) => ({ ...c, ...patch }))
  const local = choice.opponent.kind === 'local'
  const levelId = choice.opponent.kind === 'engine' ? choice.opponent.levelId : null

  return (
    <form
      className="setup"
      onSubmit={(e) => {
        e.preventDefault()
        unlockAudio()
        saveChoice(choice)
        onStart(resolveChoice(choice, Math.random))
      }}
    >
      <div>
        <h1 className="display text-3xl md:text-5xl mb-4 md:mb-6">Nova partida</h1>
        <DueToday className="-mt-2 mb-4 md:-mt-3 md:mb-6" />
        <fieldset>
          <legend className="sec">Adversário</legend>
          <ol className="levels">
            {LEVELS.map((l) => (
              <li key={l.id}>
                <label className="level">
                  <input type="radio" name="adversario" className="sr-only" checked={levelId === l.id} onChange={() => set({ opponent: { kind: 'engine', levelId: l.id } })} />
                  <span className="i">{l.id}</span>
                  <span className="name">{l.name}</span>
                  <span className="lead" aria-hidden />
                  <span className={`elo ${l.rating.startsWith('~') ? '' : 'italic'}`}>{l.rating}</span>
                </label>
              </li>
            ))}
          </ol>
          <label className="two-player">
            <input type="radio" name="adversario" className="sr-only" checked={local} onChange={() => set({ opponent: { kind: 'local' } })} />
            Dois jogadores neste aparelho
          </label>
        </fieldset>
      </div>

      <div className="setup-side">
        {!local && (
          <Choices legend="Suas peças">
            {COLORS.map((c) => (
              <label key={c.value} className="choice">
                <input type="radio" name="cor" className="sr-only" checked={choice.color === c.value} onChange={() => set({ color: c.value })} />
                {c.label}
              </label>
            ))}
          </Choices>
        )}
        <Choices legend="Tempo">
          {TIMES.map((t) => {
            const label = formatClock(t)
            return (
              <label key={label} className={`choice ${t.kind === 'clock' ? 'num' : ''}`}>
                <input type="radio" name="tempo" className="sr-only" checked={sameTime(choice.time, t)} onChange={() => set({ time: t })} />
                {t.kind === 'none' ? 'Sem relógio' : label}
              </label>
            )
          })}
        </Choices>
        <div className="go">
          <button type="submit" className="btn">Jogar</button>
          <span className="font-serif italic text-sm text-ink-2">{summary(choice)}</span>
        </div>
      </div>
    </form>
  )
}

function Choices({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="mb-6 md:mb-8">
      <legend className="sec">{legend}</legend>
      <div className="choices">{children}</div>
    </fieldset>
  )
}

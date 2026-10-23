import { Shuffle, Users } from 'lucide-react'
import { useState } from 'react'
import { Chessboard, defaultPieces } from 'react-chessboard'
import type { Color, PlaySetup, TimeControl } from '../../domain/types'
import { LEVELS, loadChoice, resolveChoice, saveChoice } from '../../play'
import type { SetupChoice } from '../../play'
import { BOARD_STYLE } from '../boardStyle'
import { unlockAudio } from './sound'

const MIN = 60_000
const TIMES: readonly { label: string; hint: string; time: TimeControl }[] = [
  { label: 'Sem relógio', hint: 'sem pressa', time: { kind: 'none' } },
  { label: '3+2', hint: 'blitz', time: { kind: 'clock', initialMs: 3 * MIN, incrementMs: 2000 } },
  { label: '5+0', hint: 'blitz', time: { kind: 'clock', initialMs: 5 * MIN, incrementMs: 0 } },
  { label: '10+0', hint: 'rápida', time: { kind: 'clock', initialMs: 10 * MIN, incrementMs: 0 } },
  { label: '15+10', hint: 'rápida', time: { kind: 'clock', initialMs: 15 * MIN, incrementMs: 10_000 } },
  { label: '30+0', hint: 'clássica', time: { kind: 'clock', initialMs: 30 * MIN, incrementMs: 0 } },
]
const COLORS: readonly { value: Color | 'random'; label: string }[] = [
  { value: 'w', label: 'Brancas' },
  { value: 'random', label: 'Aleatório' },
  { value: 'b', label: 'Pretas' },
]

const sameTime = (a: TimeControl, b: TimeControl) =>
  a.kind === b.kind && (a.kind === 'none' || (b.kind === 'clock' && a.initialMs === b.initialMs && a.incrementMs === b.incrementMs))

export function Setup({ onStart }: { onStart: (setup: PlaySetup) => void }) {
  const [choice, setChoice] = useState<SetupChoice>(loadChoice)
  const set = (patch: Partial<SetupChoice>) => setChoice((c) => ({ ...c, ...patch }))
  const local = choice.opponent.kind === 'local'
  const levelId = choice.opponent.kind === 'engine' ? choice.opponent.levelId : null

  return (
    <div className="lg:grid lg:grid-cols-[auto_400px] lg:gap-10 lg:items-start lg:justify-center">
      <div className="hidden lg:block w-[min(680px,calc(100dvh-170px),calc(100vw-520px))]" aria-hidden inert>
        <Chessboard options={{ ...BOARD_STYLE, id: 'preparo', boardOrientation: choice.color === 'b' ? 'black' : 'white', allowDragging: false }} />
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          unlockAudio()
          saveChoice(choice)
          onStart(resolveChoice(choice, Math.random))
        }}
      >
        <header>
          <h1 className="text-[22px] font-semibold tracking-tight">Nova partida</h1>
          <p className="hint">No fim, você vê sua precisão e pode revisar lance a lance.</p>
        </header>

        <fieldset className="flex flex-col gap-2">
          <legend className="label">Adversário</legend>
          <div className="grid grid-cols-2 gap-2">
            {LEVELS.map((l) => (
              <label key={l.id} className="choice">
                <input type="radio" name="adversario" className="sr-only" checked={levelId === l.id} onChange={() => set({ opponent: { kind: 'engine', levelId: l.id } })} />
                <span className="flex items-baseline gap-1.5 leading-tight">
                  <span className="text-[12px] text-ink-3 tabular">{l.id}</span>
                  <span className="font-semibold text-[14px] truncate">{l.name}</span>
                </span>
                <span className="block text-[12px] text-ink-3 leading-tight mt-0.5">{l.rating}</span>
              </label>
            ))}
            <label className="choice col-span-2 flex items-center gap-3">
              <input type="radio" name="adversario" className="sr-only" checked={local} onChange={() => set({ opponent: { kind: 'local' } })} />
              <Users size={18} className="text-accent flex-none" aria-hidden />
              <span>
                <span className="block font-semibold text-[14px]">Dois jogadores neste aparelho</span>
                <span className="block text-[12px] text-ink-3">Sem engine. Passem o aparelho a cada lance.</span>
              </span>
            </label>
          </div>
        </fieldset>

        {!local && (
          <fieldset className="flex flex-col gap-2">
            <legend className="label">Suas peças</legend>
            <div className="grid grid-cols-3 gap-2">
              {COLORS.map((c) => (
                <label key={c.value} className="choice flex items-center justify-center gap-1.5 min-h-11">
                  <input type="radio" name="cor" className="sr-only" checked={choice.color === c.value} onChange={() => set({ color: c.value })} />
                  {c.value === 'random' ? <Shuffle size={16} aria-hidden /> : <King color={c.value} />}
                  <span className="font-semibold text-[14px]">{c.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="label">Tempo</legend>
          <div className="grid grid-cols-3 gap-2">
            {TIMES.map((t) => (
              <label key={t.label} className="choice text-center">
                <input type="radio" name="tempo" className="sr-only" checked={sameTime(choice.time, t.time)} onChange={() => set({ time: t.time })} />
                <span className="block font-semibold text-[14px] tabular leading-tight">{t.label}</span>
                <span className="block text-[12px] text-ink-3 leading-tight mt-0.5">{t.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="sticky bottom-[calc(56px+env(safe-area-inset-bottom))] sm:bottom-0 z-10 -mx-4 px-4 pt-4 pb-3 sm:mx-0 sm:px-0 bg-linear-to-t from-bg from-75% to-transparent">
          <button type="submit" className="btn btn-primary btn-lg w-full">
            Jogar
          </button>
        </div>
      </form>
    </div>
  )
}

function King({ color }: { color: Color }) {
  const Svg = defaultPieces[color === 'w' ? 'wK' : 'bK']
  return (
    <span className={`inline-block w-6 h-6 rounded-full p-0.5 ${color === 'b' ? 'bg-[#f4f3ef]' : ''}`} aria-hidden>
      <Svg />
    </span>
  )
}

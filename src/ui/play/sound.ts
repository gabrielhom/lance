import { useSyncExternalStore } from 'react'

export type SoundKind = 'move' | 'capture' | 'check' | 'end' | 'lowtime'

const KEY = 'lance.sound'
const listeners = new Set<() => void>()
let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null

function readMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === 'off'
  } catch {
    return false
  }
}
let muted = readMuted()

export function setMuted(m: boolean) {
  muted = m
  try {
    if (m) localStorage.setItem(KEY, 'off')
    else localStorage.removeItem(KEY)
  } catch {
    /* the choice still holds for this page */
  }
  for (const l of listeners) l()
}

export function useMuted(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => muted,
    () => false,
  )
}

/** Browsers start an AudioContext suspended until a user gesture, so the "Jogar" click opens it for the engine's moves too. */
export function unlockAudio() {
  if (typeof AudioContext === 'undefined') return
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noise) return noise
  const b = c.createBuffer(1, Math.round(c.sampleRate * 0.05), c.sampleRate)
  const data = b.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  noise = b
  return b
}

/** A piece set down on wood: a falling triangle thump plus a short filtered click. */
function knock(c: AudioContext, at: number, freq: number, level: number) {
  const body = c.createGain()
  body.connect(c.destination)
  body.gain.setValueAtTime(0.0001, at)
  body.gain.exponentialRampToValueAtTime(level, at + 0.004)
  body.gain.exponentialRampToValueAtTime(0.0001, at + 0.13)
  const osc = c.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(freq, at)
  osc.frequency.exponentialRampToValueAtTime(freq * 0.55, at + 0.09)
  osc.connect(body)
  osc.start(at)
  osc.stop(at + 0.14)

  const click = c.createBufferSource()
  click.buffer = noiseBuffer(c)
  const band = c.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 1900
  band.Q.value = 0.9
  const g = c.createGain()
  g.gain.setValueAtTime(level * 0.7, at)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03)
  click.connect(band).connect(g).connect(c.destination)
  click.start(at)
  click.stop(at + 0.04)
}

function tone(c: AudioContext, at: number, freq: number, dur: number, level: number) {
  const g = c.createGain()
  g.connect(c.destination)
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(level, at + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = freq
  osc.connect(g)
  osc.start(at)
  osc.stop(at + dur + 0.02)
}

const SOUNDS: Readonly<Record<SoundKind, (c: AudioContext, t: number) => void>> = {
  move: (c, t) => knock(c, t, 230, 0.35),
  capture: (c, t) => {
    knock(c, t, 190, 0.5)
    knock(c, t + 0.045, 150, 0.3)
  },
  check: (c, t) => {
    knock(c, t, 230, 0.3)
    tone(c, t + 0.02, 880, 0.16, 0.07)
  },
  end: (c, t) => {
    tone(c, t + 0.12, 523.25, 0.3, 0.08)
    tone(c, t + 0.24, 659.25, 0.3, 0.08)
    tone(c, t + 0.36, 783.99, 0.55, 0.08)
  },
  lowtime: (c, t) => tone(c, t, 1320, 0.07, 0.05),
}

export function playSound(kind: SoundKind) {
  if (muted || !ctx || ctx.state !== 'running') return
  SOUNDS[kind](ctx, ctx.currentTime + 0.005)
}

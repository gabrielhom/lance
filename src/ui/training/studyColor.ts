import type { Color } from '../../domain/types'

const KEY = 'lance.openings.color'

/** The color the openings catalog studies with, the last one picked on this browser; White before any pick. */
export function readStudyColor(): Color {
  try {
    return localStorage.getItem(KEY) === 'b' ? 'b' : 'w'
  } catch {
    return 'w'
  }
}

export function saveStudyColor(color: Color) {
  try {
    localStorage.setItem(KEY, color)
  } catch {
    /* storage may be blocked; the catalog then opens on White next time */
  }
}

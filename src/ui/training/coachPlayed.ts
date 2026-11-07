import type { Color } from '../../domain/types'
import type { PlayedCounts } from '../../openings'

const key = (family: string, color: Color) => `lance.coach.played.${color}.${family}`

/** What the coach played from each position with this family and color on this browser; empty when storage is blocked
 *  or holds something else. */
export function readPlayed(family: string, color: Color): PlayedCounts {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key(family, color)) ?? '[]')
    if (!Array.isArray(stored)) return new Map()
    return new Map(stored.filter((e): e is [string, number] => Array.isArray(e) && typeof e[0] === 'string' && Number.isInteger(e[1]) && e[1] > 0))
  } catch {
    return new Map()
  }
}

export function savePlayed(family: string, color: Color, played: PlayedCounts) {
  try {
    localStorage.setItem(key(family, color), JSON.stringify([...played]))
  } catch {
    /* storage may be blocked; the coach then rotates only until the page reloads */
  }
}

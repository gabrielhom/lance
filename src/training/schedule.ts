import type { Schedule } from '../domain'

/** Days until an item comes back, by Leitner box. A wrong answer sends it to box 0. Shared by training and openings. */
export const INTERVAL_DAYS = [1, 3, 7, 14, 30] as const

/** In box `box`, due that box's interval after the day of `at`, answered at `at`. */
export function inBox(box: number, at: number, correct: boolean): Schedule {
  return { box, due: addDays(startOfDay(at), INTERVAL_DAYS[box]), last: { at, correct } }
}

/** Leitner boxes. Right moves the item up a box and waits that box's interval; wrong sends it back to box 0, for tomorrow.
 *  An answer before the due day is practice and changes nothing: an early right answer would stretch the interval
 *  without testing the forgetting it waits for, and retrying a missed item at once would erase the miss. */
export function nextSchedule(s: Schedule, correct: boolean, now: number): Schedule {
  if (s.due > now) return s
  return inBox(correct ? Math.min(s.box + 1, INTERVAL_DAYS.length - 1) : 0, now, correct)
}

export function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function addDays(t: number, days: number): number {
  const d = new Date(t)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

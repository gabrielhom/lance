import { estimateElo } from '../analysis'
import { MIN_MOVES_OUTSIDE_THEORY, movesOutsideTheory, perspective, type AccuracyHistory, type Color, type Identity, type LibraryRecord } from '../domain'

/** One of my reviewed games long enough to say something. */
export type MyGame = { readonly record: LibraryRecord; readonly color: Color; readonly accuracy: number; readonly playedAt: number }

/** My games, oldest first. Games where I am not a player are left out, and so are games too short to say anything;
 *  `shortGames` counts those. */
export function myGames(records: readonly LibraryRecord[], identity: Identity): { games: MyGame[]; shortGames: number } {
  const games: MyGame[] = []
  let shortGames = 0
  for (const record of records) {
    const me = perspective(identity, record.players, record.source)
    const accuracy = me.kind === 'me' ? record.summary.accuracy[me.color] : null
    if (me.kind !== 'me' || accuracy === null) continue
    if (movesOutsideTheory(record.summary.counts[me.color]) < MIN_MOVES_OUTSIDE_THEORY) {
      shortGames++
      continue
    }
    // A pasted PGN often has no date; when it was reviewed is the best guess for when it was played.
    games.push({ record, color: me.color, accuracy, playedAt: record.playedAt ?? record.reviewedAt })
  }
  return { games: games.sort((a, b) => a.playedAt - b.playedAt), shortGames }
}

/** My accuracy per reviewed game, oldest first. */
export function accuracyHistory(records: readonly LibraryRecord[], identity: Identity): AccuracyHistory {
  const { games, shortGames } = myGames(records, identity)
  return {
    points: games.map(({ record, color, accuracy, playedAt }) => ({
      gameId: record.id,
      playedAt,
      color,
      accuracy,
      result: record.result,
      opponent: record.players[color === 'w' ? 'b' : 'w'],
      elo: estimateElo(accuracy, 'game'),
    })),
    shortGames,
  }
}

import { MIN_MOVES_OUTSIDE_THEORY, movesOutsideTheory, perspective, type AccuracyHistory, type AccuracyPoint, type Identity, type LibraryRecord } from '../domain'

/** My accuracy per reviewed game, oldest first. Games where I am not a player are left out, and so are games too short to say anything. */
export function accuracyHistory(records: readonly LibraryRecord[], identity: Identity): AccuracyHistory {
  const points: AccuracyPoint[] = []
  let shortGames = 0
  for (const r of records) {
    const me = perspective(identity, r.players, r.source)
    const accuracy = me.kind === 'me' ? r.summary.accuracy[me.color] : null
    if (me.kind !== 'me' || accuracy === null) continue
    if (movesOutsideTheory(r.summary.counts[me.color]) < MIN_MOVES_OUTSIDE_THEORY) {
      shortGames++
      continue
    }
    points.push({
      gameId: r.id,
      // A pasted PGN often has no date; when it was reviewed is the best guess for when it was played.
      playedAt: r.playedAt ?? r.reviewedAt,
      color: me.color,
      accuracy,
      result: r.result,
      opponent: r.players[me.color === 'w' ? 'b' : 'w'],
    })
  }
  return { points: points.sort((a, b) => a.playedAt - b.playedAt), shortGames }
}

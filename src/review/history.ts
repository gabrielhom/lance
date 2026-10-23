import { perspective, type AccuracyPoint, type Identity, type LibraryRecord } from '../domain'

/** My accuracy per reviewed game, oldest first. Games where I am not a player are left out. */
export function accuracyHistory(records: readonly LibraryRecord[], identity: Identity): readonly AccuracyPoint[] {
  return records
    .flatMap((r): AccuracyPoint[] => {
      const me = perspective(identity, r.players, r.source)
      const accuracy = me.kind === 'me' ? r.summary.accuracy[me.color] : null
      if (me.kind !== 'me' || accuracy === null) return []
      return [{
        gameId: r.id,
        // A pasted PGN often has no date; when it was reviewed is the best guess for when it was played.
        playedAt: r.playedAt ?? r.reviewedAt,
        color: me.color,
        accuracy,
        result: r.result,
        opponent: r.players[me.color === 'w' ? 'b' : 'w'],
      }]
    })
    .sort((a, b) => a.playedAt - b.playedAt)
}

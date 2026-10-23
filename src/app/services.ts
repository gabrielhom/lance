import { gameFromPgn, type Evaluator, type Services, type Settings } from '../domain'
import { createEvaluator, probeBridge, runtimeEnv } from '../engine'
import { fetchRecentGames, parsePgnText } from '../import'
import { loadBook } from '../openings'
import { accuracyHistory, reviewGame } from '../review'
import { loadSettings, openStore, saveSettings } from '../storage'

export async function createServices(): Promise<Services> {
  const store = await openStore()
  const env = runtimeEnv()
  const book = loadBook()
  // One evaluator per engine setup, so its warm workers survive between reviews and die when the settings change.
  let current: { key: string; evaluator: Evaluator } | null = null

  function evaluatorFor(s: Settings): Evaluator {
    const key = JSON.stringify([s.engine, s.limit, s.tuning])
    if (current?.key !== key) {
      current?.evaluator.dispose()
      current = { key, evaluator: createEvaluator(s.engine, s.limit, s.tuning, store.evals, env) }
    }
    return current.evaluator
  }

  return {
    loadSettings,
    saveSettings,
    runtimeEnv: () => env,
    library: store.library,
    parsePgnText,
    fetchRecentGames,
    gameFromRecord: (record) => gameFromPgn(record.pgn, record.source),
    async *reviewGame(game, signal) {
      const settings = loadSettings()
      const deps = { evaluator: evaluatorFor(settings), book: await book, identity: settings.identity, library: store.library }
      yield* reviewGame(game, deps, signal)
    },
    accuracyHistory,
    probeBridge,
  }
}

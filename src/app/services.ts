import { gameFromPgn, type Evaluator, type MovePicker, type Services, type Settings } from '../domain'
import { createEvaluator, createMovePicker, probeBridge, runtimeEnv } from '../engine'
import { fetchRecentGames, parsePgnText } from '../import'
import { loadBook } from '../openings'
import { loadPlay, savePlay } from '../play'
import { accuracyHistory, reviewGame } from '../review'
import { loadSettings, openStore, saveSettings } from '../storage'
import { backfill, checkAnswer } from '../training'

export async function createServices(): Promise<Services> {
  const store = await openStore({
    blocked: () => showNotice('Feche as outras abas do Lance para abrir esta. Elas usam uma versão antiga do app.'),
    stale: () => location.reload(),
    outdated: () => showNotice('Esta aba tem uma versão antiga do Lance. Recarregue a página para abrir a nova.'),
  })
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

  let picker: { key: string; picker: MovePicker } | null = null
  function pickerFor(s: Settings): MovePicker {
    const key = JSON.stringify([s.engine, s.tuning])
    if (picker?.key !== key) {
      picker?.picker.dispose()
      picker = { key, picker: createMovePicker(s.engine, s.tuning, env) }
    }
    return picker.picker
  }

  // Once per page, before the first list, so the counts include games reviewed before training existed.
  let backfilled: Promise<void> | null = null
  const ready = () =>
    (backfilled ??= book
      .then((b) => backfill({ ...store, book: b, identity: loadSettings().identity }, Date.now()))
      .catch((e: unknown) => console.warn('training backfill failed', e)))

  // A position off any review is searched ahead of the review queue, since someone is waiting on it.
  const evaluatePosition: Services['evaluatePosition'] = (p, signal) => evaluatorFor(loadSettings()).evaluate(p, signal, undefined, true)

  return {
    loadSettings,
    saveSettings,
    runtimeEnv: () => env,
    library: store.library,
    backup: store.backup,
    parsePgnText,
    fetchRecentGames,
    gameFromRecord: (record) => gameFromPgn(record.pgn, record.source),
    async *reviewGame(game, signal) {
      const settings = loadSettings()
      const deps = { evaluator: evaluatorFor(settings), book: await book, identity: settings.identity, library: store.library }
      yield* reviewGame(game, deps, signal)
    },
    evaluatePosition,
    accuracyHistory,
    probeBridge,
    engineMove: (input, level, signal) => pickerFor(loadSettings()).pick(input, level, signal),
    loadPlay,
    savePlay,
    training: {
      list: () => ready().then(() => store.training.list()),
      answer: (id, correct, now) => store.training.answer(id, correct, now),
      check: (item, move, signal) => checkAnswer(item, move, (p) => evaluatePosition(p, signal)),
    },
  }
}

/** Shown before React mounts; the first render replaces it. */
function showNotice(text: string) {
  const p = document.createElement('p')
  p.className = 'm-8 max-w-[40ch] text-lg'
  p.textContent = text
  document.getElementById('root')?.replaceChildren(p)
}

import { gameFromPgn, type Evaluator, type MovePicker, type Services, type Settings } from '../domain'
import { createEvaluator, createMovePicker, probeBridge, runtimeEnv } from '../engine'
import { fetchRecentGames, parsePgnText } from '../import'
import { loadBook, loadTree } from '../openings'
import { loadPlay, savePlay } from '../play'
import { loadPuzzles } from '../puzzles'
import { accuracyHistory, reviewGame } from '../review'
import { loadSettings, openStore, saveSettings } from '../storage'
import { backfill, checkAnswer } from '../training'

export async function createServices(): Promise<Services> {
  const store = await openStore({
    blocked: () => showNotice('Feche as outras abas do Lance para abrir esta. Elas usam uma versão antiga do app.'),
    stale: () => location.reload(),
    outdated: () => showNotice('Esta aba tem uma versão antiga do Lance. Recarregue a página para abrir a nova.', true),
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

  // Once per page, before the first list, so the counts and the reports include games reviewed before training and the
  // newer summary fields existed.
  let backfilled: Promise<void> | null = null
  const ready = () =>
    (backfilled ??= book
      .then((b) => backfill({ ...store, book: b, identity: loadSettings().identity }, Date.now()))
      .catch((e: unknown) => console.warn('backfill failed', e)))

  const puzzles: Services['puzzles'] = { list: once(loadPuzzles), attempts: () => store.puzzles.list(), record: (attempt) => store.puzzles.record(attempt) }
  const openings: Services['openings'] = {
    tree: once(loadTree),
    progress: () => store.openings.list(),
    record: (color, line, outcome, now) => store.openings.record(color, line, outcome, now),
  }

  // A position off any review is searched ahead of the review queue, since someone is waiting on it.
  const evaluatePosition: Services['evaluatePosition'] = (p, signal) => evaluatorFor(loadSettings()).evaluate(p, signal, undefined, true)

  return {
    loadSettings,
    saveSettings,
    runtimeEnv: () => env,
    library: { ...store.library, list: () => ready().then(() => store.library.list()) },
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
    puzzles,
    openings,
  }
}

/** Loaded once, on first use; a failed load (offline before the chunk was ever stored) is tried again next time. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null
  return () =>
    (p ??= load().catch((e: unknown) => {
      p = null
      throw e
    }))
}

/** Shown before React mounts; the first render replaces it. */
function showNotice(text: string, reload = false) {
  const p = document.createElement('p')
  p.className = 'm-8 max-w-[40ch] text-lg'
  p.textContent = text
  const root = document.getElementById('root')
  root?.replaceChildren(p)
  if (!reload) return
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'btn mx-8'
  b.textContent = 'Recarregar'
  b.onclick = () => location.reload()
  root?.append(b)
}

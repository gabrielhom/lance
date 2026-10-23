import transcripts from '../fixtures/sf19-transcripts.json'

/** Real Stockfish 19 output recorded by scripts/record-uci.mjs, native binary and lite-single WASM. */
export const TRANSCRIPTS = transcripts
export type Recorded = keyof typeof transcripts
export type ScenarioName = keyof typeof transcripts.lite.scenarios

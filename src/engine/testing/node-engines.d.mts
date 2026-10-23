import type { LineTransport } from '../transport'

export declare const NATIVE_STOCKFISH: string
export declare function hasNativeStockfish(): boolean
/** stockfish-19-lite-single.js loaded in this process through require('stockfish'), behind the LineTransport contract. */
export declare function liteSingleTransport(): LineTransport
/** Opens a WebSocket that claims `origin` and resolves with the close code. */
export declare function closeCodeWithOrigin(url: string, origin: string): Promise<number>

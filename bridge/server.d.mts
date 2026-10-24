export type BridgeConfig = {
  readonly port: number
  readonly origins: readonly string[]
  /** name -> absolute path of a UCI engine binary */
  readonly engines: ReadonlyMap<string, string>
  /** Concurrent engine processes allowed, default MAX_ENGINES. */
  readonly maxEngines?: number
  /** Where refusals are logged, default console.error. */
  readonly log?: (line: string) => void
}
export type Bridge = {
  readonly port: number
  readonly engines: readonly { readonly name: string; readonly idName: string }[]
  close(): Promise<void>
}
export declare const DEFAULT_ORIGINS: readonly string[]
export declare function parseArgs(argv: readonly string[]): { ok: true; value: BridgeConfig } | { ok: false; error: string }
export declare function serve(config: BridgeConfig): Promise<Bridge>
export declare const MAX_ENGINES: number
export declare const MAX_FRAME_BYTES: number

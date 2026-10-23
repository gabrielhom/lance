export type BridgeConfig = {
  readonly port: number
  readonly origins: readonly string[]
  /** name -> absolute path of a UCI engine binary */
  readonly engines: ReadonlyMap<string, string>
}
export type Bridge = {
  readonly port: number
  readonly engines: readonly { readonly name: string; readonly idName: string }[]
  close(): Promise<void>
}
export declare const DEFAULT_ORIGINS: readonly string[]
export declare function parseArgs(argv: readonly string[]): { ok: true; value: BridgeConfig } | { ok: false; error: string }
export declare function serve(config: BridgeConfig): Promise<Bridge>

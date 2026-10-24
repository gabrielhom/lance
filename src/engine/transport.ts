import { WASM_FLAVORS, type EngineDescriptor, type EngineFailureReason, type WasmFlavor } from '../domain/types'
import { bridgeEngineUrl } from './descriptor'

export type TransportEvent =
  | { readonly kind: 'line'; readonly line: string }
  | { readonly kind: 'loading'; readonly loaded: number; readonly total: number }
  | { readonly kind: 'closed'; readonly reason: EngineFailureReason }

/** A line pipe with no UCI knowledge. Events arrive asynchronously, `closed` at most once and last.
 *  Our own close() is silent. Call listen() before yielding to the event loop. */
export interface LineTransport {
  send(line: string): void
  listen(on: (e: TransportEvent) => void): void
  close(): void
}

export type Connect = (d: EngineDescriptor) => LineTransport

export const connect: Connect = (d) => (d.kind === 'wasm' ? workerTransport(d.flavor) : webSocketTransport(bridgeEngineUrl(d.url, d.name)))

/** The glue loads the .wasm next to the script and reports download progress on a port it is handed. */
function workerTransport(flavor: WasmFlavor): LineTransport {
  const worker = new Worker(`${import.meta.env.BASE_URL}engine/${import.meta.env.STOCKFISH_VERSION}/${WASM_FLAVORS[flavor].script}`)
  const progress = new MessageChannel()
  let on: (e: TransportEvent) => void = () => {}
  let open = true
  const shut = () => {
    open = false
    progress.port1.close()
    worker.terminate()
  }
  worker.onmessage = (e: MessageEvent<unknown>) => {
    if (open && typeof e.data === 'string') on({ kind: 'line', line: e.data })
  }
  worker.onerror = (e: ErrorEvent) => {
    e.preventDefault()
    if (!open) return
    shut()
    on({ kind: 'closed', reason: { kind: 'crashed', detail: e.message || 'the engine worker failed' } })
  }
  progress.port1.onmessage = (e: MessageEvent<{ loaded?: unknown; total?: unknown }>) => {
    const { loaded, total } = e.data
    if (open && typeof loaded === 'number' && typeof total === 'number') on({ kind: 'loading', loaded, total })
  }
  worker.postMessage({ progressPort: progress.port2 }, [progress.port2])
  return {
    send: (line) => {
      if (open) worker.postMessage(line)
    },
    listen: (f) => {
      on = f
    },
    close: () => {
      if (open) shut()
    },
  }
}

/** One frame per line each way. The bridge closes with 44xx when it refuses the origin or the engine name. */
function webSocketTransport(url: string | null): LineTransport {
  let on: (e: TransportEvent) => void = () => {}
  if (url === null) {
    queueMicrotask(() => on({ kind: 'closed', reason: { kind: 'unavailable', why: 'bridge-unreachable' } }))
    return {
      send: () => {},
      listen: (f) => {
        on = f
      },
      close: () => {
        on = () => {}
      },
    }
  }
  const ws = new WebSocket(url)
  const pending: string[] = []
  let opened = false
  let open = true
  ws.onopen = () => {
    opened = true
    for (const line of pending.splice(0)) ws.send(line)
  }
  ws.onmessage = (e: MessageEvent<unknown>) => {
    if (open && typeof e.data === 'string') on({ kind: 'line', line: e.data })
  }
  ws.onclose = (e: CloseEvent) => {
    if (!open) return
    open = false
    on({ kind: 'closed', reason: closeReason(e, opened) })
  }
  return {
    send: (line) => {
      if (!open) return
      if (opened) ws.send(line)
      else pending.push(line)
    },
    listen: (f) => {
      on = f
    },
    close: () => {
      if (!open) return
      open = false
      ws.close()
    },
  }
}

function closeReason(e: CloseEvent, opened: boolean): EngineFailureReason {
  if (e.code >= 4400 && e.code < 4500) return { kind: 'unavailable', why: 'bridge-refused' }
  if (!opened) return { kind: 'unavailable', why: 'bridge-unreachable' }
  return { kind: 'crashed', detail: `the bridge closed the connection (${e.code}${e.reason ? ` ${e.reason}` : ''})` }
}

import { useEffect, useRef, useState } from 'react'
import type { BridgeEngine, BridgeProbeError, EngineDescriptor, SearchLimit, Settings } from '../../domain/types'
import { WASM_FLAVORS } from '../../domain/types'
import { formatBytes } from '../format'
import { probeErrorText } from '../labels'
import { useServices, useSettings } from '../services'

const DEPTHS: readonly { depth: number; label: string; hint: string }[] = [
  { depth: 14, label: 'Rápida', hint: 'profundidade 14' },
  { depth: 18, label: 'Padrão', hint: 'profundidade 18' },
  { depth: 22, label: 'Profunda', hint: 'profundidade 22' },
]

type Probe = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ok'; engines: readonly BridgeEngine[] } | { kind: 'failed'; error: BridgeProbeError }

export function SettingsScreen() {
  const services = useServices()
  const [settings, save] = useSettings()
  const env = services.runtimeEnv()
  const update = (patch: Partial<Settings>) => save({ ...settings, ...patch })
  const account = (site: 'lichess' | 'chesscom') => settings.identity.accounts.find((a) => a.site === site)?.username ?? ''
  const advanced = useRef<HTMLDetailsElement>(null)
  const [advancedAtStart] = useState(settings.engine.kind === 'bridge')
  const setAccount = (site: 'lichess' | 'chesscom', username: string) => {
    const rest = settings.identity.accounts.filter((a) => a.site !== site)
    const u = username.trim()
    update({ identity: { accounts: u ? [...rest, { site, username: u }] : rest } })
  }

  return (
    <div className="flex flex-col gap-10 md:gap-12 max-w-[760px]">
      <header>
        <h1 className="display text-3xl md:text-5xl">Configurações</h1>
        <p className="dek">Tudo é salvo na hora.</p>
      </header>

      <section aria-labelledby="contas-titulo">
        <h2 id="contas-titulo" className="sec">Suas contas</h2>
        <div className="ruled flex flex-col gap-4">
          <p className="text-ink-2">Com seus nomes de usuário o app sabe de que lado você jogou e destaca sua precisão.</p>
          <div className="grid sm:grid-cols-2 gap-5">
            <AccountField site="lichess" label="Lichess" value={account('lichess')} onCommit={(v) => setAccount('lichess', v)} />
            <AccountField site="chesscom" label="Chess.com" value={account('chesscom')} onCommit={(v) => setAccount('chesscom', v)} />
          </div>
        </div>
      </section>

      <section aria-labelledby="engine-titulo">
        <h2 id="engine-titulo" className="sec">Engine</h2>
        <fieldset className="options">
          <legend className="sr-only">Qual engine analisa as partidas</legend>
          <EngineOption
            checked={settings.engine.kind === 'wasm' && settings.engine.flavor === 'lite'}
            onSelect={() => update({ engine: { kind: 'wasm', flavor: 'lite' } })}
            title="Stockfish 19 Lite"
            detail={`Roda no navegador, download de ${formatBytes(WASM_FLAVORS.lite.bytes)}. Funciona em qualquer aparelho.`}
          />
          <EngineOption
            checked={settings.engine.kind === 'wasm' && settings.engine.flavor === 'full'}
            onSelect={() => update({ engine: { kind: 'wasm', flavor: 'full' } })}
            title="Stockfish 19 Completo"
            detail={`Mais forte e mais pesado, download de ${formatBytes(WASM_FLAVORS.full.bytes)}.`}
            warning={env.crossOriginIsolated ? null : 'Não carrega nesta página. Veja Avançado.'}
          />
          <EngineOption
            checked={settings.engine.kind === 'bridge'}
            onSelect={() => {
              if (advanced.current) advanced.current.open = true
              update({ engine: settings.engine.kind === 'bridge' ? settings.engine : { kind: 'bridge', url: 'http://127.0.0.1:7777', name: '', idName: '' } })
            }}
            title="Engine local via bridge"
            detail="Usa uma engine instalada no seu computador. A conexão fica em Avançado."
          />
        </fieldset>
      </section>

      <section aria-labelledby="analise-titulo">
        <h2 id="analise-titulo" className="sec">Análise</h2>
        <p className="sr-only" id="prof-label">Profundidade</p>
        <div className="choices" role="radiogroup" aria-labelledby="prof-label">
          {DEPTHS.map((d) => (
            <button key={d.depth} type="button" role="radio" className="choice" aria-checked={isDepth(settings.limit, d.depth)} onClick={() => update({ limit: { kind: 'depth', depth: d.depth } })} title={d.hint}>
              {d.label} <span className="num text-ink-3 font-normal">{d.depth}</span>
            </button>
          ))}
        </div>
        <p className="caption mt-2">Profundidade da busca em cada posição. Mais profundidade, análise mais precisa e mais demorada.</p>
      </section>

      <details ref={advanced} open={advancedAtStart} className="advanced">
        <summary>
          <h2 className="sec inline">Avançado</h2>
        </summary>
        <div className="ruled flex flex-col gap-8 mt-2">
          <div className="flex flex-col gap-2">
            <h3 className="font-serif font-semibold text-md">Engine local</h3>
            {settings.engine.kind === 'bridge' ? (
              <BridgeFields engine={settings.engine} onChange={(engine) => update({ engine })} />
            ) : (
              <p className="text-ink-2">Escolha "Engine local via bridge" acima para conectar um Stockfish instalado no computador.</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="font-serif font-semibold text-md">Desempenho</h3>
            <div className="grid sm:grid-cols-2 gap-5">
              <NumberField
                id="engines"
                label="Engines em paralelo"
                value={settings.tuning.engines}
                min={1}
                max={Math.max(1, env.cores)}
                onCommit={(v) => update({ tuning: { ...settings.tuning, engines: v } })}
                hint={`Seu computador tem ${env.cores} núcleos. Só vale para o Lite.`}
              />
              <NumberField
                id="threads"
                label="Threads por engine"
                value={settings.tuning.threadsPerEngine}
                min={1}
                max={Math.max(1, env.cores)}
                onCommit={(v) => update({ tuning: { ...settings.tuning, threadsPerEngine: v } })}
                hint="Só vale para o Completo e para o bridge."
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="font-serif font-semibold text-md">Isolamento de origem</h3>
            <p className="text-ink-2">
              O Completo usa várias threads, e o navegador só libera isso numa página com isolamento de origem (cabeçalhos COOP e COEP). O servidor do projeto já envia os dois.
            </p>
            <p className="font-semibold">
              {env.crossOriginIsolated ? 'Esta página está isolada.' : 'Esta página não está isolada, então use o Lite ou o bridge.'}
            </p>
          </div>
        </div>
      </details>
    </div>
  )
}

function isDepth(limit: SearchLimit, depth: number) {
  return limit.kind === 'depth' && limit.depth === depth
}

function EngineOption({ checked, onSelect, title, detail, warning }: { checked: boolean; onSelect: () => void; title: string; detail: string; warning?: string | null }) {
  return (
    <label className="option">
      <input type="radio" name="engine" checked={checked} onChange={onSelect} />
      <span className="title">{title}</span>
      <span className="block text-sm text-ink-2">{detail}</span>
      {warning && <span className="block text-sm font-semibold italic mt-1">{warning}</span>}
    </label>
  )
}

function BridgeFields({ engine, onChange }: { engine: Extract<EngineDescriptor, { kind: 'bridge' }>; onChange: (e: EngineDescriptor) => void }) {
  const services = useServices()
  const [url, setUrl] = useState(engine.url)
  const [probe, setProbe] = useState<Probe>({ kind: 'idle' })
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  const test = () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setProbe({ kind: 'loading' })
    services.probeBridge(url.trim(), ac.signal).then((r) => {
      if (ac.signal.aborted) return
      if (r.ok) {
        setProbe({ kind: 'ok', engines: r.value })
        const keep = r.value.find((e) => e.name === engine.name) ?? r.value[0]
        onChange({ kind: 'bridge', url: url.trim(), name: keep?.name ?? '', idName: keep?.idName ?? '' })
      } else setProbe({ kind: 'failed', error: r.error })
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="label" htmlFor="bridge-url">URL do bridge</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input id="bridge-url" className="field" value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => url.trim() !== engine.url && onChange({ ...engine, url: url.trim() })} spellCheck={false} inputMode="url" />
          <button type="button" className="btn" onClick={test} disabled={probe.kind === 'loading' || !url.trim()}>
            {probe.kind === 'loading' ? 'Testando…' : 'Testar'}
          </button>
        </div>
      </div>
      <div aria-live="polite">
        {probe.kind === 'ok' && (
          <div className="flex flex-col gap-2">
            <p className="font-semibold">
              Bridge respondeu com {probe.engines.length === 1 ? '1 engine' : `${probe.engines.length} engines`}
            </p>
            <fieldset>
              <legend className="label">Engine a usar</legend>
              <div className="flex flex-col gap-1">
                {probe.engines.map((e) => (
                  <label key={e.name} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="bridge-engine" className="accent-(--accent)" checked={engine.name === e.name} onChange={() => onChange({ ...engine, url: url.trim(), name: e.name, idName: e.idName })} />
                    <span className="font-medium">{e.name}</span>
                    <span className="text-ink-3">{e.idName}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}
        {probe.kind === 'failed' && (
          <p className="font-semibold" role="alert">
            {probeErrorText(probe.error)}
          </p>
        )}
        {probe.kind === 'idle' && engine.idName && <p className="caption">Engine salva: {engine.name} ({engine.idName})</p>}
      </div>
      <div>
        <p className="label">Para iniciar o bridge</p>
        <pre className="bg-paper-2 border-l-2 border-rule-strong px-3 py-2 text-xs whitespace-pre-wrap break-all"><code>npm run bridge -- --engine sf19=/caminho/para/stockfish</code></pre>
        <p className="caption mt-1.5">Troque o caminho pelo binário da sua engine. Pode repetir --engine para registrar mais de uma.</p>
      </div>
    </div>
  )
}

/** A text draft that follows its prop until the user types, without an effect. */
function useDraft(value: string): [string, (v: string) => void] {
  const [draft, setDraft] = useState({ base: value, v: value })
  return [draft.base === value ? draft.v : value, (v: string) => setDraft({ base: value, v })]
}

function AccountField({ site, label, value, onCommit }: { site: string; label: string; value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useDraft(value)
  return (
    <div>
      <label className="label" htmlFor={`acc-${site}`}>{label}</label>
      <input id={`acc-${site}`} className="field" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() !== value && onCommit(v)} autoComplete="username" autoCapitalize="off" spellCheck={false} placeholder="nome de usuário" />
    </div>
  )
}

function NumberField({ id, label, value, min, max, onCommit, hint }: { id: string; label: string; value: number; min: number; max: number; onCommit: (v: number) => void; hint: string }) {
  const [v, setV] = useDraft(String(value))
  const commit = () => {
    const n = Math.round(Number(v))
    if (!Number.isFinite(n)) return setV(String(value))
    const clamped = Math.max(min, Math.min(max, n))
    setV(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="field max-w-32" type="number" inputMode="numeric" min={min} max={max} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} />
      <p className="caption mt-1.5">{hint}</p>
    </div>
  )
}

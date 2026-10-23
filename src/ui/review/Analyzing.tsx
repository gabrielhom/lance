import type { EngineFailureReason, ReviewState } from '../../domain/types'
import { formatBytes } from '../format'
import { engineFailureText } from '../labels'

type Analyzing = Extract<ReviewState, { phase: 'analyzing' }>

export function AnalyzingPanel({ state, onCancel }: { state: Analyzing | null; onCancel: () => void }) {
  const pct = state ? Math.round(Math.min(1, Math.max(0, state.progress)) * 100) : 0
  const engine = state?.engine
  const line =
    !state ? 'Preparando a análise…'
    : engine?.kind === 'loading' ? `Baixando a engine · ${formatBytes(engine.loaded)} de ${formatBytes(engine.total)}`
    : engine?.kind === 'searching' ? `Avaliando posição ${Math.min(state.done + 1, state.total)} de ${state.total}`
    : 'Lendo avaliações já salvas'
  return (
    <section className="flex flex-col gap-3" aria-labelledby="analise-titulo" aria-live="polite">
      <div className="flex items-center gap-2">
        <h2 id="analise-titulo" className="text-[16px] font-semibold">Analisando a partida</h2>
        <span className="ml-auto text-[20px] font-semibold tabular">{pct}%</span>
      </div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progresso da análise">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="hint">{line}</p>
      <div>
        <button type="button" className="btn btn-sm" onClick={onCancel}>Cancelar</button>
      </div>
    </section>
  )
}

export function FailedPanel({ failure, onRetry }: { failure: EngineFailureReason; onRetry: () => void }) {
  const t = engineFailureText(failure)
  return (
    <section className="flex flex-col gap-3" role="alert">
      <div>
        <div>
          <h2 className="text-[16px] font-semibold">{t.title}</h2>
          <p className="text-[14px] text-ink-2 mt-1">{t.detail}</p>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button type="button" className="btn btn-primary btn-sm" onClick={onRetry}>Tentar de novo</button>
        <a href="#/config" className="btn btn-sm">Configurações</a>
      </div>
    </section>
  )
}

export function CancelledPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="flex flex-col gap-3" role="status">
      <h2 className="text-[16px] font-semibold">Análise cancelada</h2>
      <p className="hint">Você ainda pode percorrer os lances. As avaliações aparecem quando a análise terminar.</p>
      <div>
        <button type="button" className="btn btn-primary btn-sm" onClick={onRetry}>Analisar</button>
      </div>
    </section>
  )
}

import type { EngineFailureReason, ReviewState } from '../../domain/types'
import { estimateSecondsLeft, formatBytes, formatTimeLeft } from '../format'
import { engineFailureText } from '../labels'
import type { Pace } from './runs'

type Analyzing = Extract<ReviewState, { phase: 'analyzing' }>

export function AnalyzingPanel({ state, pace, onCancel }: { state: Analyzing | null; pace: Pace | undefined; onCancel: () => void }) {
  const pct = state ? Math.round(Math.min(1, Math.max(0, state.progress)) * 100) : 0
  const engine = state?.engine
  const seconds = state && pace ? estimateSecondsLeft(pace.first, pace.now, state.total) : null
  const left = engine?.kind === 'searching' && seconds !== null ? formatTimeLeft(seconds) : null
  const line =
    !state ? 'Preparando a análise…'
    : engine?.kind === 'loading' ? `Baixando a engine, ${formatBytes(engine.loaded)} de ${formatBytes(engine.total)}`
    : engine?.kind === 'searching' ? `Avaliando a posição ${Math.min(state.done + 1, state.total)} de ${state.total}${left ? `, ${left}` : ''}`
    : 'Lendo avaliações já salvas'
  return (
    <section className="status" aria-labelledby="analise-titulo" aria-live="polite">
      <div className="flex items-baseline gap-4">
        <h2 id="analise-titulo" className="font-serif font-semibold text-lg">Analisando a partida</h2>
        <span className="num ml-auto text-2xl">{pct}%</span>
      </div>
      <div className="meter mt-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progresso da análise">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-baseline justify-between gap-4 mt-2">
        <p className="caption">{line}</p>
        <button type="button" className="tl tl-quiet" onClick={onCancel}>Cancelar</button>
      </div>
    </section>
  )
}

export function FailedPanel({ failure, onRetry }: { failure: EngineFailureReason; onRetry: () => void }) {
  const t = engineFailureText(failure)
  return (
    <section className="status note" role="alert">
      <h2 className="font-serif font-semibold text-lg">{t.title}</h2>
      <p className="text-ink-2">{t.detail}</p>
      <div className="flex flex-wrap items-center gap-6 mt-3">
        <button type="button" className="btn" onClick={onRetry}>Tentar de novo</button>
        <a href="#/config" className="tl">Configurações</a>
      </div>
    </section>
  )
}

export function CancelledPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="status note" role="status">
      <h2 className="font-serif font-semibold text-lg">Análise cancelada</h2>
      <p className="text-ink-2">Você ainda pode percorrer os lances. As avaliações aparecem quando a análise terminar.</p>
      <div className="mt-3">
        <button type="button" className="btn" onClick={onRetry}>Analisar</button>
      </div>
    </section>
  )
}

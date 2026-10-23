import { useEffect, useState } from 'react'

export function CopyPgn({ pgn, className = 'tl tl-quiet' }: { pgn: string; className?: string }) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  useEffect(() => {
    if (copied === 'idle') return
    const t = setTimeout(() => setCopied('idle'), 2500)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <button
      type="button"
      className={className}
      onClick={() => (navigator.clipboard?.writeText(pgn) ?? Promise.reject(new Error('sem área de transferência'))).then(() => setCopied('done'), () => setCopied('failed'))}
    >
      <span aria-live="polite">{copied === 'done' ? 'PGN copiado' : copied === 'failed' ? 'Não deu para copiar' : 'Copiar PGN'}</span>
    </button>
  )
}

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { href, useRoute } from '../router'
import type { Route } from '../router'
import { nextTheme, setTheme, useTheme } from '../theme'
import type { Theme } from '../theme'

const NAV: readonly { route: Route; label: string }[] = [
  { route: { name: 'play' }, label: 'Jogar' },
  { route: { name: 'import' }, label: 'Revisar' },
  { route: { name: 'history' }, label: 'Histórico' },
  { route: { name: 'settings' }, label: 'Configurações' },
]

const THEME_LABEL: Readonly<Record<Theme, string>> = { system: 'Tema: automático', light: 'Tema: claro', dark: 'Tema: escuro' }

export function AppShell({ children }: { children: ReactNode }) {
  const route = useRoute()
  const theme = useTheme()
  const current = route.name === 'review' ? 'import' : route.name
  // Hash routing keeps the scroll offset of the previous screen, which lands a new screen mid-page.
  const where = route.name === 'review' ? `review:${route.id}` : route.name
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [where])
  return (
    <div className="min-h-dvh flex flex-col">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 btn btn-primary">
        Ir para o conteúdo
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex flex-wrap max-w-[1400px] items-center gap-2 px-4 min-h-14">
          <a href="#/" className="font-semibold text-[17px] text-ink mr-2">
            Lance
          </a>
          <nav aria-label="Principal" className="flex flex-wrap items-center gap-1">
            {NAV.map(({ route: r, label }) => (
              <a key={r.name} href={href(r)} className="nav-link" aria-current={current === r.name ? 'page' : undefined}>
                {label}
              </a>
            ))}
          </nav>
          <button type="button" className="btn btn-ghost ml-auto" onClick={() => setTheme(nextTheme(theme))}>
            {THEME_LABEL[theme]}
          </button>
        </div>
      </header>
      <main id="conteudo" className="mx-auto w-full max-w-[1400px] px-4 py-6 flex-1">
        {children}
      </main>
    </div>
  )
}

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { href, useRoute } from '../router'
import type { Route } from '../router'
import { setTheme, useTheme } from '../theme'
import { useMediaQuery } from '../useMediaQuery'

const NAV: readonly { route: Route; label: string }[] = [
  { route: { name: 'play' }, label: 'Jogar' },
  { route: { name: 'import' }, label: 'Revisar' },
  { route: { name: 'history' }, label: 'Histórico' },
  { route: { name: 'settings' }, label: 'Configurações' },
]

export function AppShell({ children }: { children: ReactNode }) {
  const route = useRoute()
  const current = route.name === 'review' ? 'import' : route.name
  // Hash routing keeps the scroll offset of the previous screen, which lands a new screen mid-page.
  const where = route.name === 'review' ? `review:${route.id}` : route.name
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [where])
  return (
    <div className="min-h-dvh flex flex-col">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 btn">
        Ir para o conteúdo
      </a>
      <header className="mx-auto w-full max-w-page px-4 md:px-10">
        <div className="mast">
          <a href="#/" className="wordmark">Lance</a>
          <nav aria-label="Principal" className="nav">
            {NAV.map(({ route: r, label }) => (
              <a key={r.name} href={href(r)} aria-current={current === r.name ? 'page' : undefined}>
                {label}
              </a>
            ))}
          </nav>
          <ThemeToggle />
        </div>
      </header>
      <main id="conteudo" className="mx-auto w-full max-w-page px-4 md:px-10 pt-4 pb-14 md:pt-7 md:pb-18 flex-1">
        {children}
      </main>
    </div>
  )
}

/** Flips what is on screen. Landing back on the system's own choice clears the override, so the app follows the system again. */
function ThemeToggle() {
  const theme = useTheme()
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  const toggle = () => {
    const next = dark ? 'light' : 'dark'
    setTheme(next === (systemDark ? 'dark' : 'light') ? 'system' : next)
  }
  return (
    <button type="button" className="theme-toggle" onClick={toggle}>
      {dark ? 'Tema claro' : 'Tema escuro'}
    </button>
  )
}

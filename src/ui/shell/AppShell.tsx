import { History, Monitor, Moon, ScanSearch, Settings, Sun, Swords } from 'lucide-react'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { href, useRoute } from '../router'
import type { Route } from '../router'
import { nextTheme, setTheme, useTheme } from '../theme'
import type { Theme } from '../theme'

const NAV: readonly { route: Route; label: string; icon: typeof Swords }[] = [
  { route: { name: 'play' }, label: 'Jogar', icon: Swords },
  { route: { name: 'import' }, label: 'Revisar', icon: ScanSearch },
  { route: { name: 'history' }, label: 'Histórico', icon: History },
  { route: { name: 'settings' }, label: 'Configurações', icon: Settings },
]

const THEME_ICON: Readonly<Record<Theme, typeof Sun>> = { system: Monitor, light: Sun, dark: Moon }
const THEME_LABEL: Readonly<Record<Theme, string>> = { system: 'Tema: automático', light: 'Tema: claro', dark: 'Tema: escuro' }

export function AppShell({ children }: { children: ReactNode }) {
  const route = useRoute()
  const theme = useTheme()
  const ThemeIcon = THEME_ICON[theme]
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
      <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-2 px-4 h-14">
          <a href="#/" className="flex items-center gap-2 font-semibold text-[17px] tracking-tight text-ink mr-2 rounded-md">
            <img src="/favicon.svg" alt="" width={22} height={21} />
            Lance
          </a>
          <nav aria-label="Principal" className="hidden sm:flex items-center gap-1">
            {NAV.map(({ route: r, label, icon: Icon }) => (
              <a key={r.name} href={href(r)} className="nav-link" aria-current={current === r.name ? 'page' : undefined}>
                <Icon size={16} aria-hidden />
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto">
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => setTheme(nextTheme(theme))} aria-label={THEME_LABEL[theme]} title={THEME_LABEL[theme]}>
              <ThemeIcon size={18} aria-hidden />
            </button>
          </div>
        </div>
      </header>
      <main id="conteudo" className="mx-auto w-full max-w-[1400px] px-4 py-6 pb-24 sm:pb-8 flex-1">
        {children}
      </main>
      <nav aria-label="Principal" className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-surface flex justify-around px-2 pb-[env(safe-area-inset-bottom)]">
        {NAV.map(({ route: r, label, icon: Icon }) => (
          <a key={r.name} href={href(r)} className="nav-link flex-col gap-0.5 py-2 min-w-18 text-[12px]" aria-current={current === r.name ? 'page' : undefined}>
            <Icon size={20} aria-hidden />
            {label}
          </a>
        ))}
      </nav>
    </div>
  )
}

import { HistoryScreen } from './ui/history/HistoryScreen'
import { HomeScreen } from './ui/home/HomeScreen'
import { ReviewScreen } from './ui/review/ReviewScreen'
import { useRoute } from './ui/router'
import { SettingsScreen } from './ui/settings/SettingsScreen'
import { AppShell } from './ui/shell/AppShell'

export default function App() {
  const route = useRoute()
  return (
    <AppShell>
      {route.name === 'home' && <HomeScreen />}
      {route.name === 'review' && <ReviewScreen key={route.id} id={route.id} />}
      {route.name === 'history' && <HistoryScreen />}
      {route.name === 'settings' && <SettingsScreen />}
    </AppShell>
  )
}

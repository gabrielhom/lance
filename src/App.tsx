import { HistoryScreen } from './ui/history/HistoryScreen'
import { ImportScreen } from './ui/import/ImportScreen'
import { PlayScreen } from './ui/play/PlayScreen'
import { ReviewScreen } from './ui/review/ReviewScreen'
import { useRoute } from './ui/router'
import { SettingsScreen } from './ui/settings/SettingsScreen'
import { AppShell } from './ui/shell/AppShell'
import { TrainingScreen } from './ui/training/TrainingScreen'

export default function App() {
  const route = useRoute()
  return (
    <AppShell>
      {route.name === 'play' && <PlayScreen />}
      {route.name === 'import' && <ImportScreen />}
      {route.name === 'review' && <ReviewScreen key={route.id} id={route.id} ply={route.ply} />}
      {route.name === 'training' && <TrainingScreen key={route.game} game={route.game} />}
      {route.name === 'history' && <HistoryScreen />}
      {route.name === 'settings' && <SettingsScreen />}
    </AppShell>
  )
}

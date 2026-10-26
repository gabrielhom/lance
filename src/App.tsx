import { HistoryScreen } from './ui/history/HistoryScreen'
import { WeaknessesScreen } from './ui/history/WeaknessesScreen'
import { ImportScreen } from './ui/import/ImportScreen'
import { PlayScreen } from './ui/play/PlayScreen'
import { ReviewScreen } from './ui/review/ReviewScreen'
import { useRoute } from './ui/router'
import { SettingsScreen } from './ui/settings/SettingsScreen'
import { AppShell } from './ui/shell/AppShell'
import { OpeningScreen } from './ui/training/OpeningScreen'
import { OpeningsScreen } from './ui/training/OpeningsScreen'
import { PuzzleScreen } from './ui/training/PuzzleScreen'
import { TrainingModes } from './ui/training/TrainingModes'
import { TrainingScreen } from './ui/training/TrainingScreen'

export default function App() {
  const route = useRoute()
  return (
    <AppShell>
      {route.name === 'play' && <PlayScreen />}
      {route.name === 'import' && <ImportScreen />}
      {route.name === 'review' && <ReviewScreen key={route.id} id={route.id} ply={route.ply} />}
      {route.name === 'training' && (
        <>
          {route.games.length === 0 && <TrainingModes current="mistakes" />}
          <TrainingScreen key={route.games.join(',')} games={route.games} />
        </>
      )}
      {route.name === 'puzzles' && (
        <>
          <TrainingModes current="puzzles" />
          <PuzzleScreen />
        </>
      )}
      {route.name === 'openings' && (
        <>
          <TrainingModes current="openings" />
          <OpeningsScreen />
        </>
      )}
      {route.name === 'opening' && <OpeningScreen key={`${route.family}|${route.color}`} family={route.family} color={route.color} group={route.group} />}
      {route.name === 'history' && <HistoryScreen />}
      {route.name === 'weaknesses' && <WeaknessesScreen />}
      {route.name === 'settings' && <SettingsScreen />}
    </AppShell>
  )
}

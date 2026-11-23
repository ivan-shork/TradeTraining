import { useState } from 'react'
import Home from './pages/Home'
import Training from './pages/Training'
import SettlementView from './pages/SettlementView'
import ReplayCenter from './pages/ReplayCenter'
import SettingsPage from './pages/SettingsPage'
import type { SessionConfig, NewSessionView } from '@shared/types'

export type Route =
  | { page: 'home' }
  | { page: 'training'; session: NewSessionView['session']; klines: NewSessionView['klines']; config: SessionConfig }
  | { page: 'settlement'; sessionId: number; backTo: 'training' | 'replay' }
  | { page: 'replay' }
  | { page: 'settings' }

export default function App() {
  const [route, setRoute] = useState<Route>({ page: 'home' })

  return (
    <div className="app">
      {route.page === 'home' && <Home go={setRoute} />}
      {route.page === 'training' && (
        <Training
          route={route}
          go={setRoute}
        />
      )}
      {route.page === 'settlement' && (
        <SettlementView sessionId={route.sessionId} backTo={route.backTo} go={setRoute} />
      )}
      {route.page === 'replay' && <ReplayCenter go={setRoute} />}
      {route.page === 'settings' && <SettingsPage go={setRoute} />}
    </div>
  )
}

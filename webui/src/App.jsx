import { BrowserRouter } from 'react-router-dom'
import { AppRouter } from './router'
import { ToastProvider } from './hooks/useToast'

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <div className="noise-bg min-h-screen bg-gradient-to-br from-surface-900 via-surface-800 to-surface-900">
          <AppRouter />
        </div>
      </ToastProvider>
    </BrowserRouter>
  )
}

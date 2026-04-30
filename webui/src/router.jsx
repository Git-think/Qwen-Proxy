import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Chat from './pages/Chat'
import Admin from './pages/Admin'
import Docs from './pages/Docs'
import Vercel from './pages/Vercel'
import Login from './pages/Login'
import { getApiKey } from './utils/storage'

function ProtectedRoute({ children }) {
  const apiKey = getApiKey()
  if (!apiKey) {
    return <Navigate to="/login" replace />
  }
  return children
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/chat" replace />} />
        <Route path="chat" element={<Chat />} />
        <Route path="admin" element={<Admin />} />
        <Route path="docs" element={<Docs />} />
        <Route path="vercel" element={<Vercel />} />
      </Route>
      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  )
}

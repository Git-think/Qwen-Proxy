import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setApiKey } from '../utils/storage'
import { verifyKey } from '../utils/api'

export default function Login() {
  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!key.trim()) {
      setError('请输入 API 密钥')
      return
    }

    setLoading(true)
    setError('')

    try {
      const valid = await verifyKey(key.trim())
      if (valid) {
        setApiKey(key.trim())
        navigate('/chat')
      } else {
        setError('API 密钥无效')
      }
    } catch {
      // If verify endpoint doesn't exist, just save the key
      setApiKey(key.trim())
      navigate('/chat')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent-primary/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent-secondary/5 rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-md relative">
        {/* Logo */}
        <div className="text-center mb-8 animate-fade-in">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-primary to-accent-secondary mb-4 shadow-lg shadow-accent-primary/20">
            <span className="text-2xl font-bold text-white">Q</span>
          </div>
          <h1 className="text-3xl font-display font-bold text-white">Qwen2API</h1>
          <p className="mt-2 text-slate-400 text-sm">输入 API 密钥以继续</p>
        </div>

        {/* Login card */}
        <form
          onSubmit={handleSubmit}
          className="glass-strong p-8 animate-slide-up"
        >
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                API 密钥
              </label>
              <input
                type="password"
                value={key}
                onChange={(e) => { setKey(e.target.value); setError('') }}
                placeholder="sk-..."
                className="input-field font-mono text-sm"
                autoFocus
              />
              {error && (
                <p className="mt-2 text-xs text-red-400 animate-fade-in">{error}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                   验证中...
                </span>
              ) : (
                '登录'
              )}
            </button>
          </div>

          <div className="mt-6 pt-5 border-t border-white/[0.06]">
            <p className="text-xs text-slate-500 text-center">
              API 密钥仅存储在本地，不会发送给第三方。
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}

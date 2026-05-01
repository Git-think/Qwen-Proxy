import { useState, useEffect, useCallback } from 'react'
import { getApiKey } from '../utils/storage'
import { API_ENDPOINTS } from '../utils/constants'
import { useToast } from '../hooks/useToast'

function fetchWithAuth(url, options = {}) {
  const key = getApiKey()
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      ...options.headers,
    },
  })
}

export default function Vercel() {
  const [status, setStatus] = useState(null)
  const [envs, setEnvs] = useState([])
  const [loading, setLoading] = useState(true)
  const [deploying, setDeploying] = useState(false)
  const [visibleValues, setVisibleValues] = useState({})
  const [editingEnv, setEditingEnv] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [quickForm, setQuickForm] = useState({ API_KEY: '', ACCOUNTS: '', DATA_SAVE_MODE: '' })
  const { toast } = useToast()

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetchWithAuth(API_ENDPOINTS.VERCEL_STATUS)
      const data = await res.json()
      setStatus(data)
    } catch {
      setStatus(null)
    }
  }, [])

  const loadEnvs = useCallback(async () => {
    try {
      const res = await fetchWithAuth(API_ENDPOINTS.VERCEL_ENV)
      if (res.ok) {
        const data = await res.json()
        setEnvs(data.envs || [])
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
    loadEnvs()
  }, [loadStatus, loadEnvs])

  const toggleVisibility = (id) => {
    setVisibleValues(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const handleEdit = (env) => {
    setEditingEnv(env)
    setEditValue(env.value)
  }

  const handleSaveEdit = async () => {
    if (!editingEnv) return
    try {
      const res = await fetchWithAuth(API_ENDPOINTS.VERCEL_ENV, {
        method: 'POST',
        body: JSON.stringify({ key: editingEnv.key, value: editValue }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`已更新 ${editingEnv.key}`)
        setEditingEnv(null)
        loadEnvs()
      } else {
        toast.error(data.error || '更新失败')
      }
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleQuickSave = async (key) => {
    const value = quickForm[key]
    if (!value.trim()) return
    try {
      const res = await fetchWithAuth(API_ENDPOINTS.VERCEL_ENV, {
        method: 'POST',
        body: JSON.stringify({ key, value: value.trim() }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`已更新 ${key}`)
        setQuickForm(prev => ({ ...prev, [key]: '' }))
        loadEnvs()
      } else {
        toast.error(data.error || '更新失败')
      }
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleRedeploy = async () => {
    setDeploying(true)
    try {
      const res = await fetchWithAuth(API_ENDPOINTS.VERCEL_REDEPLOY, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        toast.success(`部署已触发，URL: ${data.url}`)
      } else {
        toast.error(data.error || '部署失败')
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setDeploying(false)
    }
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          加载中...
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen overflow-y-auto p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 animate-fade-in">
          <div>
            <h1 className="text-2xl font-display font-bold text-white flex items-center gap-3">
              <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L2 19.5h20L12 2z" />
              </svg>
              Vercel 同步
            </h1>
            <p className="mt-1 text-sm text-slate-400">管理 Vercel 环境变量与部署</p>
          </div>
          <button
            onClick={handleRedeploy}
            disabled={deploying || !status?.configured}
            className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50"
          >
            {deploying ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                部署中...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                重新部署
              </>
            )}
          </button>
        </div>

        {/* Status Card */}
        <div className="glass-card p-5 mb-6 animate-slide-up">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${status?.configured ? 'bg-emerald-400' : 'bg-red-400'}`} />
            连接状态
          </h3>
          {status?.configured ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-400">Token:</span>
                <span className="text-emerald-400">已配置</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-400">Project ID:</span>
                <span className="text-emerald-400">已配置</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-400">Team ID:</span>
                <span className={status?.hasTeamId ? 'text-emerald-400' : 'text-slate-500'}>
                  {status?.hasTeamId ? '已配置' : '未配置（个人账号）'}
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-red-300">未配置 Vercel 连接，请在 Vercel Dashboard 项目设置中添加以下环境变量后重新部署：</p>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded ${status?.hasToken ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                    VERCEL_TOKEN
                  </span>
                  <span className="text-slate-500">— 在 <a href="https://vercel.com/account/tokens" target="_blank" rel="noreferrer" className="text-accent-glow hover:underline">vercel.com/account/tokens</a> 创建 Personal Token</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded ${status?.hasProjectId ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                    VERCEL_PROJECT_ID
                  </span>
                  <span className="text-slate-500">— 项目 Settings → General → Project ID（Vercel 不在 runtime 自动注入此变量，必须手动配置）</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-slate-500/15 text-slate-400">
                    VERCEL_TEAM_ID
                  </span>
                  <span className="text-slate-500">— 仅团队账户需要；个人账户留空</span>
                </div>
              </div>
              <div className="mt-4 p-3 rounded-lg bg-amber-500/[0.08] border border-amber-500/[0.15] text-xs text-amber-200/90 leading-relaxed">
                <div className="font-semibold mb-1">配置步骤：</div>
                <ol className="space-y-0.5 list-decimal list-inside">
                  <li>在 Vercel Dashboard 打开本项目 → Settings → Environment Variables</li>
                  <li>添加上述变量（至少 VERCEL_TOKEN 和 VERCEL_PROJECT_ID），三个 target 全选</li>
                  <li>回到 Deployments → 最新一条 → Redeploy</li>
                  <li>页面刷新后即可在此管理所有环境变量并触发重新部署</li>
                </ol>
              </div>
            </div>
          )}
        </div>

        {/* Quick Settings */}
        {status?.configured && (
          <div className="glass-card p-5 mb-6 animate-slide-up animate-delay-100">
            <h3 className="text-sm font-semibold text-white mb-4">快速设置</h3>
            <div className="space-y-3">
              {[
                { key: 'API_KEY', placeholder: 'API 密钥（逗号分隔多个）', type: 'password' },
                { key: 'ACCOUNTS', placeholder: '账号（email:password，逗号分隔）', type: 'password' },
                { key: 'DATA_SAVE_MODE', placeholder: 'none 或 file', type: 'text' },
              ].map(({ key, placeholder, type }) => (
                <div key={key} className="flex items-center gap-3">
                  <code className="text-xs font-mono text-accent-glow w-36 flex-shrink-0">{key}</code>
                  <input
                    type={type}
                    value={quickForm[key]}
                    onChange={(e) => setQuickForm(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="input-field flex-1 text-sm py-2"
                  />
                  <button
                    onClick={() => handleQuickSave(key)}
                    disabled={!quickForm[key].trim()}
                    className="btn-primary text-xs py-2 px-3 disabled:opacity-30"
                  >
                    保存
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Environment Variables Table */}
        {status?.configured && (
          <div className="glass-card overflow-hidden animate-slide-up animate-delay-200">
            <div className="p-5 border-b border-white/[0.06]">
              <h3 className="text-sm font-semibold text-white">环境变量</h3>
              <p className="text-xs text-slate-500 mt-1">当前项目的所有环境变量</p>
            </div>
            {envs.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">暂无环境变量</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">变量名</th>
                      <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">值</th>
                      <th className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">环境</th>
                      <th className="text-right px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {envs.map((env) => (
                      <tr key={env.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                        <td className="px-5 py-3">
                          <code className="text-xs font-mono text-accent-glow">{env.key}</code>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-slate-300 max-w-[200px] truncate">
                              {visibleValues[env.id] ? (env.value || '(空)') : '••••••••'}
                            </span>
                            <button
                              onClick={() => toggleVisibility(env.id)}
                              className="text-slate-500 hover:text-slate-300 transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                {visibleValues[env.id] ? (
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                ) : (
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                )}
                              </svg>
                            </button>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex gap-1">
                            {(env.target || []).map(t => (
                              <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-white/[0.05] text-slate-400 border border-white/[0.08]">
                                {t}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => handleEdit(env)}
                            className="text-xs text-slate-400 hover:text-accent-glow transition-colors"
                          >
                            编辑
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Edit Modal */}
        {editingEnv && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="glass-strong p-6 w-full max-w-md mx-4">
              <h3 className="text-lg font-semibold text-white mb-4">
                编辑 <code className="text-accent-glow">{editingEnv.key}</code>
              </h3>
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                rows={4}
                className="input-field font-mono text-sm mb-4"
                autoFocus
              />
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => setEditingEnv(null)}
                  className="btn-ghost text-sm"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="btn-primary text-sm"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

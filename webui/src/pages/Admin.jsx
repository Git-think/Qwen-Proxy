import { useState, useEffect, useCallback } from 'react'
import { fetchAccounts, addAccount, deleteAccount, refreshAccount, refreshAllAccounts } from '../utils/api'
import { useToast } from '../hooks/useToast'
import AccountCard from '../components/AccountCard'
import StatsCard from '../components/StatsCard'

export default function Admin() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddSingle, setShowAddSingle] = useState(false)
  const [showAddBatch, setShowAddBatch] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [batchText, setBatchText] = useState('')
  const [refreshingAll, setRefreshingAll] = useState(false)
  const { toast } = useToast()

  const loadAccounts = useCallback(async () => {
    try {
      const data = await fetchAccounts()
      setAccounts(Array.isArray(data) ? data : data.data || data.accounts || [])
    } catch (err) {
      toast.error('加载账号失败: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  const handleAddSingle = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password.trim()) return
    try {
      await addAccount(email.trim(), password.trim())
      toast.success(`已添加账号 ${email}`)
      setEmail('')
      setPassword('')
      setShowAddSingle(false)
      loadAccounts()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleAddBatch = async (e) => {
    e.preventDefault()
    const lines = batchText.trim().split('\n').filter(Boolean)
    let added = 0
    for (const line of lines) {
      const [em, pw] = line.split(':').map(s => s.trim())
      if (em && pw) {
        try {
          await addAccount(em, pw)
          added++
        } catch {
          // continue
        }
      }
    }
    toast.success(`已添加 ${added} 个账号`)
    setBatchText('')
    setShowAddBatch(false)
    loadAccounts()
  }

  const handleRefresh = async (em) => {
    try {
      await refreshAccount(em)
      toast.success(`已刷新 ${em}`)
      loadAccounts()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleDelete = async (em) => {
    try {
      await deleteAccount(em)
      toast.success(`已删除 ${em}`)
      loadAccounts()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleRefreshAll = async () => {
    setRefreshingAll(true)
    try {
      await refreshAllAccounts()
      toast.success('已刷新全部账号')
      loadAccounts()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setRefreshingAll(false)
    }
  }

  // Stats
  const total = accounts.length
  const valid = accounts.filter(a => a.isValid !== false).length
  const expired = total - valid
  const expiringSoon = accounts.filter(a => {
    const exp = a.tokenExpiry || a.expiresAt
    return exp && (new Date(exp) - Date.now()) < 3600000 && (new Date(exp) - Date.now()) > 0
  }).length

  return (
    <div className="h-screen overflow-y-auto p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 animate-fade-in">
          <div>
            <h1 className="text-2xl font-display font-bold text-white">账号管理</h1>
            <p className="mt-1 text-sm text-slate-400">管理 Qwen AI 账号和 Token</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefreshAll}
              disabled={refreshingAll}
              className="btn-ghost text-sm flex items-center gap-2 disabled:opacity-50"
            >
              <svg className={`w-4 h-4 ${refreshingAll ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              刷新全部
            </button>
            <button
              onClick={() => { setShowAddSingle(true); setShowAddBatch(false) }}
              className="btn-primary text-sm flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              添加账号
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatsCard
            title="账号总数"
            value={total}
            color="accent"
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            }
          />
          <StatsCard
            title="有效"
            value={valid}
            color="emerald"
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <StatsCard
            title="即将过期"
            value={expiringSoon}
            color="amber"
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <StatsCard
            title="已过期"
            value={expired}
            color="red"
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            }
          />
        </div>

        {/* Add Single Account Modal */}
        {showAddSingle && (
          <div className="glass-card p-6 mb-6 animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">添加账号</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setShowAddSingle(false); setShowAddBatch(true) }}
                  className="text-xs text-accent-glow hover:underline"
                >
                  批量添加
                </button>
                <button onClick={() => setShowAddSingle(false)} className="text-slate-400 hover:text-white">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <form onSubmit={handleAddSingle} className="flex flex-col sm:flex-row gap-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="邮箱"
                className="input-field flex-1"
                autoFocus
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="密码"
                className="input-field flex-1"
              />
              <button type="submit" className="btn-primary whitespace-nowrap">
                添加
              </button>
            </form>
          </div>
        )}

        {/* Batch Add Modal */}
        {showAddBatch && (
          <div className="glass-card p-6 mb-6 animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">批量添加账号</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setShowAddBatch(false); setShowAddSingle(true) }}
                  className="text-xs text-accent-glow hover:underline"
                >
                  单个添加
                </button>
                <button onClick={() => setShowAddBatch(false)} className="text-slate-400 hover:text-white">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <form onSubmit={handleAddBatch}>
              <textarea
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
                placeholder="每行一个账号：邮箱:密码"
                rows={6}
                className="input-field font-mono text-sm mb-3"
                autoFocus
              />
              <button type="submit" className="btn-primary">
                全部添加
              </button>
            </form>
          </div>
        )}

        {/* Account list */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex items-center gap-3 text-slate-400">
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              加载中...
            </div>
          </div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <p className="text-slate-400">暂无账号</p>
            <p className="text-sm text-slate-500 mt-1">添加账号以开始使用</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {accounts.map((account, i) => (
              <div key={account.email || i} className="animate-slide-up" style={{ animationDelay: `${i * 50}ms` }}>
                <AccountCard
                  account={account}
                  onRefresh={handleRefresh}
                  onDelete={handleDelete}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

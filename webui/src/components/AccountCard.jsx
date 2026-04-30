import { useState } from 'react'

export default function AccountCard({ account, onRefresh, onDelete }) {
  const [refreshing, setRefreshing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isValid = account.isValid !== false
  const expiryTime = account.tokenExpiry || account.expiresAt
  const isExpiringSoon = expiryTime && (new Date(expiryTime) - Date.now()) < 3600000

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await onRefresh(account.email)
    } finally {
      setRefreshing(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`确定删除账号 ${account.email}？`)) return
    setDeleting(true)
    try {
      await onDelete(account.email)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="glass-card p-4 hover:border-white/[0.12] transition-all duration-200 group">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isValid ? (isExpiringSoon ? 'bg-amber-400' : 'bg-emerald-400') : 'bg-red-400'}`} />
            <h4 className="text-sm font-medium text-slate-200 truncate">{account.email}</h4>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
            <span className={`px-2 py-0.5 rounded-full ${
              isValid
                ? isExpiringSoon
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}>
              {isValid ? (isExpiringSoon ? '即将过期' : '有效') : '已过期'}
            </span>
            {expiryTime && (
              <span>过期时间: {new Date(expiryTime).toLocaleString()}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-1.5 rounded-lg text-slate-400 hover:text-accent-glow hover:bg-accent-primary/10 transition-all disabled:opacity-50"
            title="刷新 Token"
          >
            <svg className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
            title="删除账号"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

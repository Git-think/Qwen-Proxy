import { useState, useEffect, useRef } from 'react'
import { fetchModels } from '../utils/api'

export default function ModelSelector({ value, onChange }) {
  const [models, setModels] = useState([])
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    loadModels()
  }, [])

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function loadModels() {
    setLoading(true)
    try {
      const data = await fetchModels()
      setModels(data.map(m => m.id))
    } catch {
      // fallback
      setModels(['qwen-max', 'qwen-plus', 'qwen-turbo'])
    } finally {
      setLoading(false)
    }
  }

  const filtered = models.filter(m =>
    m.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.15] transition-all duration-200 text-sm"
      >
        <svg className="w-4 h-4 text-accent-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <span className="text-slate-300 max-w-[140px] truncate">{value || '选择模型'}</span>
        <svg className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-72 max-h-80 overflow-hidden rounded-xl bg-[#141428]/95 backdrop-blur-2xl border border-white/[0.12] shadow-2xl shadow-black/60 z-50 animate-fade-in">
          <div className="p-2 border-b border-white/[0.06]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索模型..."
              className="w-full px-3 py-2 bg-white/[0.08] rounded-lg text-sm text-slate-200 placeholder-slate-500 outline-none border border-white/[0.06] focus:border-accent-primary/30 "
              autoFocus
            />
          </div>
          <div className="overflow-y-auto max-h-60 p-1">
            {loading ? (
              <div className="px-3 py-4 text-center text-sm text-slate-500">加载中...</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-slate-500">未找到模型</div>
            ) : (
              filtered.map((model) => (
                <button
                  key={model}
                  onClick={() => {
                    onChange(model)
                    setOpen(false)
                    setSearch('')
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-150 ${
                    model === value
                      ? 'bg-accent-primary/15 text-accent-glow'
                      : 'text-slate-300 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  <span className="font-mono text-xs">{model}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

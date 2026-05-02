import { useState } from 'react'
import { useToast } from '../hooks/useToast'
import { getApiKey } from '../utils/storage'

const endpoints = [
  // ================== OpenAI 兼容 ==================
  {
    category: 'openai',
    method: 'POST',
    path: '/v1/chat/completions',
    title: '聊天补全',
    description: '创建聊天补全，支持流式输出。兼容 OpenAI 格式。',
    auth: true,
    body: {
      model: 'qwen3.6-plus',
      messages: [{ role: 'user', content: 'Hello!' }],
      stream: false,
    },
    response: {
      id: 'chatcmpl-xxx',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello! How can I help you?' }, finish_reason: 'stop' }],
    },
    notes: [
      '支持流式输出 `stream: true`（SSE 格式）',
      '模型后缀：`-thinking`、`-search`、`-thinking-search`、`-image`、`-video`',
      '消息数组遵循 OpenAI 格式：system、user、assistant 角色',
    ],
  },
  {
    category: 'openai',
    method: 'GET',
    path: '/v1/models',
    title: '模型列表',
    description: '动态拉取 chat.qwen.ai 当前可用的全部模型，包含基础模型与各种后缀变体（-thinking / -search / -image / -video / -image-edit）。',
    auth: true,
    body: null,
    response: {
      object: 'list',
      data: [
        { id: 'qwen3.6-plus', object: 'model', owned_by: 'qwen' },
        { id: 'qwen3.6-plus-thinking', object: 'model', owned_by: 'qwen' },
        { id: 'qwen3.6-plus-search', object: 'model', owned_by: 'qwen' },
      ],
    },
    notes: [
      '运行时从 chat.qwen.ai 动态获取，并按需缓存（首次调用后保留）',
      'OpenAI 客户端可直接用作 `models.list()`',
      'Gemini / Anthropic 客户端可借此发现可用模型 ID 后再构造各自请求',
      '响应中包含基础模型与 `-thinking`、`-search` 后缀版本；前端选择器会自动去重显示基础模型',
    ],
  },
  {
    category: 'openai',
    method: 'POST',
    path: '/v1/images/generations',
    title: '图片生成',
    description: '根据文本提示生成图片。兼容 OpenAI 格式。',
    auth: true,
    body: {
      model: 'qwen3.6-plus-image',
      prompt: 'A beautiful sunset over mountains',
      n: 1,
      size: '1024x1024',
    },
    response: {
      created: 1700000000,
      data: [{ url: 'https://...' }],
    },
    notes: ['使用带 `-image` 后缀的模型', '支持多种尺寸'],
  },
  {
    category: 'openai',
    method: 'POST',
    path: '/v1/images/edits',
    title: '图片编辑',
    description: '通过文本指令编辑图片。支持 multipart 上传。',
    auth: true,
    body: { image: '<file>', prompt: 'Make the sky blue', model: 'qwen3.6-plus-image-edit' },
    response: { created: 1700000000, data: [{ url: 'https://...' }] },
    notes: ['Multipart form-data 上传', '使用带 `-image-edit` 后缀的模型'],
  },
  {
    category: 'openai',
    method: 'POST',
    path: '/v1/videos',
    title: '视频生成',
    description: '根据文本提示生成视频。',
    auth: true,
    body: { model: 'qwen3.6-plus-video', prompt: 'A cat playing piano' },
    response: { data: [{ url: 'https://...' }] },
    notes: ['使用带 `-video` 后缀的模型', '处理时间可能较长'],
  },

  // ================== Anthropic 兼容 ==================
  {
    category: 'anthropic',
    method: 'POST',
    path: '/v1/messages',
    title: 'Messages（Anthropic）',
    description: '使用 Anthropic Messages 格式发起对话；内部转换到 Qwen 后端。',
    auth: true,
    authHeader: 'x-api-key',
    body: {
      model: 'qwen3.6-plus',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello, Claude' }],
      stream: false,
    },
    response: {
      id: 'msg_xxx',
      type: 'message',
      role: 'assistant',
      model: 'qwen3.6-plus',
      content: [{ type: 'text', text: 'Hello!' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    },
    notes: [
      '同时也提供 `/anthropic/v1/messages` 同义路由',
      '支持 `x-api-key` 头部或 `Authorization: Bearer ...`',
      '支持流式输出 `stream: true`，SSE 事件类型遵循 Anthropic 规范',
    ],
  },
  {
    category: 'anthropic',
    method: 'POST',
    path: '/anthropic/v1/messages',
    title: 'Messages（命名空间路径）',
    description: '与 `/v1/messages` 相同，提供给希望保留 `/anthropic` 前缀的客户端。',
    auth: true,
    authHeader: 'x-api-key',
    body: {
      model: 'qwen3.6-plus',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hi' }],
    },
    response: {
      id: 'msg_xxx',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: '...' }],
    },
    notes: ['行为与 `/v1/messages` 一致'],
  },

  // ================== Gemini 兼容 ==================
  {
    category: 'gemini',
    method: 'POST',
    path: '/v1beta/models/{model}:generateContent',
    title: 'generateContent（非流式）',
    description: '使用 Google Gemini 格式发起一次内容生成；内部转换到 Qwen。',
    auth: true,
    authHeader: 'x-goog-api-key',
    body: {
      contents: [{ role: 'user', parts: [{ text: 'Hello, Gemini' }] }],
      generationConfig: { temperature: 0.7 },
    },
    response: {
      candidates: [{
        content: { role: 'model', parts: [{ text: 'Hello!' }] },
        finishReason: 'STOP',
        index: 0,
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    },
    notes: [
      '路径中 `{model}` 替换为模型名，例如 `qwen3.6-plus`',
      '同时支持 `/v1/models/{model}:generateContent`',
      '支持 `x-goog-api-key` 头、查询参数 `?key=...`、`Authorization: Bearer ...`',
    ],
  },
  {
    category: 'gemini',
    method: 'POST',
    path: '/v1beta/models/{model}:streamGenerateContent',
    title: 'streamGenerateContent（流式）',
    description: '以 Gemini SSE 流式格式输出生成内容。',
    auth: true,
    authHeader: 'x-goog-api-key',
    body: {
      contents: [{ role: 'user', parts: [{ text: 'Tell me a story' }] }],
    },
    response: {
      candidates: [{ content: { role: 'model', parts: [{ text: '...' }] }, index: 0 }],
    },
    notes: [
      '响应为 `text/event-stream`',
      '同时支持 `/v1/models/{model}:streamGenerateContent`',
    ],
  },

  // ================== 账号管理（管理员） ==================
  {
    category: 'admin',
    method: 'GET',
    path: '/api/getAllAccounts',
    title: '获取所有账号',
    description: '获取所有已配置的 Qwen 账号及其状态。',
    auth: true,
    admin: true,
    body: null,
    response: { total: 1, page: 1, pageSize: 1000, data: [{ email: 'user@example.com', token: '...', expires: 1700000000 }] },
    notes: ['需要管理员 API Key（API_KEY 环境变量中的第一个）', '支持 `?page=&pageSize=` 分页'],
  },
  {
    category: 'admin',
    method: 'POST',
    path: '/api/setAccount',
    title: '添加账号',
    description: '添加新的 Qwen 账号。',
    auth: true,
    admin: true,
    body: { email: 'user@example.com', password: 'password123' },
    response: { email: 'user@example.com', message: 'Account created successfully' },
    notes: ['仅管理员', '账号将自动登录并获取 Token'],
  },
  {
    category: 'admin',
    method: 'DELETE',
    path: '/api/deleteAccount',
    title: '删除账号',
    description: '移除 Qwen 账号。',
    auth: true,
    admin: true,
    body: { email: 'user@example.com' },
    response: { message: 'Account deleted successfully' },
    notes: ['仅管理员'],
  },
  {
    category: 'admin',
    method: 'POST',
    path: '/api/refreshAccount',
    title: '刷新账号 Token',
    description: '强制刷新指定账号的 Token。',
    auth: true,
    admin: true,
    body: { email: 'user@example.com' },
    response: { message: 'Account token refreshed successfully', email: 'user@example.com' },
    notes: ['仅管理员', '重新向 Qwen 认证'],
  },
  {
    category: 'admin',
    method: 'POST',
    path: '/api/refreshAllAccounts',
    title: '刷新所有 Token',
    description: '强制刷新所有账号的 Token。',
    auth: true,
    admin: true,
    body: { thresholdHours: 24 },
    response: { message: 'Batch refresh complete', refreshedCount: 3, thresholdHours: 24 },
    notes: ['仅管理员', '账号较多时可能需要一些时间'],
  },

  // ================== 公共 ==================
  {
    category: 'public',
    method: 'POST',
    path: '/verify',
    title: '验证 API Key',
    description: '检查 API Key 是否有效。',
    auth: false,
    body: { apiKey: 'sk-your-key' },
    response: { valid: true, isAdmin: true, status: 200, message: 'success' },
    notes: ['无需认证'],
  },
  {
    category: 'public',
    method: 'GET',
    path: '/health',
    title: '健康检查',
    description: '检查服务是否正常运行。',
    auth: false,
    body: null,
    response: { status: 'ok' },
    notes: ['无需认证', '可用于监控'],
  },
]

const methodColors = {
  GET: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  POST: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  DELETE: 'bg-red-500/15 text-red-400 border-red-500/25',
  PUT: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
}

const categoryMeta = {
  openai: { label: 'OpenAI', badgeClass: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' },
  anthropic: { label: 'Anthropic', badgeClass: 'bg-orange-500/10 text-orange-300 border-orange-500/20' },
  gemini: { label: 'Gemini', badgeClass: 'bg-sky-500/10 text-sky-300 border-sky-500/20' },
  admin: { label: '管理', badgeClass: 'bg-amber-500/10 text-amber-300 border-amber-500/20' },
  public: { label: '公共', badgeClass: 'bg-slate-500/10 text-slate-300 border-slate-500/20' },
}

function EndpointCard({ endpoint }) {
  const [expanded, setExpanded] = useState(false)
  const [trying, setTrying] = useState(false)
  const [response, setResponse] = useState(null)
  const { toast } = useToast()
  const cat = categoryMeta[endpoint.category] || categoryMeta.public

  // 路径中的 {model} 占位符不能直接发请求，需要特殊处理
  const tryablePath = endpoint.path.replace('{model}', 'qwen3.6-plus')
  const isTryable = !endpoint.path.includes('{')

  const handleTry = async () => {
    setTrying(true)
    setResponse(null)
    const key = getApiKey()

    try {
      // 根据 authHeader 字段决定如何放 key
      const headers = { 'Content-Type': 'application/json' }
      if (endpoint.auth && key) {
        if (endpoint.authHeader === 'x-api-key') headers['x-api-key'] = key
        else if (endpoint.authHeader === 'x-goog-api-key') headers['x-goog-api-key'] = key
        else headers['Authorization'] = `Bearer ${key}`
      }

      const options = {
        method: endpoint.method,
        headers,
      }

      if (endpoint.body && endpoint.method !== 'GET') {
        options.body = JSON.stringify(endpoint.body)
      }

      const res = await fetch(tryablePath, options)
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { data = text }
      setResponse({ status: res.status, data })
    } catch (err) {
      setResponse({ status: 0, data: { error: err.message } })
      toast.error(err.message)
    } finally {
      setTrying(false)
    }
  }

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text)
    toast.success('已复制到剪贴板')
  }

  // 鉴权头示例（cURL 与说明用）
  const authLine = endpoint.auth
    ? endpoint.authHeader === 'x-api-key'
      ? "  -H 'x-api-key: YOUR_API_KEY' \\\n"
      : endpoint.authHeader === 'x-goog-api-key'
      ? "  -H 'x-goog-api-key: YOUR_API_KEY' \\\n"
      : "  -H 'Authorization: Bearer YOUR_API_KEY' \\\n"
    : ''

  const curlExample = `curl -X ${endpoint.method} '${window.location.origin}${endpoint.path}' \\
${authLine}  -H 'Content-Type: application/json'${endpoint.body ? ` \\
  -d '${JSON.stringify(endpoint.body, null, 2)}'` : ''}`

  return (
    <div className="glass-card overflow-hidden animate-slide-up">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-4 hover:bg-white/[0.02] transition-colors text-left"
      >
        <span className={`px-2 py-0.5 rounded text-xs font-bold border ${methodColors[endpoint.method]}`}>
          {endpoint.method}
        </span>
        <code className="text-sm font-mono text-slate-300 flex-1 truncate">{endpoint.path}</code>
        <span className="text-sm text-slate-400 hidden sm:block">{endpoint.title}</span>
        <span className={`px-2 py-0.5 rounded text-xs border ${cat.badgeClass}`}>
          {cat.label}
        </span>
        {endpoint.admin && (
          <span className="px-2 py-0.5 rounded text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20">
            Admin
          </span>
        )}
        <svg
          className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-white/[0.06] p-4 space-y-4 animate-fade-in">
          <p className="text-sm text-slate-400">{endpoint.description}</p>

          {endpoint.notes.length > 0 && (
            <div className="space-y-1">
              {endpoint.notes.map((note, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-slate-500">
                  <span className="text-accent-primary mt-0.5">•</span>
                  <span>{note}</span>
                </div>
              ))}
            </div>
          )}

          {endpoint.body && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">请求体</h4>
                <button
                  onClick={() => handleCopy(JSON.stringify(endpoint.body, null, 2))}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  复制
                </button>
              </div>
              <pre className="p-3 rounded-lg bg-black/30 border border-white/[0.06] text-xs font-mono text-slate-300 overflow-x-auto">
                {JSON.stringify(endpoint.body, null, 2)}
              </pre>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">响应示例</h4>
              <button
                onClick={() => handleCopy(JSON.stringify(endpoint.response, null, 2))}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                复制
              </button>
            </div>
            <pre className="p-3 rounded-lg bg-black/30 border border-white/[0.06] text-xs font-mono text-emerald-300/80 overflow-x-auto">
              {JSON.stringify(endpoint.response, null, 2)}
            </pre>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">cURL</h4>
              <button
                onClick={() => handleCopy(curlExample)}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                复制
              </button>
            </div>
            <pre className="p-3 rounded-lg bg-black/30 border border-white/[0.06] text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap">
              {curlExample}
            </pre>
          </div>

          <div className="flex items-center gap-3 pt-2 border-t border-white/[0.06]">
            <button
              onClick={handleTry}
              disabled={trying || !isTryable}
              className="btn-primary text-xs py-2 px-4 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              title={isTryable ? '' : '请将 {model} 替换为实际模型名后再测试'}
            >
              {trying ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  发送中...
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  测试
                </>
              )}
            </button>
            {endpoint.auth && (
              <span className="text-xs text-slate-500">
                🔑 使用已保存的 API Key（
                {endpoint.authHeader === 'x-api-key' ? 'x-api-key' :
                 endpoint.authHeader === 'x-goog-api-key' ? 'x-goog-api-key' : 'Authorization'}）
              </span>
            )}
          </div>

          {response && (
            <div className="animate-fade-in">
              <div className="flex items-center gap-2 mb-2">
                <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">响应结果</h4>
                <span className={`px-2 py-0.5 rounded text-xs ${
                  response.status >= 200 && response.status < 300
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-red-500/15 text-red-400'
                }`}>
                  {response.status}
                </span>
              </div>
              <pre className="p-3 rounded-lg bg-black/30 border border-white/[0.06] text-xs font-mono text-slate-300 overflow-x-auto max-h-60 overflow-y-auto">
                {typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Docs() {
  const [filter, setFilter] = useState('all')

  const filtered = filter === 'all' ? endpoints : endpoints.filter(e => e.category === filter)

  const filters = [
    { key: 'all', label: '全部' },
    { key: 'openai', label: 'OpenAI' },
    { key: 'anthropic', label: 'Anthropic' },
    { key: 'gemini', label: 'Gemini' },
    { key: 'admin', label: '管理' },
    { key: 'public', label: '公共' },
  ]

  return (
    <div className="h-screen overflow-y-auto p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8 animate-fade-in">
          <h1 className="text-2xl font-display font-bold text-white">API 文档</h1>
          <p className="mt-1 text-sm text-slate-400">
            提供 OpenAI / Anthropic / Gemini 三种格式访问同一 Qwen 后端
          </p>
        </div>

        <div className="glass-card p-5 mb-6 animate-slide-up">
          <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
            <svg className="w-4 h-4 text-accent-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            认证方式
          </h3>
          <p className="text-sm text-slate-400 mb-3">
            根据所用 API 协议选择合适的鉴权头：
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="px-3 py-2 rounded-lg bg-black/30 border border-white/[0.06]">
              <div className="text-slate-400 mb-1">OpenAI</div>
              <code className="text-accent-glow font-mono">Authorization: Bearer sk-...</code>
            </div>
            <div className="px-3 py-2 rounded-lg bg-black/30 border border-white/[0.06]">
              <div className="text-slate-400 mb-1">Anthropic</div>
              <code className="text-accent-glow font-mono">x-api-key: sk-...</code>
            </div>
            <div className="px-3 py-2 rounded-lg bg-black/30 border border-white/[0.06]">
              <div className="text-slate-400 mb-1">Gemini</div>
              <code className="text-accent-glow font-mono">x-goog-api-key: sk-...</code>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            <code className="text-accent-glow">API_KEY</code> 环境变量中的第一个密钥为管理员密钥，可访问 `/api/*` 管理接口。
          </p>
        </div>

        <div className="glass-card p-5 mb-6 animate-slide-up animate-delay-100">
          <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
            <svg className="w-4 h-4 text-accent-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            模型后缀
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
            {[
              { suffix: '-thinking', desc: '启用推理/思考模式' },
              { suffix: '-search', desc: '启用联网搜索增强' },
              { suffix: '-thinking-search', desc: '同时启用思考和搜索' },
              { suffix: '-image', desc: '图片生成模式' },
              { suffix: '-video', desc: '视频生成模式' },
              { suffix: '-image-edit', desc: '图片编辑模式' },
            ].map(({ suffix, desc }) => (
              <div key={suffix} className="flex items-center gap-2 text-sm">
                <code className="px-2 py-0.5 rounded bg-white/[0.05] text-accent-glow text-xs font-mono">{suffix}</code>
                <span className="text-slate-400 text-xs">{desc}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filter === f.key
                  ? 'bg-accent-primary/15 text-accent-glow border border-accent-primary/25'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {filtered.map((endpoint, i) => (
            <div key={endpoint.path + endpoint.method} style={{ animationDelay: `${i * 50}ms` }}>
              <EndpointCard endpoint={endpoint} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

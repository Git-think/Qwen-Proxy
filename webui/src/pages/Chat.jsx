import { useState, useRef, useEffect } from 'react'
import { useChat } from '../hooks/useChat'
import MessageBubble from '../components/MessageBubble'
import ModelSelector from '../components/ModelSelector'

export default function Chat() {
  const {
    conversations,
    activeConversation,
    activeId,
    isStreaming,
    streamingContent,
    streamingReasoning,
    selectedModel,
    changeModel,
    newChat,
    selectConversation,
    deleteConversation,
    sendMessage,
    stopStreaming,
    retryLastMessage,
    switchMessageVersion,
  } = useChat()

  const [input, setInput] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [attachments, setAttachments] = useState([])
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeConversation?.messages, streamingContent, streamingReasoning])

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files)
    const newAttachments = []

    for (const file of files) {
      const reader = new FileReader()
      const data = await new Promise((resolve) => {
        reader.onload = (ev) => resolve(ev.target.result)
        reader.readAsDataURL(file)
      })

      newAttachments.push({
        type: file.type.startsWith('image/') ? 'image' : 'file',
        data,
        name: file.name,
        size: file.size,
      })
    }

    setAttachments(prev => [...prev, ...newAttachments])
    e.target.value = ''
  }

  const handleSend = () => {
    const text = input.trim()
    if (!text && attachments.length === 0) return
    if (isStreaming) return
    setInput('')
    sendMessage(text, attachments)
    setAttachments([])
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-screen">
      {/* Conversation sidebar */}
      <div
        className={`flex-shrink-0 border-r border-white/[0.06] bg-surface-900/50 transition-all duration-300 flex flex-col ${
          sidebarOpen ? 'w-64' : 'w-0 overflow-hidden'
        }`}
      >
        <div className="p-3 border-b border-white/[0.06]">
          <button
            onClick={newChat}
            className="btn-primary w-full py-2.5 text-sm flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新对话
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150 ${
                conv.id === activeId
                  ? 'bg-white/[0.06] border border-white/[0.08]'
                  : 'hover:bg-white/[0.03]'
              }`}
              onClick={() => selectConversation(conv.id)}
            >
              <svg className="w-4 h-4 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span className="flex-1 text-sm text-slate-300 truncate">
                {conv.title || '新对话'}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id) }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-500 hover:text-red-400 transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}

          {conversations.length === 0 && (
            <div className="text-center py-8 text-slate-500 text-sm">
              暂无对话
            </div>
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-10 flex items-center justify-between px-4 h-14 border-b border-white/[0.06] bg-surface-900/80 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.05] transition-all lg:hidden"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.05] transition-all hidden lg:block"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <ModelSelector value={selectedModel} onChange={changeModel} />
          </div>
          <div className="text-xs text-slate-500">
              {activeConversation?.messages.length || 0} 条消息
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {!activeConversation || activeConversation.messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-center">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-primary/20 to-accent-secondary/20 border border-accent-primary/20 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-accent-glow" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h2 className="text-xl font-display font-semibold text-white mb-2">开始对话</h2>
                <p className="text-sm text-slate-400 max-w-sm">
                  随时提问，由 Qwen AI 模型提供流式响应。
                </p>
              </div>
            ) : (
              <>
                {activeConversation.messages.map((msg, idx) => {
                  const isLastAssistant =
                    msg.role === 'assistant' &&
                    idx === activeConversation.messages.length - 1
                  return (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      onRetry={retryLastMessage}
                      onSwitchVersion={switchMessageVersion}
                      showRetry={isLastAssistant && !isStreaming}
                    />
                  )
                })}
                {isStreaming && (streamingContent || streamingReasoning) && (
                  <MessageBubble
                    message={{
                      role: 'assistant',
                      content: streamingContent,
                      reasoning_content: streamingReasoning,
                      id: 'streaming'
                    }}
                    isStreaming
                  />
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input area */}
        <div className="border-t border-white/[0.06] bg-surface-900/50 backdrop-blur-sm p-4">
          <div className="max-w-3xl mx-auto">
            {/* Attachments preview */}
            {attachments.length > 0 && (
              <div className="flex gap-2 mb-2 flex-wrap">
                {attachments.map((att, i) => (
                  <div key={i} className="relative group">
                    {att.type === 'image' ? (
                      <img src={att.data} className="h-16 w-16 rounded-lg object-cover border border-white/10" />
                    ) : (
                      <div className="h-16 px-3 rounded-lg bg-white/[0.06] border border-white/10 flex items-center gap-2">
                        <span className="text-xs text-slate-400 truncate max-w-[100px]">{att.name}</span>
                      </div>
                    )}
                    <button
                      onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-3">
              {/* File upload button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-shrink-0 p-3 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.05] border border-white/[0.08] transition-all duration-200"
                title="上传文件"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.txt"
                onChange={handleFileSelect}
                className="hidden"
              />

              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                   placeholder="输入消息..."
                  rows={1}
                  className="input-field resize-none min-h-[48px] max-h-[200px] pr-12"
                  style={{ height: Math.min(200, Math.max(48, input.split('\n').length * 24 + 24)) + 'px' }}
                />
              </div>
              {isStreaming ? (
                <button
                  onClick={stopStreaming}
                  className="flex-shrink-0 p-3 rounded-xl bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-all duration-200"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim() && attachments.length === 0}
                  className="flex-shrink-0 p-3 rounded-xl bg-gradient-to-r from-accent-primary to-accent-secondary text-white hover:shadow-lg hover:shadow-accent-primary/25 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 active:scale-95"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
                  </svg>
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-600 text-center">
              按 Enter 发送，Shift+Enter 换行
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

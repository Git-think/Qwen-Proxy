import { useState } from 'react'
import { parseMessageContent, renderMarkdown } from '../utils/markdown'
import ThinkingBlock from './ThinkingBlock'

export default function MessageBubble({
  message,
  isStreaming = false,
  onRetry,
  onSwitchVersion,
  showRetry = false,
}) {
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'
  const isError = message.isError

  // 版本信息（仅 assistant 消息）
  const versions = Array.isArray(message.versions) ? message.versions : null
  const versionCount = versions ? versions.length : 0
  const versionIndex = versionCount > 0
    ? Math.min(message.versionIndex ?? versionCount - 1, versionCount - 1)
    : 0
  const activeVersion = versionCount > 0 ? versions[versionIndex] : null

  // 取当前显示内容：优先版本中的内容，否则回退到 message.content
  let thinking = (activeVersion?.reasoning_content) ?? message.reasoning_content ?? null
  let mainContent = (activeVersion?.content) ?? message.content ?? ''
  let html = ''

  if (!isUser) {
    if (!thinking && mainContent) {
      const parsed = parseMessageContent(mainContent)
      thinking = parsed.thinking
      mainContent = mainContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    }
    html = renderMarkdown(mainContent)
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(activeVersion?.content ?? message.content ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={`flex gap-3 animate-fade-in ${isUser ? 'justify-end' : 'justify-start'}`}>
      {/* Avatar */}
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center mt-1">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
      )}

      {/* Message content */}
      <div className={`max-w-[80%] group relative ${isUser ? 'order-first' : ''}`}>
        <div
          className={`px-4 py-3 rounded-2xl ${
            isUser
              ? 'bg-accent-primary/15 border border-accent-primary/20 text-slate-200'
              : isError
              ? 'bg-red-500/10 border border-red-500/20 text-red-300'
              : 'glass-card text-slate-200'
          }`}
        >
          {isUser ? (
            <>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
              {message.attachments && message.attachments.length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {message.attachments.map((att, i) => (
                    att.type === 'image' ? (
                      <img key={i} src={att.data} className="max-h-40 rounded-lg" />
                    ) : (
                      <span key={i} className="text-xs text-slate-400 inline-flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                        {att.name}
                      </span>
                    )
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <ThinkingBlock content={thinking} />
              <div
                className="markdown-body text-sm"
                dangerouslySetInnerHTML={{ __html: html || (isStreaming ? '<span class="animate-pulse-soft">▊</span>' : '') }}
              />
              {isStreaming && html && (
                <span className="animate-pulse-soft inline-block ml-0.5">▊</span>
              )}
            </>
          )}
        </div>

        {/* 工具栏：版本切换 + 复制 + 重试（assistant 消息） */}
        {!isUser && !isStreaming && mainContent && (
          <div className="mt-1.5 flex items-center gap-1 text-xs text-slate-500">
            {/* 版本切换 */}
            {versionCount > 1 && (
              <div className="flex items-center gap-0.5 mr-1">
                <button
                  onClick={() => onSwitchVersion?.(message.id, -1)}
                  disabled={versionIndex === 0}
                  className="p-1 rounded hover:bg-white/[0.05] hover:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  title="上一个版本"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="tabular-nums select-none">
                  {versionIndex + 1}/{versionCount}
                </span>
                <button
                  onClick={() => onSwitchVersion?.(message.id, +1)}
                  disabled={versionIndex >= versionCount - 1}
                  className="p-1 rounded hover:bg-white/[0.05] hover:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  title="下一个版本"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            )}

            {/* 复制 */}
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 p-1 rounded hover:bg-white/[0.05] hover:text-slate-300 transition-all opacity-0 group-hover:opacity-100"
              title="复制"
            >
              {copied ? (
                <span className="text-emerald-400">已复制</span>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>

            {/* 重试 */}
            {showRetry && onRetry && (
              <button
                onClick={onRetry}
                className="flex items-center gap-1 p-1 rounded hover:bg-white/[0.05] hover:text-accent-glow transition-all opacity-0 group-hover:opacity-100"
                title="重新生成（保留当前回答）"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* 用户消息悬浮复制 */}
        {isUser && !isStreaming && message.content && (
          <button
            onClick={handleCopy}
            className="absolute -bottom-6 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1"
          >
            {copied ? (
              <span className="text-emerald-400">已复制</span>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                复制
              </>
            )}
          </button>
        )}
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-white/[0.08] border border-white/[0.1] flex items-center justify-center mt-1">
          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
      )}
    </div>
  )
}

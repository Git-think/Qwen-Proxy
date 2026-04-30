import { useState, useCallback, useRef, useEffect } from 'react'
import { streamChat } from '../utils/api'
import {
  getConversations,
  saveConversations,
  getActiveConversationId,
  setActiveConversationId,
  getSelectedModel,
  setSelectedModel as saveSelectedModel,
} from '../utils/storage'
import { DEFAULT_MODEL } from '../utils/constants'

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function createConversation(title = 'New Chat') {
  return {
    id: generateId(),
    title,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

// 取 assistant 当前激活版本的内容；user 消息按原样返回
function getActiveContent(msg) {
  if (msg.role === 'assistant' && Array.isArray(msg.versions) && msg.versions.length > 0) {
    const idx = Math.min(msg.versionIndex ?? msg.versions.length - 1, msg.versions.length - 1)
    return msg.versions[idx]?.content ?? ''
  }
  return msg.content ?? ''
}

// 构造 OpenAI 风格的 content（兼容多模态附件）
function buildApiContent(msg) {
  if (msg.role === 'assistant') {
    return getActiveContent(msg)
  }
  if (!msg.attachments || msg.attachments.length === 0) {
    return msg.content
  }
  const parts = []
  if (msg.content) parts.push({ type: 'text', text: msg.content })
  for (const att of msg.attachments) {
    if (att.type === 'image') {
      parts.push({ type: 'image_url', image_url: { url: att.data } })
    }
  }
  return parts.length > 0 ? parts : msg.content
}

export function useChat() {
  const [conversations, setConversations] = useState(() => getConversations())
  const [activeId, setActiveId] = useState(() => getActiveConversationId())
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingReasoning, setStreamingReasoning] = useState('')
  const [selectedModel, setSelectedModel] = useState(() => getSelectedModel() || DEFAULT_MODEL)
  const abortRef = useRef(null)

  const activeConversation = conversations.find(c => c.id === activeId) || null

  useEffect(() => { saveConversations(conversations) }, [conversations])
  useEffect(() => { if (activeId) setActiveConversationId(activeId) }, [activeId])

  const changeModel = useCallback((model) => {
    setSelectedModel(model)
    saveSelectedModel(model)
  }, [])

  const newChat = useCallback(() => {
    const conv = createConversation()
    setConversations(prev => [conv, ...prev])
    setActiveId(conv.id)
    return conv.id
  }, [])

  const selectConversation = useCallback((id) => setActiveId(id), [])

  const deleteConversation = useCallback((id) => {
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id)
      if (activeId === id) setActiveId(next.length > 0 ? next[0].id : null)
      return next
    })
  }, [activeId])

  // 内部：执行一次流式请求，由调用方提供完成/失败处理
  const runStream = useCallback(async (messagesForApi, onComplete, onError) => {
    setIsStreaming(true)
    setStreamingContent('')
    setStreamingReasoning('')

    let fullContent = ''
    let fullReasoning = ''
    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamChat(
        messagesForApi,
        selectedModel,
        (chunk, type) => {
          if (type === 'reasoning') {
            fullReasoning += chunk
            setStreamingReasoning(fullReasoning)
          } else {
            fullContent += chunk
            setStreamingContent(fullContent)
          }
        },
        () => {
          onComplete({ content: fullContent, reasoning_content: fullReasoning || undefined })
        },
        controller.signal
      )
    } catch (err) {
      if (err.name !== 'AbortError') onError?.(err)
    } finally {
      setIsStreaming(false)
      setStreamingContent('')
      setStreamingReasoning('')
      abortRef.current = null
    }
  }, [selectedModel])

  const sendMessage = useCallback(async (content, attachments = []) => {
    let convId = activeId
    let convs = conversations

    if (!convId) {
      const conv = createConversation(content.slice(0, 50))
      convs = [conv, ...convs]
      convId = conv.id
      setConversations(convs)
      setActiveId(convId)
    }

    const userMessage = {
      role: 'user',
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      id: generateId(),
    }

    setConversations(prev =>
      prev.map(c =>
        c.id === convId
          ? {
              ...c,
              messages: [...c.messages, userMessage],
              title: c.messages.length === 0 ? content.slice(0, 50) : c.title,
              updatedAt: Date.now(),
            }
          : c
      )
    )

    const conversation = convs.find(c => c.id === convId)
    const baseMessages = (conversation?.messages || []).map(m => ({
      role: m.role,
      content: buildApiContent(m),
    }))

    const newUserApiContent = attachments.length > 0
      ? [
          ...(content ? [{ type: 'text', text: content }] : []),
          ...attachments.filter(a => a.type === 'image').map(a => ({
            type: 'image_url',
            image_url: { url: a.data }
          }))
        ]
      : content

    const messagesForApi = [...baseMessages, { role: 'user', content: newUserApiContent }]

    await runStream(
      messagesForApi,
      (result) => {
        const assistantMessage = {
          role: 'assistant',
          id: generateId(),
          versions: [{ content: result.content, reasoning_content: result.reasoning_content }],
          versionIndex: 0,
          content: result.content,
          reasoning_content: result.reasoning_content,
        }
        setConversations(prev =>
          prev.map(c =>
            c.id === convId
              ? { ...c, messages: [...c.messages, assistantMessage], updatedAt: Date.now() }
              : c
          )
        )
      },
      (err) => {
        const errorMessage = {
          role: 'assistant',
          content: `错误: ${err.message}`,
          id: generateId(),
          isError: true,
        }
        setConversations(prev =>
          prev.map(c =>
            c.id === convId
              ? { ...c, messages: [...c.messages, errorMessage], updatedAt: Date.now() }
              : c
          )
        )
      }
    )
  }, [activeId, conversations, runStream])

  const stopStreaming = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
  }, [])

  // 重试：保留之前的回答，新一轮结果作为新版本追加到最后一条 assistant 消息
  const retryLastMessage = useCallback(async () => {
    if (!activeId || isStreaming) return
    const conv = conversations.find(c => c.id === activeId)
    if (!conv || conv.messages.length === 0) return

    const lastIdx = conv.messages.length - 1
    const lastMsg = conv.messages[lastIdx]
    if (lastMsg.role !== 'assistant') return

    const messagesForApi = conv.messages.slice(0, lastIdx).map(m => ({
      role: m.role,
      content: buildApiContent(m),
    }))

    await runStream(
      messagesForApi,
      (result) => {
        setConversations(prev =>
          prev.map(c => {
            if (c.id !== activeId) return c
            return {
              ...c,
              messages: c.messages.map((m, i) => {
                if (i !== lastIdx) return m
                const existing = Array.isArray(m.versions) && m.versions.length > 0
                  ? m.versions
                  : [{ content: m.content, reasoning_content: m.reasoning_content }]
                const newVersions = [
                  ...existing,
                  { content: result.content, reasoning_content: result.reasoning_content },
                ]
                return {
                  ...m,
                  versions: newVersions,
                  versionIndex: newVersions.length - 1,
                  content: result.content,
                  reasoning_content: result.reasoning_content,
                  isError: false,
                }
              }),
              updatedAt: Date.now(),
            }
          })
        )
      }
    )
  }, [activeId, isStreaming, conversations, runStream])

  // 切换某条 assistant 消息的版本（左右分页）
  const switchMessageVersion = useCallback((messageId, delta) => {
    setConversations(prev =>
      prev.map(c => {
        if (c.id !== activeId) return c
        return {
          ...c,
          messages: c.messages.map((m) => {
            if (m.id !== messageId) return m
            if (!Array.isArray(m.versions) || m.versions.length <= 1) return m
            const cur = m.versionIndex ?? m.versions.length - 1
            const next = Math.max(0, Math.min(m.versions.length - 1, cur + delta))
            if (next === cur) return m
            const v = m.versions[next]
            return {
              ...m,
              versionIndex: next,
              content: v.content,
              reasoning_content: v.reasoning_content,
            }
          })
        }
      })
    )
  }, [activeId])

  return {
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
  }
}

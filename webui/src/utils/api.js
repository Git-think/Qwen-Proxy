import { getApiKey } from './storage'
import { API_ENDPOINTS } from './constants'

function getHeaders() {
  const key = getApiKey()
  return {
    'Content-Type': 'application/json',
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  }
}

export async function apiFetch(endpoint, options = {}) {
  const response = await fetch(endpoint, {
    ...options,
    headers: {
      ...getHeaders(),
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(error.error?.message || error.error || `Request failed: ${response.status}`)
  }

  return response.json()
}

export async function fetchModels() {
  const data = await apiFetch(API_ENDPOINTS.MODELS)
  return data.data || []
}

export async function verifyKey(key) {
  const response = await fetch(API_ENDPOINTS.VERIFY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: key }),
  })
  return response.ok
}

export async function fetchAccounts() {
  return apiFetch(API_ENDPOINTS.GET_ALL_ACCOUNTS)
}

export async function addAccount(email, password) {
  return apiFetch(API_ENDPOINTS.SET_ACCOUNT, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function deleteAccount(email) {
  return apiFetch(API_ENDPOINTS.DELETE_ACCOUNT, {
    method: 'DELETE',
    body: JSON.stringify({ email }),
  })
}

export async function refreshAccount(email) {
  return apiFetch(API_ENDPOINTS.REFRESH_ACCOUNT, {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function refreshAllAccounts() {
  return apiFetch(API_ENDPOINTS.REFRESH_ALL_ACCOUNTS, {
    method: 'POST',
  })
}

/**
 * Stream chat with support for reasoning_content (thinking) and content (answer)
 * @param {Array} messages
 * @param {string} model
 * @param {Function} onChunk - (content, type) where type is 'content' or 'reasoning'
 * @param {Function} onDone
 * @param {AbortSignal} signal
 * @param {Object} extraParams - additional params like enable_thinking, reasoning_effort
 */
export async function streamChat(messages, model, onChunk, onDone, signal, extraParams = {}) {
  const key = getApiKey()
  const response = await fetch(API_ENDPOINTS.CHAT_COMPLETIONS, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      ...extraParams,
    }),
    signal,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(error.error?.message || error.error || `Request failed: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6)
      if (data === '[DONE]') {
        onDone()
        return
      }
      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta
        if (!delta) continue
        if (delta.reasoning_content) {
          onChunk(delta.reasoning_content, 'reasoning')
        }
        if (delta.content) {
          onChunk(delta.content, 'content')
        }
      } catch {
        // skip malformed JSON
      }
    }
  }

  onDone()
}

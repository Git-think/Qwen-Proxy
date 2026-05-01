import { STORAGE_KEYS } from './constants'

export function getApiKey() {
  return localStorage.getItem(STORAGE_KEYS.API_KEY) || ''
}

export function setApiKey(key) {
  localStorage.setItem(STORAGE_KEYS.API_KEY, key)
}

export function removeApiKey() {
  localStorage.removeItem(STORAGE_KEYS.API_KEY)
}

export function getConversations() {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

export function saveConversations(conversations) {
  localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(conversations))
}

export function getActiveConversationId() {
  return localStorage.getItem(STORAGE_KEYS.ACTIVE_CONVERSATION) || null
}

export function setActiveConversationId(id) {
  localStorage.setItem(STORAGE_KEYS.ACTIVE_CONVERSATION, id)
}

export function getSelectedModel() {
  return localStorage.getItem(STORAGE_KEYS.SELECTED_MODEL) || ''
}

export function setSelectedModel(model) {
  localStorage.setItem(STORAGE_KEYS.SELECTED_MODEL, model)
}

export function getEnableThinking() {
  return localStorage.getItem(STORAGE_KEYS.ENABLE_THINKING) === '1'
}

export function setEnableThinking(on) {
  localStorage.setItem(STORAGE_KEYS.ENABLE_THINKING, on ? '1' : '0')
}

export function getEnableSearch() {
  return localStorage.getItem(STORAGE_KEYS.ENABLE_SEARCH) === '1'
}

export function setEnableSearch(on) {
  localStorage.setItem(STORAGE_KEYS.ENABLE_SEARCH, on ? '1' : '0')
}

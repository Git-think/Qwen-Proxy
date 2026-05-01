export const API_ENDPOINTS = {
  MODELS: '/v1/models',
  CHAT_COMPLETIONS: '/v1/chat/completions',
  VERIFY: '/verify',
  HEALTH: '/health',
  GET_ALL_ACCOUNTS: '/api/getAllAccounts',
  SET_ACCOUNT: '/api/setAccount',
  DELETE_ACCOUNT: '/api/deleteAccount',
  REFRESH_ACCOUNT: '/api/refreshAccount',
  REFRESH_ALL_ACCOUNTS: '/api/refreshAllAccounts',
  VERCEL_INFO: '/api/vercel/info',
  VERCEL_STATUS: '/api/vercel/status',
  VERCEL_ENV: '/api/vercel/env',
  VERCEL_REDEPLOY: '/api/vercel/redeploy',
  SERVICE_INFO: '/',
}

export const STORAGE_KEYS = {
  API_KEY: 'qwen2api_key',
  CONVERSATIONS: 'qwen2api_conversations',
  ACTIVE_CONVERSATION: 'qwen2api_active_conversation',
  SELECTED_MODEL: 'qwen2api_selected_model',
  ENABLE_THINKING: 'qwen2api_enable_thinking',
  ENABLE_SEARCH: 'qwen2api_enable_search',
}

export const DEFAULT_MODEL = 'qwen3.6-plus'

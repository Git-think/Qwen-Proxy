const express = require('express')
const router = express.Router()
const { validateApiKey } = require('../middlewares/authorization.js')
const { processRequestBody } = require('../middlewares/chat-middleware.js')
const { handleChatCompletion, handleStreamResponse, handleNonStreamResponse, setResponseHeaders } = require('../controllers/chat.js')
const { anthropicToOpenAI, openaiToAnthropicResponse, streamOpenAIToAnthropic } = require('../adapters/anthropic.js')
const { sendChatRequest } = require('../utils/request.js')
const { logger } = require('../utils/logger')
const config = require('../config/index.js')

/**
 * Anthropic API key verification middleware
 * Accepts x-api-key header or Authorization: Bearer header
 */
const anthropicKeyVerify = (req, res, next) => {
  if (config.apiKeys.length === 0) {
    req.isAdmin = true
    req.apiKey = ''
    return next()
  }

  const apiKey = req.headers['x-api-key'] || req.headers['authorization'] || req.headers['Authorization']
  const { isValid, isAdmin } = validateApiKey(apiKey)

  if (!isValid) {
    return res.status(401).json({
      type: 'error',
      error: { type: 'authentication_error', message: 'Invalid API key' }
    })
  }

  req.isAdmin = isAdmin
  req.apiKey = apiKey
  next()
}

/**
 * Handle Anthropic Messages API request
 */
const handleAnthropicMessages = async (req, res) => {
  try {
    const anthropicBody = req.body
    const requestedModel = anthropicBody.model || 'qwen3.6-plus'
    const isStream = anthropicBody.stream || false

    // Convert Anthropic request to OpenAI format
    const openaiBody = anthropicToOpenAI(anthropicBody)

    // Use the internal processRequestBody by setting req.body to openai format
    req.body = openaiBody

    // Process through chat middleware (transforms to internal Qwen format)
    await new Promise((resolve, reject) => {
      processRequestBody(req, res, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })

    // Send request to upstream
    const response_data = await sendChatRequest(req.body)

    if (!response_data.status || !response_data.response) {
      return res.status(500).json({
        type: 'error',
        error: { type: 'api_error', message: 'Failed to send request to upstream' }
      })
    }

    if (isStream) {
      // Streaming: convert OpenAI SSE to Anthropic SSE
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })
      streamOpenAIToAnthropic(res, response_data.response, requestedModel)
    } else {
      // Non-streaming: accumulate response then convert
      const openaiResponse = await accumulateResponse(response_data.response, req.enable_thinking)
      const anthropicResponse = openaiToAnthropicResponse(openaiResponse, requestedModel)
      res.json(anthropicResponse)
    }
  } catch (error) {
    logger.error('Anthropic Messages API error', 'ANTHROPIC', '', error)
    res.status(500).json({
      type: 'error',
      error: { type: 'api_error', message: error.message || 'Internal server error' }
    })
  }
}

/**
 * Accumulate upstream SSE response into a single OpenAI-format response object
 */
function accumulateResponse(response, enable_thinking) {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let fullContent = ''
    let reasoningContent = ''
    // tool_calls accumulator: index → { id, name, arguments(string) }
    const toolCallsByIndex = new Map()
    let totalTokens = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

    response.on('data', (chunk) => {
      const decodeText = decoder.decode(chunk, { stream: true })
      buffer += decodeText

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)
          if (parsed.usage) {
            totalTokens = {
              prompt_tokens: parsed.usage.prompt_tokens || totalTokens.prompt_tokens,
              completion_tokens: parsed.usage.completion_tokens || totalTokens.completion_tokens,
              total_tokens: parsed.usage.total_tokens || totalTokens.total_tokens,
            }
          }

          const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta
          if (!delta) continue

          if (delta.reasoning_content) {
            reasoningContent += delta.reasoning_content
          }
          if (delta.content) {
            fullContent += delta.content
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = (tc && typeof tc.index === 'number') ? tc.index : 0
              const existing = toolCallsByIndex.get(idx) || { id: '', name: '', arguments: '' }
              if (tc.id) existing.id = tc.id
              if (tc.function && tc.function.name) existing.name = tc.function.name
              if (tc.function && typeof tc.function.arguments === 'string') {
                existing.arguments += tc.function.arguments
              }
              toolCallsByIndex.set(idx, existing)
            }
          }
        } catch {
          // skip
        }
      }
    })

    response.on('end', () => {
      const message = { role: 'assistant', content: fullContent }
      if (reasoningContent) {
        message.reasoning_content = reasoningContent
      }
      let finish_reason = 'stop'
      if (toolCallsByIndex.size > 0) {
        const sortedIndices = [...toolCallsByIndex.keys()].sort((a, b) => a - b)
        message.tool_calls = sortedIndices.map(i => {
          const tc = toolCallsByIndex.get(i)
          return {
            id: tc.id || `call_${Date.now()}_${i}`,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments || '{}' }
          }
        })
        finish_reason = 'tool_calls'
      }

      resolve({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.round(Date.now() / 1000),
        choices: [{ index: 0, message, finish_reason }],
        usage: totalTokens,
      })
    })

    response.on('error', (err) => reject(err))
  })
}

// Routes
router.post('/v1/messages', anthropicKeyVerify, handleAnthropicMessages)
router.post('/anthropic/v1/messages', anthropicKeyVerify, handleAnthropicMessages)

module.exports = router

const express = require('express')
const router = express.Router()
const { validateApiKey } = require('../middlewares/authorization.js')
const { processRequestBody } = require('../middlewares/chat-middleware.js')
const { geminiToOpenAI, openaiToGeminiResponse, streamOpenAIToGemini } = require('../adapters/gemini.js')
const { sendChatRequest } = require('../utils/request.js')
const { logger } = require('../utils/logger')
const config = require('../config/index.js')

/**
 * Gemini API key verification middleware
 * Accepts x-goog-api-key header, query param key, or Authorization: Bearer header
 */
const geminiKeyVerify = (req, res, next) => {
  if (config.apiKeys.length === 0) {
    req.isAdmin = true
    req.apiKey = ''
    return next()
  }

  const apiKey = req.headers['x-goog-api-key'] || req.query.key || req.headers['authorization'] || req.headers['Authorization']
  const { isValid, isAdmin } = validateApiKey(apiKey)

  if (!isValid) {
    return res.status(401).json({
      error: { code: 401, message: 'API key not valid. Please pass a valid API key.', status: 'UNAUTHENTICATED' }
    })
  }

  req.isAdmin = isAdmin
  req.apiKey = apiKey
  next()
}

/**
 * Extract model name from URL parameter (remove :generateContent or :streamGenerateContent suffix)
 */
function extractModelFromParam(modelParam) {
  if (!modelParam) return 'qwen3-235b-a22b'
  // The model param comes as "model-name" since Express handles the :method part via route
  return modelParam
}

/**
 * Handle Gemini generateContent (non-streaming)
 */
const handleGenerateContent = async (req, res) => {
  try {
    const geminiBody = req.body
    const urlModel = extractModelFromParam(req.params.model)

    // Convert Gemini request to OpenAI format
    const openaiBody = geminiToOpenAI(geminiBody, urlModel)
    openaiBody.stream = true // upstream always streams, we accumulate

    // Use the internal processRequestBody
    req.body = openaiBody
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
        error: { code: 500, message: 'Failed to send request to upstream', status: 'INTERNAL' }
      })
    }

    // Accumulate response
    const openaiResponse = await accumulateResponse(response_data.response)
    const geminiResponse = openaiToGeminiResponse(openaiResponse)
    res.json(geminiResponse)
  } catch (error) {
    logger.error('Gemini generateContent error', 'GEMINI', '', error)
    res.status(500).json({
      error: { code: 500, message: error.message || 'Internal server error', status: 'INTERNAL' }
    })
  }
}

/**
 * Handle Gemini streamGenerateContent (streaming)
 */
const handleStreamGenerateContent = async (req, res) => {
  try {
    const geminiBody = req.body
    const urlModel = extractModelFromParam(req.params.model)

    // Convert Gemini request to OpenAI format
    const openaiBody = geminiToOpenAI(geminiBody, urlModel)
    openaiBody.stream = true

    // Use the internal processRequestBody
    req.body = openaiBody
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
        error: { code: 500, message: 'Failed to send request to upstream', status: 'INTERNAL' }
      })
    }

    // Stream response in Gemini format
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    streamOpenAIToGemini(res, response_data.response)
  } catch (error) {
    logger.error('Gemini streamGenerateContent error', 'GEMINI', '', error)
    res.status(500).json({
      error: { code: 500, message: error.message || 'Internal server error', status: 'INTERNAL' }
    })
  }
}

/**
 * Accumulate upstream SSE response into a single OpenAI-format response object
 */
function accumulateResponse(response) {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let fullContent = ''
    let reasoningContent = ''
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

      resolve({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.round(Date.now() / 1000),
        choices: [{ index: 0, message, finish_reason: 'stop' }],
        usage: totalTokens,
      })
    })

    response.on('error', (err) => reject(err))
  })
}

// Routes - Gemini v1beta
router.post('/v1beta/models/:model\\:generateContent', geminiKeyVerify, handleGenerateContent)
router.post('/v1beta/models/:model\\:streamGenerateContent', geminiKeyVerify, handleStreamGenerateContent)

// Routes - Gemini v1
router.post('/v1/models/:model\\:generateContent', geminiKeyVerify, handleGenerateContent)
router.post('/v1/models/:model\\:streamGenerateContent', geminiKeyVerify, handleStreamGenerateContent)

module.exports = router

/**
 * Gemini API adapter
 * Converts between Gemini format and internal OpenAI format
 */

/**
 * Convert Gemini generateContent request to OpenAI chat completions format
 */
function geminiToOpenAI(geminiBody, urlModel) {
  const messages = []

  // systemInstruction → system message
  if (geminiBody.systemInstruction) {
    const text = (geminiBody.systemInstruction.parts || []).map(p => p.text).join('\n') || ''
    if (text) messages.push({ role: 'system', content: text })
  }

  // contents → messages
  for (const content of geminiBody.contents || []) {
    const role = content.role === 'model' ? 'assistant' : 'user'
    const parts = content.parts || []

    const openaiContent = []
    for (const part of parts) {
      if (part.text !== undefined) {
        openaiContent.push({ type: 'text', text: part.text })
      } else if (part.inline_data || part.inlineData) {
        const data = part.inline_data || part.inlineData
        const mimeType = data.mime_type || data.mimeType
        const dataUrl = `data:${mimeType};base64,${data.data}`
        openaiContent.push({ type: 'image_url', image_url: { url: dataUrl } })
      } else if (part.functionCall) {
        openaiContent.push({ type: 'text', text: `[Function Call: ${part.functionCall.name}(${JSON.stringify(part.functionCall.args)})]` })
      } else if (part.functionResponse) {
        openaiContent.push({ type: 'text', text: `[Function Response ${part.functionResponse.name}: ${JSON.stringify(part.functionResponse.response)}]` })
      }
    }

    if (openaiContent.length === 1 && openaiContent[0].type === 'text') {
      messages.push({ role, content: openaiContent[0].text })
    } else if (openaiContent.length > 0) {
      messages.push({ role, content: openaiContent })
    }
  }

  // generationConfig
  const gc = geminiBody.generationConfig || {}

  // thinking config
  let enable_thinking = false
  let thinking_budget = undefined
  let reasoning_effort = undefined

  const tc = gc.thinkingConfig
  if (tc) {
    if (tc.thinkingBudget && tc.thinkingBudget > 0) {
      enable_thinking = true
      thinking_budget = tc.thinkingBudget
    } else if (tc.thinkingBudget === -1) {
      enable_thinking = true
      reasoning_effort = 'high'
    } else if (tc.thinkingBudget === 0) {
      enable_thinking = false
    }
    if (tc.thinkingLevel) {
      enable_thinking = tc.thinkingLevel !== 'NONE'
      reasoning_effort = tc.thinkingLevel.toLowerCase()
    }
    if (tc.includeThoughts) {
      enable_thinking = true
    }
  }

  // Search toggle
  let model = urlModel || 'qwen3-235b-a22b'
  const hasSearch = (geminiBody.tools || []).some(t =>
    t.google_search || t.googleSearch || t.google_search_retrieval || t.googleSearchRetrieval
  )
  if (hasSearch && !model.includes('-search')) {
    model = model + '-search'
  }

  return {
    model,
    messages,
    max_tokens: gc.maxOutputTokens,
    stream: false, // controlled by route layer
    temperature: gc.temperature,
    top_p: gc.topP,
    enable_thinking,
    thinking_budget,
    reasoning_effort,
    stop: gc.stopSequences,
  }
}

/**
 * Convert OpenAI non-streaming response to Gemini format
 */
function openaiToGeminiResponse(openaiResponse) {
  const choice = openaiResponse.choices && openaiResponse.choices[0]
  const parts = []

  // reasoning_content → thought part
  if (choice && choice.message && choice.message.reasoning_content) {
    parts.push({ text: choice.message.reasoning_content, thought: true })
  }

  // content → text part
  if (choice && choice.message && choice.message.content) {
    parts.push({ text: choice.message.content })
  }

  const finishReasonMap = { stop: 'STOP', length: 'MAX_TOKENS' }

  return {
    candidates: [{
      content: { parts, role: 'model' },
      finishReason: finishReasonMap[(choice && choice.finish_reason)] || 'STOP',
      index: 0,
    }],
    usageMetadata: {
      promptTokenCount: (openaiResponse.usage && openaiResponse.usage.prompt_tokens) || 0,
      candidatesTokenCount: (openaiResponse.usage && openaiResponse.usage.completion_tokens) || 0,
      totalTokenCount: (openaiResponse.usage && openaiResponse.usage.total_tokens) || 0,
    }
  }
}

/**
 * Transform OpenAI SSE stream to Gemini SSE stream
 * Each chunk outputs a Gemini GenerateContentResponse
 */
function streamOpenAIToGemini(res, upstreamResponse) {
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let inputTokens = 0
  let outputTokens = 0

  upstreamResponse.on('data', (chunk) => {
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
        const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta
        const finishReason = parsed.choices && parsed.choices[0] && parsed.choices[0].finish_reason

        if (parsed.usage) {
          inputTokens = parsed.usage.prompt_tokens || inputTokens
          outputTokens = parsed.usage.completion_tokens || outputTokens
        }

        if (!delta) continue

        const parts = []

        if (delta.reasoning_content) {
          parts.push({ text: delta.reasoning_content, thought: true })
        }
        if (delta.content) {
          parts.push({ text: delta.content })
        }

        if (parts.length > 0) {
          const geminiChunk = {
            candidates: [{
              content: { parts, role: 'model' },
              index: 0,
            }],
            usageMetadata: {
              promptTokenCount: inputTokens,
              candidatesTokenCount: outputTokens,
              totalTokenCount: inputTokens + outputTokens,
            }
          }

          if (finishReason) {
            const finishReasonMap = { stop: 'STOP', length: 'MAX_TOKENS' }
            geminiChunk.candidates[0].finishReason = finishReasonMap[finishReason] || 'STOP'
          }

          res.write(`data: ${JSON.stringify(geminiChunk)}\n\n`)
        }

        // If finish with no content delta, send final chunk
        if (finishReason && parts.length === 0) {
          const finishReasonMap = { stop: 'STOP', length: 'MAX_TOKENS' }
          const finalChunk = {
            candidates: [{
              content: { parts: [], role: 'model' },
              finishReason: finishReasonMap[finishReason] || 'STOP',
              index: 0,
            }],
            usageMetadata: {
              promptTokenCount: inputTokens,
              candidatesTokenCount: outputTokens,
              totalTokenCount: inputTokens + outputTokens,
            }
          }
          res.write(`data: ${JSON.stringify(finalChunk)}\n\n`)
        }
      } catch {
        // skip malformed JSON
      }
    }
  })

  upstreamResponse.on('end', () => {
    res.end()
  })

  upstreamResponse.on('error', () => {
    res.end()
  })
}

module.exports = {
  geminiToOpenAI,
  openaiToGeminiResponse,
  streamOpenAIToGemini
}

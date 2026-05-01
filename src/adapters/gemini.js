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

  // contents → messages. Gemini packs functionCall into model parts and
  // functionResponse into user parts; OpenAI splits these into
  //   assistant.tool_calls and role:'tool' messages.
  let toolUseCounter = 0
  // Track most-recent functionCall name → fabricated id, so the matching
  // functionResponse (which carries name only, not id) can resolve back.
  const lastIdByName = new Map()

  for (const content of geminiBody.contents || []) {
    const role = content.role === 'model' ? 'assistant' : 'user'
    const parts = content.parts || []

    if (role === 'assistant') {
      const openaiContent = []
      const toolCalls = []
      for (const part of parts) {
        if (part.text !== undefined) {
          openaiContent.push({ type: 'text', text: part.text })
        } else if (part.inline_data || part.inlineData) {
          const data = part.inline_data || part.inlineData
          const mimeType = data.mime_type || data.mimeType
          const dataUrl = `data:${mimeType};base64,${data.data}`
          openaiContent.push({ type: 'image_url', image_url: { url: dataUrl } })
        } else if (part.functionCall) {
          const id = `call_${Date.now()}_${toolUseCounter++}`
          lastIdByName.set(part.functionCall.name, id)
          toolCalls.push({
            id,
            type: 'function',
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args || {})
            }
          })
        }
      }
      const m = { role: 'assistant' }
      if (openaiContent.length === 1 && openaiContent[0].type === 'text') {
        m.content = openaiContent[0].text
      } else if (openaiContent.length > 0) {
        m.content = openaiContent
      } else {
        m.content = ''
      }
      if (toolCalls.length > 0) m.tool_calls = toolCalls
      messages.push(m)
      continue
    }

    // user role: split functionResponse into role:'tool' messages
    const userContent = []
    const toolResults = []
    for (const part of parts) {
      if (part.text !== undefined) {
        userContent.push({ type: 'text', text: part.text })
      } else if (part.inline_data || part.inlineData) {
        const data = part.inline_data || part.inlineData
        const mimeType = data.mime_type || data.mimeType
        const dataUrl = `data:${mimeType};base64,${data.data}`
        userContent.push({ type: 'image_url', image_url: { url: dataUrl } })
      } else if (part.functionResponse) {
        const name = part.functionResponse.name
        const id = lastIdByName.get(name) || `call_${Date.now()}_${toolUseCounter++}`
        let body = part.functionResponse.response
        if (body && typeof body === 'object' && body.content !== undefined) body = body.content
        const text = typeof body === 'string' ? body : JSON.stringify(body || {})
        toolResults.push({ role: 'tool', tool_call_id: id, content: text })
      }
    }
    if (userContent.length === 1 && userContent[0].type === 'text') {
      messages.push({ role: 'user', content: userContent[0].text })
    } else if (userContent.length > 0) {
      messages.push({ role: 'user', content: userContent })
    }
    for (const t of toolResults) messages.push(t)
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
  let model = urlModel || 'qwen3.6-plus'
  const hasSearch = (geminiBody.tools || []).some(t =>
    t.google_search || t.googleSearch || t.google_search_retrieval || t.googleSearchRetrieval
    || (t.type === 'function' && t.function && t.function.name === 'googleSearch')
  )
  if (hasSearch && !model.includes('-search')) {
    model = model + '-search'
  }

  // Function declarations → OpenAI tools. Skip search-only entries.
  const fnDeclTools = []
  for (const t of geminiBody.tools || []) {
    if (Array.isArray(t.functionDeclarations)) {
      for (const fd of t.functionDeclarations) {
        if (!fd || !fd.name) continue
        fnDeclTools.push({
          type: 'function',
          function: {
            name: fd.name,
            description: fd.description || '',
            parameters: fd.parameters || { type: 'object', properties: {} }
          }
        })
      }
    }
  }
  const tools = fnDeclTools.length > 0 ? fnDeclTools : undefined

  // toolConfig.functionCallingConfig → OpenAI tool_choice
  let tool_choice = undefined
  const fcc = geminiBody.toolConfig && geminiBody.toolConfig.functionCallingConfig
  if (fcc) {
    const mode = String(fcc.mode || '').toUpperCase()
    if (mode === 'AUTO') tool_choice = 'auto'
    else if (mode === 'NONE') tool_choice = 'none'
    else if (mode === 'ANY') {
      const allowed = fcc.allowedFunctionNames
      if (Array.isArray(allowed) && allowed.length === 1) {
        tool_choice = { type: 'function', function: { name: allowed[0] } }
      } else {
        tool_choice = 'required'
      }
    }
  }

  const out = {
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
  if (tools) out.tools = tools
  if (tool_choice !== undefined) out.tool_choice = tool_choice
  return out
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

  // tool_calls → functionCall parts
  if (choice && choice.message && Array.isArray(choice.message.tool_calls)) {
    for (const tc of choice.message.tool_calls) {
      let args = {}
      try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* keep empty */ }
      parts.push({ functionCall: { name: tc.function.name, args } })
    }
  }

  const finishReasonMap = { stop: 'STOP', length: 'MAX_TOKENS', tool_calls: 'STOP' }

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
  let hadToolCalls = false

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
        // tool_calls → functionCall parts. Upstream sieve emits whole calls
        // (id + name + complete arguments string) per delta, so we just JSON
        // parse the arguments and forward as a Gemini functionCall.
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const name = tc && tc.function && tc.function.name
            const argsStr = (tc && tc.function && tc.function.arguments) || '{}'
            let args = {}
            try { args = JSON.parse(argsStr) } catch { /* keep empty */ }
            parts.push({ functionCall: { name, args } })
            hadToolCalls = true
          }
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
            const finishReasonMap = { stop: 'STOP', length: 'MAX_TOKENS', tool_calls: 'STOP' }
            geminiChunk.candidates[0].finishReason = finishReasonMap[finishReason] || 'STOP'
          }

          res.write(`data: ${JSON.stringify(geminiChunk)}\n\n`)
        }

        // If finish with no content delta, send final chunk
        if (finishReason && parts.length === 0) {
          const finishReasonMap = { stop: 'STOP', length: 'MAX_TOKENS', tool_calls: 'STOP' }
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

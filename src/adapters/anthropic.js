/**
 * Anthropic Messages API adapter
 * Converts between Anthropic format and internal OpenAI format
 */

/**
 * Convert Anthropic Messages API request to OpenAI chat completions format
 */
function anthropicToOpenAI(anthropicBody) {
  const messages = []

  // system → system message
  if (anthropicBody.system) {
    const systemText = typeof anthropicBody.system === 'string'
      ? anthropicBody.system
      : anthropicBody.system.map(b => b.text).join('\n')
    messages.push({ role: 'system', content: systemText })
  }

  // Convert messages
  for (const msg of anthropicBody.messages || []) {
    const role = msg.role // "user" or "assistant"

    if (typeof msg.content === 'string') {
      messages.push({ role, content: msg.content })
      continue
    }

    if (!Array.isArray(msg.content)) continue

    // Anthropic packs tool_use into assistant messages, tool_result into user
    // messages, sometimes alongside text/image. OpenAI splits these:
    //   assistant.text/images → assistant message with content (+ tool_calls)
    //   tool_result blocks    → separate role:'tool' message per result
    if (role === 'assistant') {
      const openaiContent = []
      const toolCalls = []
      for (const block of msg.content) {
        if (block.type === 'text') {
          openaiContent.push({ type: 'text', text: block.text })
        } else if (block.type === 'image') {
          const dataUrl = `data:${block.source.media_type};base64,${block.source.data}`
          openaiContent.push({ type: 'image_url', image_url: { url: dataUrl } })
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: JSON.stringify(block.input || {}) }
          })
        } else if (block.type === 'thinking') {
          continue
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

    // role === 'user': split tool_result blocks into separate role:'tool' msgs
    const userText = []
    const toolResults = []
    for (const block of msg.content) {
      if (block.type === 'text') {
        userText.push({ type: 'text', text: block.text })
      } else if (block.type === 'image') {
        const dataUrl = `data:${block.source.media_type};base64,${block.source.data}`
        userText.push({ type: 'image_url', image_url: { url: dataUrl } })
      } else if (block.type === 'tool_result') {
        const resultText = typeof block.content === 'string' ? block.content :
          (Array.isArray(block.content) ? block.content.map(c => c.text || JSON.stringify(c)).join('') : JSON.stringify(block.content))
        toolResults.push({ role: 'tool', tool_call_id: block.tool_use_id, content: resultText })
      }
    }
    if (userText.length === 1 && userText[0].type === 'text') {
      messages.push({ role: 'user', content: userText[0].text })
    } else if (userText.length > 0) {
      messages.push({ role: 'user', content: userText })
    }
    for (const t of toolResults) messages.push(t)
  }

  // thinking config conversion
  let enable_thinking = false
  let thinking_budget = undefined
  let reasoning_effort = undefined

  if (anthropicBody.thinking) {
    if (anthropicBody.thinking.type === 'enabled') {
      enable_thinking = true
      thinking_budget = anthropicBody.thinking.budget_tokens
    } else if (anthropicBody.thinking.type === 'adaptive') {
      enable_thinking = true
      reasoning_effort = 'high'
    }
    // type === 'disabled' → default no thinking
  }

  // tools and tool_choice
  let tools = undefined
  if (Array.isArray(anthropicBody.tools) && anthropicBody.tools.length > 0) {
    tools = anthropicBody.tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.input_schema || { type: 'object', properties: {} }
      }
    }))
  }
  let tool_choice = undefined
  const tc = anthropicBody.tool_choice
  if (tc && typeof tc === 'object') {
    if (tc.type === 'auto') tool_choice = 'auto'
    else if (tc.type === 'any') tool_choice = 'required'
    else if (tc.type === 'tool' && tc.name) tool_choice = { type: 'function', function: { name: tc.name } }
    else if (tc.type === 'none') tool_choice = 'none'
  }

  const out = {
    model: anthropicBody.model || 'qwen3.6-plus',
    messages,
    max_tokens: anthropicBody.max_tokens,
    stream: anthropicBody.stream || false,
    temperature: anthropicBody.temperature,
    top_p: anthropicBody.top_p,
    enable_thinking,
    thinking_budget,
    reasoning_effort,
    stop: anthropicBody.stop_sequences,
  }
  if (tools) out.tools = tools
  if (tool_choice !== undefined) out.tool_choice = tool_choice
  return out
}

/**
 * Convert OpenAI non-streaming response to Anthropic Messages format
 */
function openaiToAnthropicResponse(openaiResponse, model) {
  const choice = openaiResponse.choices && openaiResponse.choices[0]
  const content = []

  // reasoning_content → thinking block
  if (choice && choice.message && choice.message.reasoning_content) {
    content.push({
      type: 'thinking',
      thinking: choice.message.reasoning_content,
      signature: ''
    })
  }

  // content → text block
  if (choice && choice.message && choice.message.content) {
    content.push({
      type: 'text',
      text: choice.message.content
    })
  }

  // tool_calls → tool_use blocks
  let hasToolUse = false
  if (choice && choice.message && Array.isArray(choice.message.tool_calls)) {
    for (const tc of choice.message.tool_calls) {
      let input = {}
      try { input = JSON.parse(tc.function.arguments || '{}') } catch { /* keep empty */ }
      content.push({
        type: 'tool_use',
        id: tc.id || `toolu_${Date.now()}`,
        name: tc.function.name,
        input
      })
      hasToolUse = true
    }
  }

  // stop_reason mapping
  let stop_reason = 'end_turn'
  if (hasToolUse || (choice && choice.finish_reason === 'tool_calls')) {
    stop_reason = 'tool_use'
  } else if (choice && choice.finish_reason === 'length') {
    stop_reason = 'max_tokens'
  } else if (choice && choice.finish_reason === 'stop') {
    stop_reason = 'end_turn'
  } else if (choice && choice.finish_reason) {
    stop_reason = choice.finish_reason
  }

  return {
    id: openaiResponse.id || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: model,
    content,
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: (openaiResponse.usage && openaiResponse.usage.prompt_tokens) || 0,
      output_tokens: (openaiResponse.usage && openaiResponse.usage.completion_tokens) || 0,
    }
  }
}

/**
 * Transform OpenAI SSE stream to Anthropic SSE stream
 * Reads OpenAI format chunks and writes Anthropic event sequence
 */
function streamOpenAIToAnthropic(res, upstreamResponse, model) {
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let blockIndex = 0
  let inThinking = false
  let inText = false
  let hasToolUse = false
  let inputTokens = 0
  let outputTokens = 0

  // Helper to write SSE event
  const writeEvent = (eventType, data) => {
    res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const closeOpenBlock = () => {
    if (inThinking) {
      writeEvent('content_block_stop', { type: 'content_block_stop', index: blockIndex })
      blockIndex++
      inThinking = false
    }
    if (inText) {
      writeEvent('content_block_stop', { type: 'content_block_stop', index: blockIndex })
      blockIndex++
      inText = false
    }
  }

  // Send message_start
  writeEvent('message_start', {
    type: 'message_start',
    message: {
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 }
    }
  })

  // Send ping
  writeEvent('ping', { type: 'ping' })

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

        if (delta && delta.reasoning_content) {
          if (!inThinking) {
            // Start thinking block
            writeEvent('content_block_start', {
              type: 'content_block_start',
              index: blockIndex,
              content_block: { type: 'thinking', thinking: '' }
            })
            inThinking = true
          }
          writeEvent('content_block_delta', {
            type: 'content_block_delta',
            index: blockIndex,
            delta: { type: 'thinking_delta', thinking: delta.reasoning_content }
          })
        }

        if (delta && delta.content) {
          if (inThinking) {
            // Close thinking block
            writeEvent('content_block_stop', {
              type: 'content_block_stop',
              index: blockIndex
            })
            blockIndex++
            inThinking = false
          }
          if (!inText) {
            // Start text block
            writeEvent('content_block_start', {
              type: 'content_block_start',
              index: blockIndex,
              content_block: { type: 'text', text: '' }
            })
            inText = true
          }
          writeEvent('content_block_delta', {
            type: 'content_block_delta',
            index: blockIndex,
            delta: { type: 'text_delta', text: delta.content }
          })
        }

        // tool_calls → tool_use blocks. Our upstream sieve emits each call
        // in one shot (id + name + complete arguments string), so we send
        // start + input_json_delta + stop together for each call.
        if (delta && Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
          closeOpenBlock()
          for (const tc of delta.tool_calls) {
            const id = (tc && tc.id) || `toolu_${Date.now()}_${blockIndex}`
            const name = tc && tc.function && tc.function.name
            const args = (tc && tc.function && tc.function.arguments) || ''
            writeEvent('content_block_start', {
              type: 'content_block_start',
              index: blockIndex,
              content_block: { type: 'tool_use', id, name, input: {} }
            })
            if (args) {
              writeEvent('content_block_delta', {
                type: 'content_block_delta',
                index: blockIndex,
                delta: { type: 'input_json_delta', partial_json: args }
              })
            }
            writeEvent('content_block_stop', {
              type: 'content_block_stop',
              index: blockIndex
            })
            blockIndex++
            hasToolUse = true
          }
        }

        if (finishReason) {
          closeOpenBlock()
        }
      } catch {
        // skip malformed JSON
      }
    }
  })

  upstreamResponse.on('end', () => {
    closeOpenBlock()

    // message_delta with stop_reason
    const stopReason = hasToolUse ? 'tool_use' : 'end_turn'
    writeEvent('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: outputTokens }
    })

    // message_stop
    writeEvent('message_stop', { type: 'message_stop' })

    res.end()
  })

  upstreamResponse.on('error', () => {
    res.end()
  })
}

module.exports = {
  anthropicToOpenAI,
  openaiToAnthropicResponse,
  streamOpenAIToAnthropic
}

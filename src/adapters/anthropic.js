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

    // content blocks array
    if (Array.isArray(msg.content)) {
      const openaiContent = []

      for (const block of msg.content) {
        if (block.type === 'text') {
          openaiContent.push({ type: 'text', text: block.text })
        } else if (block.type === 'image') {
          // base64 image
          const dataUrl = `data:${block.source.media_type};base64,${block.source.data}`
          openaiContent.push({ type: 'image_url', image_url: { url: dataUrl } })
        } else if (block.type === 'tool_use') {
          // assistant tool_use → text representation
          openaiContent.push({ type: 'text', text: `[Tool Call: ${block.name}(${JSON.stringify(block.input)})]` })
        } else if (block.type === 'tool_result') {
          // user tool_result → text representation
          const resultText = typeof block.content === 'string' ? block.content :
            (Array.isArray(block.content) ? block.content.map(c => c.text || '').join('') : JSON.stringify(block.content))
          openaiContent.push({ type: 'text', text: `[Tool Result: ${resultText}]` })
        } else if (block.type === 'thinking') {
          // thinking block round-trip, skip
          continue
        }
      }

      // Simplify single text block to string
      if (openaiContent.length === 1 && openaiContent[0].type === 'text') {
        messages.push({ role, content: openaiContent[0].text })
      } else if (openaiContent.length > 0) {
        messages.push({ role, content: openaiContent })
      }
    }
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

  return {
    model: anthropicBody.model || 'qwen3-235b-a22b',
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

  return {
    id: openaiResponse.id || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: model,
    content,
    stop_reason: choice && choice.finish_reason === 'stop' ? 'end_turn' : (choice && choice.finish_reason) || 'end_turn',
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
  let inputTokens = 0
  let outputTokens = 0

  // Helper to write SSE event
  const writeEvent = (eventType, data) => {
    res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`)
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

        if (finishReason) {
          // Close any open block
          if (inThinking) {
            writeEvent('content_block_stop', {
              type: 'content_block_stop',
              index: blockIndex
            })
            blockIndex++
            inThinking = false
          }
          if (inText) {
            writeEvent('content_block_stop', {
              type: 'content_block_stop',
              index: blockIndex
            })
            blockIndex++
            inText = false
          }
        }
      } catch {
        // skip malformed JSON
      }
    }
  })

  upstreamResponse.on('end', () => {
    // Close any remaining open blocks
    if (inThinking) {
      writeEvent('content_block_stop', {
        type: 'content_block_stop',
        index: blockIndex
      })
      blockIndex++
    }
    if (inText) {
      writeEvent('content_block_stop', {
        type: 'content_block_stop',
        index: blockIndex
      })
      blockIndex++
    }

    // message_delta with stop_reason
    writeEvent('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: outputTokens }
    })

    // message_stop
    writeEvent('message_stop', { type: 'message_stop' })

    res.end()
  })

  upstreamResponse.on('error', (err) => {
    res.end()
  })
}

module.exports = {
  anthropicToOpenAI,
  openaiToAnthropicResponse,
  streamOpenAIToAnthropic
}

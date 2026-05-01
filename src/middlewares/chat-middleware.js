const { generateUUID } = require('../utils/tools.js')
const { isChatType, isThinkingEnabled, parserModel, parserMessages } = require('../utils/chat-helpers.js')
const { logger } = require('../utils/logger')
const {
  hasTools,
  buildToolPromptBlock,
  serializeAssistantToolCalls,
  serializeToolResult,
} = require('../utils/toolcall.js')

/**
 * Rewrite OpenAI-style messages so the upstream model (which has no native
 * tool calling) sees a textual conversation. Only invoked when the request
 * carries a non-empty `tools` array.
 *
 * - assistant.tool_calls → DSML <|DSML|tool_calls> appended to content
 * - role:'tool'         → role:'user' with a <|DSML|tool_result> block
 * - prepended system message holds the tool schemas + format instructions
 */
function injectToolCallContext(messages, tools) {
  const rewritten = (messages || []).map((m) => {
    if (!m || typeof m !== 'object') return m
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      const dsml = serializeAssistantToolCalls(m.tool_calls)
      const baseText = typeof m.content === 'string' ? m.content : ''
      const merged = baseText ? baseText + '\n' + dsml : dsml
      const out = { ...m, content: merged }
      delete out.tool_calls
      return out
    }
    if (m.role === 'tool') {
      return { role: 'user', content: serializeToolResult(m) }
    }
    return m
  })
  const promptBlock = buildToolPromptBlock(tools)
  return [{ role: 'system', content: promptBlock }, ...rewritten]
}

/**
 * Process chat request body middleware
 * Parse and transform request parameters to internal format
 */
const processRequestBody = async (req, res, next) => {
  try {
    const body = {
      "stream": true,
      "incremental_output": true,
      "chat_type": "t2t",
      "model": "qwen3.6-plus",
      "messages": [],
      "session_id": generateUUID(),
      "id": generateUUID(),
      "sub_chat_type": "t2t",
      "chat_mode": "normal"
    }

    let {
      messages,
      model,
      stream,
      enable_thinking,
      thinking_budget,
      reasoning_effort,
      size
    } = req.body

    // Process stream parameter
    if (stream === true || stream === 'true') {
      body.stream = true
    } else {
      body.stream = false
    }

    // Process chat_type
    body.chat_type = isChatType(model)
    req.enable_web_search = body.chat_type === 'search' ? true : false

    // Process model
    body.model = await parserModel(model)

    // Tool-call gate: only activate when the client actually sent `tools`.
    // When inactive, behavior is byte-identical to before this feature existed.
    req.toolcall_enabled = false
    if (hasTools(req.body)) {
      req.toolcall_enabled = true
      req.toolcall_tools = req.body.tools
      messages = injectToolCallContext(messages, req.body.tools)
    }

    // Process messages
    body.messages = await parserMessages(messages, isThinkingEnabled(model, enable_thinking, thinking_budget, reasoning_effort), body.chat_type)

    // Process enable_thinking
    req.enable_thinking = isThinkingEnabled(model, enable_thinking, thinking_budget, reasoning_effort).thinking_enabled

    // Process sub_chat_type
    body.sub_chat_type = body.chat_type

    // Process image size
    if (size) {
      body.size = size
    }

    req.body = body
    next()
  } catch (e) {
    logger.error('Error processing request body', 'MIDDLEWARE', '', e)
    res.status(500).json({
      status: 500,
      message: "Error processing request body"
    })
  }
}

module.exports = {
  processRequestBody
}

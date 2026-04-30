const { generateUUID } = require('../utils/tools.js')
const { isChatType, isThinkingEnabled, parserModel, parserMessages } = require('../utils/chat-helpers.js')
const { logger } = require('../utils/logger')

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
      "model": "qwen3-235b-a22b",
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

/**
 * Simple Token Estimation
 * Uses character-based estimation instead of tiktoken for serverless compatibility
 */

/**
 * Estimate token count from text
 * @param {string} text - Text to count
 * @returns {number} Estimated token count
 */
function countTokens(text) {
  if (!text || typeof text !== 'string') return 0
  // Rough estimate: ~4 characters per token for English, ~2 for CJK
  return Math.ceil(text.length / 4)
}

/**
 * Count tokens in a messages array
 * @param {Array} messages - Messages array
 * @returns {number} Total token count
 */
function countMessagesTokens(messages) {
  if (!Array.isArray(messages)) return 0

  let totalTokens = 0
  const messageOverhead = 4

  for (const message of messages) {
    totalTokens += messageOverhead

    if (message.role) {
      totalTokens += countTokens(message.role)
    }

    if (typeof message.content === 'string') {
      totalTokens += countTokens(message.content)
    } else if (Array.isArray(message.content)) {
      for (const item of message.content) {
        if (item.text) {
          totalTokens += countTokens(item.text)
        }
      }
    }

    if (message.function_call) {
      totalTokens += countTokens(JSON.stringify(message.function_call))
    }
  }

  totalTokens += 2
  return totalTokens
}

/**
 * Create usage object with token counts
 * @param {Array|string} promptMessages - Prompt messages or text
 * @param {string} completionText - Completion text
 * @param {object} realUsage - Real usage data (if available)
 * @returns {object} Usage object
 */
function createUsageObject(promptMessages, completionText = '', realUsage = null) {
  // If real usage data is available, use it
  if (realUsage && realUsage.prompt_tokens && realUsage.completion_tokens) {
    return {
      prompt_tokens: realUsage.prompt_tokens,
      completion_tokens: realUsage.completion_tokens,
      total_tokens: realUsage.total_tokens || (realUsage.prompt_tokens + realUsage.completion_tokens)
    }
  }

  // Calculate prompt tokens
  let promptTokens = 0
  if (Array.isArray(promptMessages)) {
    promptTokens = countMessagesTokens(promptMessages)
  } else if (typeof promptMessages === 'string') {
    promptTokens = countTokens(promptMessages)
  }

  // Calculate completion tokens
  const completionTokens = countTokens(completionText)

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens
  }
}

module.exports = {
  countTokens,
  countMessagesTokens,
  createUsageObject
}

const { logger } = require('./logger')
const { sha256Encrypt, generateUUID } = require('./tools.js')
const { uploadFileToQwenOss } = require('./upload.js')
const { getLatestModels } = require('../models/models-map.js')
const accountManager = require('./account.js')
const CacheManager = require('./img-caches.js')

const MODEL_SUFFIXES = [
    '-thinking-search',
    '-image-edit',
    '-deep-research',
    '-thinking',
    '-search',
    '-video',
    '-image'
]

const DATA_URI_REGEX = /^data:(.+);base64,(.*)$/i
const HTTP_URL_REGEX = /^https?:\/\//i

/**
 * Split model suffix
 * @param {string} model - Original model name
 * @returns {{ baseModel: string, suffix: string }} Split result
 */
const splitModelSuffix = (model) => {
    const modelName = String(model || '')

    for (const suffix of MODEL_SUFFIXES) {
        if (modelName.endsWith(suffix)) {
            return {
                baseModel: modelName.slice(0, -suffix.length),
                suffix
            }
        }
    }

    return {
        baseModel: modelName,
        suffix: ''
    }
}

/**
 * Find matched model by alias
 * @param {Array<object>} models - Model list
 * @param {string} modelName - Input model name
 * @returns {object|undefined} Matched model
 */
const findMatchedModel = (models, modelName) => {
    const normalizedModelName = String(modelName || '').trim().toLowerCase()
    if (!normalizedModelName) {
        return undefined
    }

    return models.find(model => {
        const aliases = [
            model?.id,
            model?.name,
            model?.display_name,
            model?.upstream_id
        ]

        return aliases
            .filter(Boolean)
            .some(alias => String(alias).trim().toLowerCase() === normalizedModelName)
    })
}

/**
 * Check if content item is media
 * @param {object} item - Content item
 * @returns {boolean} Whether it's a media content item
 */
const isMediaContentItem = (item) => ['image', 'image_url', 'video', 'video_url', 'input_video'].includes(item?.type)

/**
 * Extract media descriptor
 * @param {object} item - Content item
 * @returns {{ mediaType: string, url: string|null }|null} Media info
 */
const getMediaDescriptor = (item) => {
    if (!item) return null

    if (item.type === 'image' || item.type === 'image_url') {
        return {
            mediaType: 'image',
            url: item.image || item.url || item.image_url?.url || null
        }
    }

    if (item.type === 'video' || item.type === 'video_url') {
        return {
            mediaType: 'video',
            url: item.video || item.url || item.video_url?.url || null
        }
    }

    if (item.type === 'input_video') {
        return {
            mediaType: 'video',
            url: item.input_video?.url || item.input_video?.video_url || item.video_url?.url || null
        }
    }

    return null
}

/**
 * Build normalized media content item
 * @param {string} mediaType - Media type
 * @param {string} url - Media URL
 * @returns {object} Normalized content item
 */
const buildNormalizedMediaItem = (mediaType, url) => {
    if (mediaType === 'video') {
        return { type: 'video', video: url }
    }
    return { type: 'image', image: url }
}

/**
 * Normalize and upload media content item
 * @param {object} item - Original content item
 * @param {object} imgCacheManager - Image cache manager
 * @returns {Promise<object|null>} Normalized media content item
 */
const normalizeMediaContentItem = async (item, imgCacheManager) => {
    const mediaDescriptor = getMediaDescriptor(item)
    if (!mediaDescriptor?.url) return null

    const { mediaType, url } = mediaDescriptor
    if (HTTP_URL_REGEX.test(url)) {
        return buildNormalizedMediaItem(mediaType, url)
    }

    const matchedDataURI = url.match(DATA_URI_REGEX)
    if (!matchedDataURI) {
        return buildNormalizedMediaItem(mediaType, url)
    }

    const mimeType = matchedDataURI[1]
    const base64Content = matchedDataURI[2]
    const fileExtension = mimeType?.split('/')[1] || (mediaType === 'video' ? 'mp4' : 'png')
    const filename = `${generateUUID()}.${fileExtension}`
    const signature = sha256Encrypt(base64Content)

    try {
        if (mediaType === 'image' && imgCacheManager.cacheIsExist(signature)) {
            return buildNormalizedMediaItem(mediaType, imgCacheManager.getCache(signature).url)
        }

        const buffer = Buffer.from(base64Content, 'base64')
        const uploadResult = await uploadFileToQwenOss(buffer, filename, accountManager.getAccountToken())

        if (!uploadResult || uploadResult.status !== 200) {
            return null
        }

        if (mediaType === 'image') {
            imgCacheManager.addCache(signature, uploadResult.file_url)
        }

        return buildNormalizedMediaItem(mediaType, uploadResult.file_url)
    } catch (error) {
        logger.error(`${mediaType} upload failed`, 'UPLOAD', '', error)
        return null
    }
}

/**
 * Determine chat type from model name
 * @param {string} model - Model name
 * @returns {string} Chat type
 */
const isChatType = (model) => {
    if (!model) return 't2t'
    if (model.includes('-search')) return 'search'
    if (model.includes('-image-edit')) return 'image_edit'
    if (model.includes('-image')) return 't2i'
    if (model.includes('-video')) return 't2v'
    if (model.includes('-deep-research')) return 'deep_research'
    return 't2t'
}

/**
 * Determine thinking configuration
 * Supports multiple ways to enable thinking:
 *   1. Model suffix: model name contains '-thinking'
 *   2. enable_thinking: true/false parameter
 *   3. reasoning_effort: 'low'/'medium'/'high' (OpenAI compatible)
 * Default: thinking is OFF unless explicitly enabled
 *
 * @param {string} model - Model name
 * @param {boolean} enable_thinking - Whether thinking is enabled
 * @param {number} thinking_budget - Thinking budget (token count)
 * @param {string} reasoning_effort - OpenAI-compatible reasoning effort: 'low'/'medium'/'high'
 * @returns {object} Thinking config object
 */
const isThinkingEnabled = (model, enable_thinking, thinking_budget, reasoning_effort) => {
    // reasoning_effort -> thinking_budget mapping
    const EFFORT_BUDGET_MAP = {
        'low': 4096,
        'medium': 16384,
        'high': 81920,
    }

    const thinking_config = {
        "output_schema": "phase",
        "thinking_enabled": false,
        "thinking_budget": 81920
    }

    if (!model) return thinking_config

    // Enable thinking if any of these conditions are true:
    //   1. Model name contains '-thinking' suffix
    //   2. enable_thinking is explicitly true
    //   3. reasoning_effort is set (any valid value)
    const effortLower = reasoning_effort ? String(reasoning_effort).toLowerCase() : null
    const hasReasoningEffort = effortLower && EFFORT_BUDGET_MAP[effortLower] !== undefined

    if (model.includes('-thinking') || enable_thinking === true || enable_thinking === 'true' || hasReasoningEffort) {
        thinking_config.thinking_enabled = true
    }

    // Budget priority: explicit thinking_budget > reasoning_effort mapping > default
    if (thinking_budget && !isNaN(Number(thinking_budget)) && Number(thinking_budget) > 0) {
        thinking_config.thinking_budget = Number(thinking_budget)
    } else if (hasReasoningEffort) {
        thinking_config.thinking_budget = EFFORT_BUDGET_MAP[effortLower]
    }

    return thinking_config
}

/**
 * Parse model name, remove special suffixes
 * @param {string} model - Original model name
 * @returns {Promise<string>} Parsed model name
 */
const parserModel = async (model) => {
    if (!model) return 'qwen3-coder-plus'

    try {
        const { baseModel } = splitModelSuffix(model)
        const latestModels = await getLatestModels()
        const matchedModel = findMatchedModel(latestModels, baseModel)

        return matchedModel?.id || baseModel
    } catch (e) {
        const { baseModel } = splitModelSuffix(model)
        return baseModel || 'qwen3-coder-plus'
    }
}

/**
 * Extract text content from message
 * @param {string|Array} content - Message content
 * @returns {string} Extracted text
 */
const extractTextFromContent = (content) => {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
        return content.filter(item => item.type === 'text').map(item => item.text || '').join(' ')
    }
    return ''
}

/**
 * Format single message to text (with role annotation)
 * @param {object} message - Single message
 * @returns {string} Formatted message text
 */
const formatSingleMessage = (message) => {
    const role = message.role
    const content = extractTextFromContent(message.content)
    return content.trim() ? `${role}:${content}` : ''
}

/**
 * Format history messages to text prefix
 * @param {Array} messages - Message array (excluding last)
 * @returns {string} Formatted history messages
 */
const formatHistoryMessages = (messages) => {
    const formattedParts = []

    for (let message of messages) {
        const formatted = formatSingleMessage(message)
        if (formatted) {
            formattedParts.push(formatted)
        }
    }

    return formattedParts.length > 0 ? formattedParts.join(';') : ''
}

/**
 * Parse message format, handle image uploads and message structure
 * @param {Array} messages - Original message array
 * @param {object} thinking_config - Thinking config
 * @param {string} chat_type - Chat type
 * @returns {Promise<Array>} Parsed message array
 */
const parserMessages = async (messages, thinking_config, chat_type) => {
    try {
        const feature_config = thinking_config
        const imgCacheManager = new CacheManager()

        if (messages.length <= 1) {
            logger.network('Single message, using original format', 'PARSER')
            return await processOriginalLogic(messages, thinking_config, chat_type, imgCacheManager)
        }

        logger.network('Multiple messages, formatting with role annotations', 'PARSER')
        const historyMessages = messages.slice(0, -1)
        const lastMessage = messages[messages.length - 1]

        const historyText = formatHistoryMessages(historyMessages)

        let finalContent = []
        let lastMessageText = ''
        const lastMessageRole = lastMessage.role

        if (typeof lastMessage.content === 'string') {
            lastMessageText = lastMessage.content
        } else if (Array.isArray(lastMessage.content)) {
            for (let item of lastMessage.content) {
                if (item.type === 'text') {
                    lastMessageText += item.text || ''
                } else if (isMediaContentItem(item)) {
                    const normalizedMediaItem = await normalizeMediaContentItem(item, imgCacheManager)
                    if (normalizedMediaItem) {
                        finalContent.push(normalizedMediaItem)
                    }
                }
            }
        }

        let combinedText = ''
        if (historyText) {
            combinedText = historyText + ';'
        }
        if (lastMessageText.trim()) {
            combinedText += `${lastMessageRole}:${lastMessageText}`
        }

        if (finalContent.length > 0) {
            finalContent.unshift({
                type: 'text',
                text: combinedText,
                chat_type: 't2t',
                feature_config: {
                    "output_schema": "phase",
                    "thinking_enabled": false,
                }
            });

            return [
                {
                    "role": "user",
                    "content": finalContent,
                    "chat_type": chat_type,
                    "extra": {},
                    "feature_config": feature_config
                }
            ]
        } else {
            return [
                {
                    "role": "user",
                    "content": combinedText,
                    "chat_type": chat_type,
                    "extra": {},
                    "feature_config": feature_config
                }
            ]
        }

    } catch (e) {
        logger.error('Message parsing failed', 'PARSER', '', e)
        return [
            {
                "role": "user",
                "content": "Error processing chat history",
                "chat_type": "t2t",
                "extra": {},
                "feature_config": {
                    "output_schema": "phase",
                    "enabled": false,
                }
            }
        ]
    }
}

/**
 * Original single message processing logic
 * @param {Array} messages - Message array
 * @param {object} thinking_config - Thinking config
 * @param {string} chat_type - Chat type
 * @param {object} imgCacheManager - Image cache manager
 * @returns {Promise<Array>} Processed message array
 */
const processOriginalLogic = async (messages, thinking_config, chat_type, imgCacheManager) => {
    const feature_config = thinking_config

    for (let message of messages) {
        if (message.role === 'user' || message.role === 'assistant') {
            message.chat_type = "t2t"
            message.extra = {}
            message.feature_config = {
                "output_schema": "phase",
                "thinking_enabled": false,
            }

            if (!Array.isArray(message.content)) continue

            const newContent = []

            for (let item of message.content) {
                if (isMediaContentItem(item)) {
                    const normalizedMediaItem = await normalizeMediaContentItem(item, imgCacheManager)
                    if (normalizedMediaItem) {
                        newContent.push(normalizedMediaItem)
                    }
                } else if (item.type === 'text') {
                    item.chat_type = 't2t'
                    item.feature_config = {
                        "output_schema": "phase",
                        "thinking_enabled": false,
                    }

                    if (newContent.length >= 2) {
                        messages.push({
                            "role": "user",
                            "content": item.text,
                            "chat_type": "t2t",
                            "extra": {},
                            "feature_config": {
                                "output_schema": "phase",
                                "thinking_enabled": false,
                            }
                        })
                    } else {
                        newContent.push(item)
                    }
                }
            }

            message.content = newContent
        } else {
            if (Array.isArray(message.content)) {
                let system_prompt = ''
                for (let item of message.content) {
                    if (item.type === 'text') {
                        system_prompt += item.text
                    }
                }
                if (system_prompt) {
                    message.content = system_prompt
                }
            }
        }
    }

    messages[messages.length - 1].feature_config = feature_config
    messages[messages.length - 1].chat_type = chat_type

    return messages
}

module.exports = {
    isChatType,
    isThinkingEnabled,
    parserModel,
    parserMessages
}

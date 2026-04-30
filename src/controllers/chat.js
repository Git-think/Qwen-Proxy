const { isJson, generateUUID } = require('../utils/tools.js')
const { createUsageObject } = require('../utils/precise-tokenizer.js')
const { sendChatRequest } = require('../utils/request.js')
const accountManager = require('../utils/account.js')
const config = require('../config/index.js')
const { logger } = require('../utils/logger')

/**
 * Set response headers
 * @param {object} res - Express response object
 * @param {boolean} stream - Whether streaming response
 */
const setResponseHeaders = (res, stream) => {
    try {
        if (stream) {
            res.set({
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            })
        } else {
            res.set({
                'Content-Type': 'application/json',
            })
        }
    } catch (e) {
        logger.error('Error setting response headers', 'CHAT', '', e)
    }
}

const getImageMarkdownListFromDelta = (delta) => {
    const imageList = []
    const displayImages = delta?.extra?.image_list || []

    for (const item of displayImages) {
        if (item?.image) {
            imageList.push(`![image](${item.image})`)
        }
    }

    return imageList
}

/**
 * Handle streaming response
 */
const handleStreamResponse = async (res, response, enable_thinking, enable_web_search, requestBody = null) => {
    try {
        const message_id = generateUUID()
        const decoder = new TextDecoder('utf-8')
        let web_search_info = null
        let currentPhase = null // 'think' or 'answer'
        let buffer = ''
        let emittedImageMarkdownSet = new Set()
        let pendingImageMarkdownList = []

        let totalTokens = {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
        }
        let completionContent = ''

        let promptText = ''
        if (requestBody && requestBody.messages) {
            promptText = requestBody.messages.map(msg => {
                if (typeof msg.content === 'string') return msg.content
                if (Array.isArray(msg.content)) return msg.content.map(item => item.text || '').join('')
                return ''
            }).join('\n')
        }

        const writeChunk = (delta) => {
            const chunk = {
                "id": `chatcmpl-${message_id}`,
                "object": "chat.completion.chunk",
                "created": Math.round(new Date().getTime() / 1000),
                "choices": [{
                    "index": 0,
                    "delta": delta,
                    "finish_reason": null
                }]
            }
            res.write(`data: ${JSON.stringify(chunk)}\n\n`)
        }

        response.on('data', async (chunk) => {
            const decodeText = decoder.decode(chunk, { stream: true })
            buffer += decodeText

            const chunks = []
            let startIndex = 0

            while (true) {
                const dataStart = buffer.indexOf('data: ', startIndex)
                if (dataStart === -1) break

                const dataEnd = buffer.indexOf('\n\n', dataStart)
                if (dataEnd === -1) break

                const dataChunk = buffer.substring(dataStart, dataEnd).trim()
                chunks.push(dataChunk)
                startIndex = dataEnd + 2
            }

            if (startIndex > 0) {
                buffer = buffer.substring(startIndex)
            }

            for (const item of chunks) {
                try {
                    let dataContent = item.replace("data: ", '')
                    let decodeJson = isJson(dataContent) ? JSON.parse(dataContent) : null
                    if (decodeJson === null || !decodeJson.choices || decodeJson.choices.length === 0) {
                        continue
                    }

                    if (decodeJson.usage) {
                        totalTokens = {
                            prompt_tokens: decodeJson.usage.prompt_tokens || totalTokens.prompt_tokens,
                            completion_tokens: decodeJson.usage.completion_tokens || totalTokens.completion_tokens,
                            total_tokens: decodeJson.usage.total_tokens || totalTokens.total_tokens
                        }
                    }

                    const delta = decodeJson.choices[0].delta

                    // Handle web search info
                    if (delta && delta.name === 'web_search') {
                        web_search_info = delta.extra.web_search_info
                    }

                    // Handle inline images
                    const imageMarkdownList = getImageMarkdownListFromDelta(delta)
                    if (imageMarkdownList.length > 0) {
                        const newImageMarkdownList = imageMarkdownList.filter(item => !emittedImageMarkdownSet.has(item))

                        if (currentPhase === 'think') {
                            // Buffer images during thinking phase
                            for (const imageMarkdown of newImageMarkdownList) {
                                if (!pendingImageMarkdownList.includes(imageMarkdown)) {
                                    pendingImageMarkdownList.push(imageMarkdown)
                                }
                            }
                        } else if (newImageMarkdownList.length > 0) {
                            const imageContent = `${newImageMarkdownList.join('\n\n')}\n\n`
                            completionContent += imageContent
                            newImageMarkdownList.forEach(item => emittedImageMarkdownSet.add(item))
                            writeChunk({ "content": imageContent })
                        }
                    }

                    if (!delta || !delta.content ||
                        (delta.phase !== 'think' && delta.phase !== 'answer')) {
                        continue
                    }

                    let content = delta.content
                    completionContent += content

                    if (delta.phase === 'think') {
                        // Thinking phase: send as reasoning_content (OpenAI standard)
                        if (currentPhase !== 'think') {
                            currentPhase = 'think'
                            // Prepend search info to first thinking chunk if available
                            if (web_search_info) {
                                const searchTable = await accountManager.generateMarkdownTable(web_search_info, config.searchInfoMode)
                                content = searchTable + '\n\n' + content
                            }
                        }
                        writeChunk({ "reasoning_content": content })
                    } else if (delta.phase === 'answer') {
                        // Answer phase: send as content
                        if (currentPhase === 'think') {
                            // Flush pending images when transitioning from think to answer
                            if (pendingImageMarkdownList.length > 0) {
                                const pendingImageContent = `${pendingImageMarkdownList.join('\n\n')}\n\n`
                                completionContent += pendingImageContent
                                pendingImageMarkdownList.forEach(item => emittedImageMarkdownSet.add(item))
                                pendingImageMarkdownList = []
                                writeChunk({ "content": pendingImageContent })
                            }
                        }
                        currentPhase = 'answer'
                        writeChunk({ "content": content })
                    }
                } catch (error) {
                    logger.error('Stream data processing error', 'CHAT', '', error)
                }
            }
        })

        response.on('end', async () => {
            try {
                // Append search info for non-thinking mode
                if ((config.outThink === false || !enable_thinking) && web_search_info && config.searchInfoMode === "text") {
                    const webSearchTable = await accountManager.generateMarkdownTable(web_search_info, "text")
                    writeChunk({ "content": `\n\n---\n${webSearchTable}` })
                }

                if (totalTokens.prompt_tokens === 0 && totalTokens.completion_tokens === 0) {
                    totalTokens = createUsageObject(requestBody?.messages || promptText, completionContent, null)
                }

                totalTokens.prompt_tokens = Math.max(0, totalTokens.prompt_tokens || 0)
                totalTokens.completion_tokens = Math.max(0, totalTokens.completion_tokens || 0)
                totalTokens.total_tokens = totalTokens.prompt_tokens + totalTokens.completion_tokens

                // Finish chunk
                res.write(`data: ${JSON.stringify({
                    "id": `chatcmpl-${message_id}`,
                    "object": "chat.completion.chunk",
                    "created": Math.round(new Date().getTime() / 1000),
                    "choices": [{ "index": 0, "delta": {}, "finish_reason": "stop" }]
                })}\n\n`)

                // Usage chunk
                res.write(`data: ${JSON.stringify({
                    "id": `chatcmpl-${message_id}`,
                    "object": "chat.completion.chunk",
                    "created": Math.round(new Date().getTime() / 1000),
                    "choices": [],
                    "usage": totalTokens
                })}\n\n`)

                res.write(`data: [DONE]\n\n`)
                res.end()
            } catch (e) {
                logger.error('Stream response end error', 'CHAT', '', e)
                if (!res.headersSent) {
                    res.status(500).json({ error: "Internal server error" })
                }
            }
        })
    } catch (error) {
        logger.error('Chat processing error', 'CHAT', '', error)
        if (!res.headersSent) {
            res.status(500).json({ error: "Internal server error" })
        }
    }
}

/**
 * Handle non-streaming response (accumulate from stream)
 */
const handleNonStreamResponse = async (res, response, enable_thinking, enable_web_search, model, requestBody = null) => {
    try {
        const decoder = new TextDecoder('utf-8')
        let buffer = ''
        let fullContent = ''
        let reasoningContent = ''
        let web_search_info = null
        let currentPhase = null
        let appendedImageMarkdownSet = new Set()
        let pendingImageMarkdownList = []

        let totalTokens = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

        await new Promise((resolve, reject) => {
            response.on('data', async (chunk) => {
                const decodeText = decoder.decode(chunk, { stream: true })
                buffer += decodeText

                const chunks = []
                let startIndex = 0

                while (true) {
                    const dataStart = buffer.indexOf('data: ', startIndex)
                    if (dataStart === -1) break
                    const dataEnd = buffer.indexOf('\n\n', dataStart)
                    if (dataEnd === -1) break
                    chunks.push(buffer.substring(dataStart, dataEnd).trim())
                    startIndex = dataEnd + 2
                }

                if (startIndex > 0) buffer = buffer.substring(startIndex)

                for (const item of chunks) {
                    try {
                        let dataContent = item.replace("data: ", '')
                        let decodeJson = isJson(dataContent) ? JSON.parse(dataContent) : null
                        if (!decodeJson || !decodeJson.choices || decodeJson.choices.length === 0) continue

                        if (decodeJson.usage) {
                            totalTokens = {
                                prompt_tokens: decodeJson.usage.prompt_tokens || totalTokens.prompt_tokens,
                                completion_tokens: decodeJson.usage.completion_tokens || totalTokens.completion_tokens,
                                total_tokens: decodeJson.usage.total_tokens || totalTokens.total_tokens
                            }
                        }

                        const delta = decodeJson.choices[0].delta

                        if (delta && delta.name === 'web_search') {
                            web_search_info = delta.extra.web_search_info
                        }

                        const imageMarkdownList = getImageMarkdownListFromDelta(delta)
                        if (imageMarkdownList.length > 0) {
                            const newList = imageMarkdownList.filter(item => !appendedImageMarkdownSet.has(item))
                            if (currentPhase === 'think') {
                                for (const md of newList) {
                                    if (!pendingImageMarkdownList.includes(md)) pendingImageMarkdownList.push(md)
                                }
                            } else if (newList.length > 0) {
                                fullContent += `${newList.join('\n\n')}\n\n`
                                newList.forEach(item => appendedImageMarkdownSet.add(item))
                            }
                        }

                        if (!delta || !delta.content || (delta.phase !== 'think' && delta.phase !== 'answer')) continue

                        let content = delta.content

                        if (delta.phase === 'think') {
                            if (currentPhase !== 'think' && web_search_info) {
                                const searchTable = await accountManager.generateMarkdownTable(web_search_info, config.searchInfoMode)
                                reasoningContent += searchTable + '\n\n'
                            }
                            currentPhase = 'think'
                            reasoningContent += content
                        } else if (delta.phase === 'answer') {
                            if (currentPhase === 'think' && pendingImageMarkdownList.length > 0) {
                                fullContent += `${pendingImageMarkdownList.join('\n\n')}\n\n`
                                pendingImageMarkdownList.forEach(item => appendedImageMarkdownSet.add(item))
                                pendingImageMarkdownList = []
                            }
                            currentPhase = 'answer'
                            fullContent += content
                        }
                    } catch (error) {
                        logger.error('Non-stream data processing error', 'CHAT', '', error)
                    }
                }
            })

            response.on('end', () => resolve())
            response.on('error', (error) => reject(error))
        })

        if ((config.outThink === false || !enable_thinking) && web_search_info && config.searchInfoMode === "text") {
            const webSearchTable = await accountManager.generateMarkdownTable(web_search_info, "text")
            fullContent += `\n\n---\n${webSearchTable}`
        }

        if (totalTokens.prompt_tokens === 0 && totalTokens.completion_tokens === 0) {
            totalTokens = createUsageObject(requestBody?.messages || '', fullContent + reasoningContent, null)
        }

        totalTokens.prompt_tokens = Math.max(0, totalTokens.prompt_tokens || 0)
        totalTokens.completion_tokens = Math.max(0, totalTokens.completion_tokens || 0)
        totalTokens.total_tokens = totalTokens.prompt_tokens + totalTokens.completion_tokens

        const message = { "role": "assistant", "content": fullContent }
        if (reasoningContent) {
            message.reasoning_content = reasoningContent
        }

        res.json({
            "id": `chatcmpl-${generateUUID()}`,
            "object": "chat.completion",
            "created": Math.round(new Date().getTime() / 1000),
            "model": model,
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": "stop"
            }],
            "usage": totalTokens
        })
    } catch (error) {
        logger.error('Non-stream chat processing error', 'CHAT', '', error)
        res.status(500).json({ error: "Internal server error" })
    }
}

/**
 * Main chat completion handler
 */
const handleChatCompletion = async (req, res) => {
    const { stream, model } = req.body
    const enable_thinking = req.enable_thinking
    const enable_web_search = req.enable_web_search

    try {
        const response_data = await sendChatRequest(req.body)

        if (!response_data.status || !response_data.response) {
            res.status(500).json({ error: "Failed to send request" })
            return
        }

        if (stream) {
            setResponseHeaders(res, true)
            await handleStreamResponse(res, response_data.response, enable_thinking, enable_web_search, req.body)
        } else {
            setResponseHeaders(res, false)
            await handleNonStreamResponse(res, response_data.response, enable_thinking, enable_web_search, model, req.body)
        }

    } catch (error) {
        logger.error('Chat processing error', 'CHAT', '', error)
        res.status(500).json({ error: "Invalid token, request failed" })
    }
}

module.exports = {
    handleChatCompletion,
    handleStreamResponse,
    handleNonStreamResponse,
    setResponseHeaders
}

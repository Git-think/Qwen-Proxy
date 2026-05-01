const axios = require('axios')
const accountManager = require('./account.js')
const config = require('../config/index.js')
const { logger } = require('./logger')
const { getSsxmodItna, getSsxmodItna2 } = require('./ssxmod-manager')
const { getProxyAgent, getChatBaseUrl, buildAgentForUrl, getProxyHost } = require('./proxy-helper')

// Errors that look like the proxy is dead (TCP-level / DNS / handshake).
// Anything in this set on a proxied request triggers proxy failover.
const NETWORK_ERROR_CODES = new Set([
    'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
    'ENETUNREACH', 'EAI_AGAIN', 'EPIPE', 'EHOSTUNREACH',
])

function isProxyShapedError(err) {
    if (!err) return false
    if (NETWORK_ERROR_CODES.has(err.code)) return true
    const msg = String(err.message || '')
    return /timeout|ECONN|socket|ENETUNREACH|tunneling/.test(msg)
}

/**
 * Resolve the proxy URL for the current account. If the account has no
 * binding yet, the pool will lazily assign one. When no pool is
 * configured the legacy single-proxy (config.proxyUrl via getProxyAgent)
 * is used instead.
 * @param {string} email
 * @returns {Promise<string|null>}
 */
async function resolveAccountProxy(email) {
    if (!email) return null
    if (!accountManager.proxyPool) return null
    return await accountManager.getProxyForAccount(email)
}

/**
 * Send chat request
 * Retries up to config.proxyMaxRetries times when the proxy looks dead.
 * Each retry asks the smart pool for a fresh binding.
 * @param {Object} body - Request body
 * @returns {Promise<Object>} Response result
 */
const sendChatRequest = async (body) => {
    const MAX_RETRIES = Math.max(1, config.proxyMaxRetries || 3)
    let lastError = null

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        // One rotator advance per attempt — picking a fresh account on
        // retry is desirable too (the original token might be the cause).
        const accountInfo = accountManager.accountRotator
            && typeof accountManager.accountRotator.getNextAccountInfo === 'function'
            ? accountManager.accountRotator.getNextAccountInfo()
            : null
        const currentToken = accountInfo ? accountInfo.token : accountManager.getAccountToken()
        const currentEmail = accountInfo ? accountInfo.email : null

        if (!currentToken) {
            logger.error('Cannot get valid access token', 'TOKEN')
            return { status: false, response: null }
        }

        const currentProxy = await resolveAccountProxy(currentEmail)

        try {
            const chatBaseUrl = getChatBaseUrl()

            const requestConfig = {
                headers: {
                    'Authorization': `Bearer ${currentToken}`,
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
                    "Connection": "keep-alive",
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip, deflate, br, zstd",
                    "Content-Type": "application/json",
                    "Timezone": "Mon Dec 08 2025 17:28:55 GMT+0800",
                    "sec-ch-ua": "\"Microsoft Edge\";v=\"143\", \"Chromium\";v=\"143\", \"Not A(Brand\";v=\"24\"",
                    "source": "web",
                    "Version": "0.1.13",
                    "bx-v": "2.5.31",
                    "Origin": chatBaseUrl,
                    "Sec-Fetch-Site": "same-origin",
                    "Sec-Fetch-Mode": "cors",
                    "Sec-Fetch-Dest": "empty",
                    "Referer": `${chatBaseUrl}/c/guest`,
                    "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
                    "Cookie": `ssxmod_itna=${getSsxmodItna()};ssxmod_itna2=${getSsxmodItna2()}`,
                },
                responseType: 'stream',
                timeout: 60 * 1000,
            }

            // Prefer the smart-pool binding when available; fall back to
            // the legacy single-proxy (config.proxyUrl) otherwise.
            const agent = currentProxy ? buildAgentForUrl(currentProxy) : getProxyAgent()
            if (agent) {
                requestConfig.httpAgent = agent
                requestConfig.httpsAgent = agent
                requestConfig.proxy = false
            }

            const chat_id = await generateChatID(currentToken, body.model, currentEmail, currentProxy)

            logger.network(`Sending chat request (attempt ${attempt}/${MAX_RETRIES}, proxy: ${getProxyHost(currentProxy)})`, 'REQUEST')
            const response = await axios.post(`${chatBaseUrl}/api/v2/chat/completions?chat_id=` + chat_id, {
                ...body,
                stream: true,
                chat_id: chat_id
            }, requestConfig)

            if (response.status === 200) {
                return {
                    currentToken: currentToken,
                    status: true,
                    response: response.data
                }
            }
            lastError = new Error(`Request failed with status code ${response.status}`)
        } catch (error) {
            lastError = error
            logger.error(`Chat request failed (attempt ${attempt}/${MAX_RETRIES}, proxy: ${getProxyHost(currentProxy)}): ${error.message}`, 'REQUEST')

            // Only proxy-shaped errors are retryable. Auth errors, 4xx and
            // upstream-format failures should bail immediately so the
            // caller sees the real reason instead of "after 3 retries".
            if (currentProxy && currentEmail && isProxyShapedError(error) && attempt < MAX_RETRIES) {
                logger.warn('Proxy-shaped failure — rotating proxy and retrying', 'PROXY')
                await accountManager.handleNetworkFailure(currentEmail, currentProxy)
                continue
            }
            break
        }
    }

    if (lastError) {
        logger.error(`Failed to send chat request: ${lastError.message}`, 'REQUEST', '', lastError)
    }
    return { status: false, response: null }
}

/**
 * Generate chat_id
 * @param {string} currentToken - Current token
 * @param {string} model - Model name
 * @param {string} [email] - Account email (for proxy lookup)
 * @param {string} [proxyUrl] - Proxy URL (overrides legacy single-proxy)
 * @returns {Promise<string|null>} Generated chat_id or null
 */
const generateChatID = async (currentToken, model, email = null, proxyUrl = null) => {
    try {
        const chatBaseUrl = getChatBaseUrl()

        const requestConfig = {
            headers: {
                'Authorization': `Bearer ${currentToken}`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
                "Connection": "keep-alive",
                "Accept": "application/json",
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Content-Type": "application/json",
                "Timezone": "Mon Dec 08 2025 17:28:55 GMT+0800",
                "sec-ch-ua": "\"Microsoft Edge\";v=\"143\", \"Chromium\";v=\"143\", \"Not A(Brand\";v=\"24\"",
                "source": "web",
                "Version": "0.1.13",
                "bx-v": "2.5.31",
                "Origin": chatBaseUrl,
                "Sec-Fetch-Site": "same-origin",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Dest": "empty",
                "Referer": `${chatBaseUrl}/c/guest`,
                "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
                "Cookie": `ssxmod_itna=${getSsxmodItna()};ssxmod_itna2=${getSsxmodItna2()}`,
            }
        }

        const agent = proxyUrl ? buildAgentForUrl(proxyUrl) : getProxyAgent()
        if (agent) {
            requestConfig.httpAgent = agent
            requestConfig.httpsAgent = agent
            requestConfig.proxy = false
        }

        const response_data = await axios.post(`${chatBaseUrl}/api/v2/chats/new`, {
            "title": "New Chat",
            "models": [model],
            "chat_mode": "local",
            "chat_type": "t2i",
            "timestamp": new Date().getTime()
        }, requestConfig)

        return response_data.data?.data?.id || null

    } catch (error) {
        logger.error('Failed to generate chat_id', 'CHAT', '', error.message)
        return null
    }
}

module.exports = {
    sendChatRequest,
    generateChatID
}

const config = require('../config/index.js')
const { HttpsProxyAgent } = require('https-proxy-agent')

// Cache proxy agent instance
let proxyAgentInstance = null

/**
 * Get proxy agent
 * @returns {HttpsProxyAgent|undefined}
 */
const getProxyAgent = () => {
    if (config.proxyUrl) {
        if (!proxyAgentInstance) {
            proxyAgentInstance = new HttpsProxyAgent(config.proxyUrl)
        }
        return proxyAgentInstance
    }
    return undefined
}

/**
 * Get Chat API base URL
 * @returns {string}
 */
const getChatBaseUrl = () => config.qwenChatProxyUrl

/**
 * Apply proxy settings to axios request config
 * @param {Object} requestConfig - axios request config object
 * @returns {Object} Request config with proxy settings
 */
const applyProxyToAxiosConfig = (requestConfig = {}) => {
    const proxyAgent = getProxyAgent()
    if (proxyAgent) {
        requestConfig.httpsAgent = proxyAgent
        requestConfig.proxy = false
    }
    return requestConfig
}

/**
 * Apply proxy settings to fetch options
 * @param {Object} fetchOptions - fetch request config object
 * @returns {Object} Fetch options with proxy settings
 */
const applyProxyToFetchOptions = (fetchOptions = {}) => {
    const proxyAgent = getProxyAgent()
    if (proxyAgent) {
        fetchOptions.agent = proxyAgent
    }
    return fetchOptions
}

module.exports = {
    getProxyAgent,
    getChatBaseUrl,
    applyProxyToAxiosConfig,
    applyProxyToFetchOptions
}

const config = require('../config/index.js')
const { HttpsProxyAgent } = require('https-proxy-agent')
const { SocksProxyAgent } = require('socks-proxy-agent')

// Cache for the legacy single-proxy agent (config.proxyUrl path)
let proxyAgentInstance = null
// Cache by proxy URL string. Agents are reused across requests so connection
// pooling and DNS lookups cost once per pool entry, not per request.
const agentCache = new Map()

/**
 * Build a proxy agent for the given URL. Picks SocksProxyAgent for
 * socks/socks4/socks5 schemes, HttpsProxyAgent for http/https.
 * Returns null on parse error or unknown scheme.
 * @param {string} proxyUrl
 */
const buildAgentForUrl = (proxyUrl) => {
    if (!proxyUrl) return null
    if (agentCache.has(proxyUrl)) return agentCache.get(proxyUrl)
    let agent = null
    try {
        const u = new URL(proxyUrl)
        if (/^socks/.test(u.protocol)) {
            agent = new SocksProxyAgent(proxyUrl)
        } else if (u.protocol === 'http:' || u.protocol === 'https:') {
            agent = new HttpsProxyAgent(proxyUrl)
        }
    } catch { /* fall through to null */ }
    if (agent) agentCache.set(proxyUrl, agent)
    return agent
}

/**
 * Get proxy agent (legacy single-proxy mode). Backed by config.proxyUrl.
 */
const getProxyAgent = () => {
    if (config.proxyUrl) {
        if (!proxyAgentInstance) {
            proxyAgentInstance = buildAgentForUrl(config.proxyUrl)
        }
        return proxyAgentInstance || undefined
    }
    return undefined
}

/**
 * Get Chat API base URL
 * @returns {string}
 */
const getChatBaseUrl = () => config.qwenChatProxyUrl

/**
 * Apply proxy settings to axios request config.
 * If overrideProxyUrl is given, it takes precedence over the legacy
 * config.proxyUrl single-proxy. Use this from the smart proxy pool to
 * route a specific request through a chosen pool member.
 * @param {Object} requestConfig - axios request config object
 * @param {string} [overrideProxyUrl]
 * @returns {Object} Request config with proxy settings
 */
const applyProxyToAxiosConfig = (requestConfig = {}, overrideProxyUrl) => {
    const agent = overrideProxyUrl
        ? buildAgentForUrl(overrideProxyUrl)
        : getProxyAgent()
    if (agent) {
        requestConfig.httpAgent = agent
        requestConfig.httpsAgent = agent
        requestConfig.proxy = false
    }
    return requestConfig
}

/**
 * Apply proxy settings to fetch options
 * @param {Object} fetchOptions
 * @param {string} [overrideProxyUrl]
 */
const applyProxyToFetchOptions = (fetchOptions = {}, overrideProxyUrl) => {
    const agent = overrideProxyUrl
        ? buildAgentForUrl(overrideProxyUrl)
        : getProxyAgent()
    if (agent) {
        fetchOptions.agent = agent
    }
    return fetchOptions
}

/**
 * Extract a hostname from a proxy URL for log lines (so we never leak
 * credentials embedded in the URL).
 */
const getProxyHost = (proxyUrl) => {
    if (!proxyUrl) return 'none'
    try { return new URL(proxyUrl).hostname } catch { return 'invalid' }
}

module.exports = {
    getProxyAgent,
    buildAgentForUrl,
    getChatBaseUrl,
    applyProxyToAxiosConfig,
    applyProxyToFetchOptions,
    getProxyHost,
}

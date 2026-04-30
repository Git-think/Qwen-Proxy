const axios = require('axios')
const accountManager = require('../utils/account.js')
const { getSsxmodItna, getSsxmodItna2 } = require('../utils/ssxmod-manager')
const { getProxyAgent, getChatBaseUrl } = require('../utils/proxy-helper')

let cachedModels = null
let fetchPromise = null

const getLatestModels = async (force = false) => {
    // If cached and not forcing refresh, return cache
    if (cachedModels && !force) {
        return cachedModels
    }

    // If already fetching, return current promise
    if (fetchPromise) {
        return fetchPromise
    }

    const chatBaseUrl = getChatBaseUrl()
    const proxyAgent = getProxyAgent()

    const requestConfig = {
        headers: {
            'Authorization': `Bearer ${accountManager.getAccountToken()}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            ...(getSsxmodItna() && { 'Cookie': `ssxmod_itna=${getSsxmodItna()};ssxmod_itna2=${getSsxmodItna2()}` })
        }
    }

    if (proxyAgent) {
        requestConfig.httpsAgent = proxyAgent
        requestConfig.proxy = false
    }

    fetchPromise = axios.get(`${chatBaseUrl}/api/models`, requestConfig).then(response => {
        cachedModels = response.data.data
        fetchPromise = null
        return cachedModels
    }).catch(error => {
        console.error('Error fetching latest models:', error.message)
        fetchPromise = null
        return []
    })

    return fetchPromise
}

/**
 * Get default model by chat type
 * @param {string} chatType - Chat type
 * @returns {Promise<string|null>} Default model ID
 */
const getDefaultModelByChatType = async (chatType) => {
    const models = await getLatestModels()
    const matchedModel = models.find(model => model?.info?.meta?.chat_type?.includes(chatType))
    return matchedModel?.id?.toLowerCase() || null
}

module.exports = {
    getLatestModels,
    getDefaultModelByChatType
}

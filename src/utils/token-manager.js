const axios = require('axios')
const { sha256Encrypt, JwtDecode } = require('./tools')
const { logger } = require('./logger')
const { getProxyAgent, getChatBaseUrl } = require('./proxy-helper')

/**
 * Token Manager
 * Handles token acquisition, validation, and refresh
 */
class TokenManager {
    constructor() {
        this.defaultHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0'
        }
    }

    /**
     * Get login endpoint
     * @returns {string} Login endpoint URL
     */
    get loginEndpoint() {
        return `${getChatBaseUrl()}/api/v1/auths/signin`
    }

    /**
     * Login to get token
     * @param {string} email - Email
     * @param {string} password - Password
     * @returns {Promise<string|null>} Token or null
     */
    async login(email, password) {
        try {
            const proxyAgent = getProxyAgent()
            const requestConfig = {
                headers: this.defaultHeaders,
                timeout: 10000
            }

            if (proxyAgent) {
                requestConfig.httpsAgent = proxyAgent
                requestConfig.proxy = false
            }

            const response = await axios.post(this.loginEndpoint, {
                email: email,
                password: sha256Encrypt(password)
            }, requestConfig)

            if (response.data && response.data.token) {
                logger.success(`${email} login successful`, 'AUTH')
                return response.data.token
            } else {
                logger.error(`${email} login response missing token`, 'AUTH')
                return null
            }
        } catch (error) {
            if (error.response) {
                logger.error(`${email} login failed (${error.response.status})`, 'AUTH', '', error)
            } else if (error.request) {
                logger.error(`${email} login failed: network timeout or no response`, 'AUTH')
            } else {
                logger.error(`${email} login failed`, 'AUTH', '', error)
            }
            return null
        }
    }

    /**
     * Validate token
     * @param {string} token - JWT token
     * @returns {Object|null} Decoded token info or null
     */
    validateToken(token) {
        try {
            if (!token) return null

            const decoded = JwtDecode(token)
            if (!decoded || !decoded.exp) {
                return null
            }

            const now = Math.floor(Date.now() / 1000)
            if (decoded.exp <= now) {
                return null // Token expired
            }

            return decoded
        } catch (error) {
            logger.error('Token validation failed', 'TOKEN', '', error)
            return null
        }
    }

    /**
     * Check if token is expiring soon
     * @param {string} token - JWT token
     * @param {number} thresholdHours - Expiry threshold (hours)
     * @returns {boolean} Whether token is expiring soon
     */
    isTokenExpiringSoon(token, thresholdHours = 6) {
        const decoded = this.validateToken(token)
        if (!decoded) return true // Invalid token treated as expiring

        const now = Math.floor(Date.now() / 1000)
        const thresholdSeconds = thresholdHours * 60 * 60
        return decoded.exp - now < thresholdSeconds
    }

    /**
     * Get token remaining valid time (hours)
     * @param {string} token - JWT token
     * @returns {number} Remaining hours, -1 for invalid token
     */
    getTokenRemainingHours(token) {
        const decoded = this.validateToken(token)
        if (!decoded) return -1

        const now = Math.floor(Date.now() / 1000)
        const remainingSeconds = decoded.exp - now
        return Math.max(0, Math.round(remainingSeconds / 3600))
    }

    /**
     * Refresh a single account's token
     * @param {Object} account - Account object {email, password, token, expires}
     * @returns {Promise<Object|null>} Updated account object or null
     */
    async refreshToken(account) {
        try {
            const newToken = await this.login(account.email, account.password)
            if (!newToken) {
                return null
            }

            const decoded = this.validateToken(newToken)
            if (!decoded) {
                logger.error(`Refreshed token is invalid: ${account.email}`, 'TOKEN')
                return null
            }

            const updatedAccount = {
                ...account,
                token: newToken,
                expires: decoded.exp
            }

            const remainingHours = this.getTokenRemainingHours(newToken)
            logger.success(`Token refreshed: ${account.email} (valid for: ${remainingHours}h)`, 'TOKEN')

            return updatedAccount
        } catch (error) {
            logger.error(`Token refresh failed (${account.email})`, 'TOKEN', '', error)
            return null
        }
    }

    /**
     * Batch refresh expiring tokens
     * @param {Array} accounts - Account list
     * @param {number} thresholdHours - Expiry threshold (hours)
     * @param {Function} onEachRefresh - Callback after each successful refresh
     * @returns {Promise<Object>} Refresh result {refreshed: Array, failed: Array}
     */
    async batchRefreshTokens(accounts, thresholdHours = 24, onEachRefresh = null) {
        const needsRefresh = accounts.filter(account =>
            this.isTokenExpiringSoon(account.token, thresholdHours)
        )

        if (needsRefresh.length === 0) {
            logger.info('No tokens need refreshing', 'TOKEN')
            return { refreshed: [], failed: [] }
        }

        logger.info(`Found ${needsRefresh.length} tokens needing refresh`, 'TOKEN')

        const refreshed = []
        const failed = []

        for (let i = 0; i < needsRefresh.length; i++) {
            const account = needsRefresh[i]
            const updatedAccount = await this.refreshToken(account)

            if (updatedAccount) {
                refreshed.push(updatedAccount)

                if (onEachRefresh && typeof onEachRefresh === 'function') {
                    try {
                        await onEachRefresh(updatedAccount, i + 1, needsRefresh.length)
                    } catch (error) {
                        logger.error(`Refresh callback failed (${account.email})`, 'TOKEN', '', error)
                    }
                }
            } else {
                failed.push(account)
            }

            // Add delay to avoid rate limiting
            await this._delay(1000)
        }

        logger.success(`Token refresh complete: ${refreshed.length} succeeded, ${failed.length} failed`, 'TOKEN')
        return { refreshed, failed }
    }

    /**
     * Get token health statistics
     * @param {Array} accounts - Account list
     * @returns {Object} Statistics
     */
    getTokenHealthStats(accounts) {
        const stats = {
            total: accounts.length,
            valid: 0,
            expired: 0,
            expiringSoon: 0,
            invalid: 0
        }

        accounts.forEach(account => {
            if (!account.token) {
                stats.invalid++
                return
            }

            const decoded = this.validateToken(account.token)
            if (!decoded) {
                stats.invalid++
                return
            }

            const now = Math.floor(Date.now() / 1000)
            if (decoded.exp <= now) {
                stats.expired++
            } else if (this.isTokenExpiringSoon(account.token, 6)) {
                stats.expiringSoon++
            } else {
                stats.valid++
            }
        })

        return stats
    }

    /**
     * Delay function
     * @param {number} ms - Delay in milliseconds
     * @private
     */
    async _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }
}

module.exports = TokenManager

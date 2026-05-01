const config = require('../config/index.js')
const DataPersistence = require('./data-persistence')
const TokenManager = require('./token-manager')
const AccountRotator = require('./account-rotator')
const { logger } = require('./logger')

/**
 * Account Manager
 * Unified management of accounts, tokens, and rotation
 */
class Account {
    constructor() {
        this.dataPersistence = new DataPersistence()
        this.tokenManager = new TokenManager()
        this.accountRotator = new AccountRotator()

        this.accountTokens = []
        this.isInitialized = false
        this.initPromise = null

        // Initialize
        this.initPromise = this._initialize()
    }

    /**
     * Async initialization
     * @private
     */
    async _initialize() {
        try {
            await this.loadAccountTokens()

            // Set up periodic token refresh
            if (config.autoRefresh && !config.isServerless) {
                this.refreshInterval = setInterval(
                    () => this.autoRefreshTokens(),
                    (config.autoRefreshInterval || 21600) * 1000
                )
            }

            this.isInitialized = true
            logger.success(`Account manager initialized, loaded ${this.accountTokens.length} accounts`, 'ACCOUNT')
        } catch (error) {
            this.isInitialized = false
            logger.error('Account manager initialization failed', 'ACCOUNT', '', error)
        }
    }

    /**
     * Ensure initialization is complete (for lazy init in serverless)
     */
    async ensureInitialized() {
        if (this.isInitialized) return
        if (this.initPromise) {
            await this.initPromise
        }
    }

    /**
     * Load account token data
     * @returns {Promise<void>}
     */
    async loadAccountTokens() {
        try {
            this.accountTokens = await this.dataPersistence.loadAccounts()

            // For env var mode, login to get tokens
            if (config.dataSaveMode === 'none' && this.accountTokens.length > 0) {
                await this._loginEnvironmentAccounts()
            }

            // Validate and clean invalid tokens
            await this._validateAndCleanTokens()

            // Update account rotator
            this.accountRotator.setAccounts(this.accountTokens)

            logger.success(`Successfully loaded ${this.accountTokens.length} accounts`, 'ACCOUNT')
        } catch (error) {
            logger.error('Failed to load account tokens', 'ACCOUNT', '', error)
            this.accountTokens = []
            this.accountRotator.setAccounts(this.accountTokens)
            throw error
        }
    }

    /**
     * Login environment variable accounts
     * @private
     */
    async _loginEnvironmentAccounts() {
        const concurrency = config.batchLoginConcurrency || 5
        const accounts = this.accountTokens.filter(acc => !acc.token && acc.email && acc.password)

        // Process in batches
        for (let i = 0; i < accounts.length; i += concurrency) {
            const batch = accounts.slice(i, i + concurrency)
            const loginPromises = batch.map(async (account) => {
                const token = await this.tokenManager.login(account.email, account.password)
                if (token) {
                    const decoded = this.tokenManager.validateToken(token)
                    if (decoded) {
                        account.token = token
                        account.expires = decoded.exp
                    }
                }
                return account
            })
            await Promise.all(loginPromises)
        }
    }

    /**
     * Validate tokens and try to recover invalid ones, but ALWAYS keep
     * accounts in the list. A failed login (transient network blip, 5xx,
     * captcha) leaves account.token empty + expires=0; the admin UI can
     * see those entries and trigger /api/refreshAccount to retry. This
     * prevents the account list from silently shrinking on transient
     * errors — the previous behavior dropped failed entries entirely.
     * @private
     */
    async _validateAndCleanTokens() {
        for (const account of this.accountTokens) {
            if (account.token && this.tokenManager.validateToken(account.token)) {
                continue
            }
            if (!account.email || !account.password) {
                // No credentials available — leave as-is so the operator
                // can at least see the orphaned entry and act on it.
                continue
            }
            logger.info(`Token invalid, attempting re-login: ${account.email}`, 'TOKEN')
            const newToken = await this.tokenManager.login(account.email, account.password)
            if (newToken) {
                const decoded = this.tokenManager.validateToken(newToken)
                if (decoded) {
                    account.token = newToken
                    account.expires = decoded.exp
                    delete account.lastLoginError
                    continue
                }
            }
            // Login failed — KEEP the entry but mark token empty so the
            // rotator skips it. Frontend can show "未登录" and call
            // /api/refreshAccount to retry on demand.
            account.token = ''
            account.expires = 0
            account.lastLoginError = Date.now()
        }
    }

    /**
     * Auto-refresh expiring tokens
     * @param {number} thresholdHours - Expiry threshold (hours)
     * @returns {Promise<number>} Number of successfully refreshed tokens
     */
    async autoRefreshTokens(thresholdHours = 24) {
        if (!this.isInitialized) {
            logger.warn('Account manager not yet initialized, skipping auto-refresh', 'TOKEN')
            return 0
        }

        logger.info('Starting auto token refresh...', 'TOKEN')

        const needsRefresh = this.accountTokens.filter(account =>
            this.tokenManager.isTokenExpiringSoon(account.token, thresholdHours)
        )

        if (needsRefresh.length === 0) {
            logger.info('No tokens need refreshing', 'TOKEN')
            return 0
        }

        logger.info(`Found ${needsRefresh.length} tokens needing refresh`, 'TOKEN')

        let successCount = 0

        for (const account of needsRefresh) {
            try {
                const updatedAccount = await this.tokenManager.refreshToken(account)
                if (updatedAccount) {
                    const index = this.accountTokens.findIndex(acc => acc.email === account.email)
                    if (index !== -1) {
                        this.accountTokens[index] = updatedAccount
                    }

                    await this.dataPersistence.saveAccount(account.email, {
                        password: updatedAccount.password,
                        token: updatedAccount.token,
                        expires: updatedAccount.expires
                    })

                    this.accountRotator.resetFailures(account.email)
                    successCount++
                } else {
                    this.accountRotator.recordFailure(account.email)
                }
            } catch (error) {
                this.accountRotator.recordFailure(account.email)
                logger.error(`Error refreshing account ${account.email}`, 'TOKEN', '', error)
            }

            await this._delay(1000)
        }

        this.accountRotator.setAccounts(this.accountTokens)
        logger.success(`Token refresh complete: ${successCount} succeeded`, 'TOKEN')
        return successCount
    }

    /**
     * Get available account token
     * @returns {string|null} Account token or null
     */
    getAccountToken() {
        if (!this.isInitialized) {
            logger.warn('Account manager not yet initialized', 'ACCOUNT')
            return null
        }

        if (this.accountTokens.length === 0) {
            logger.error('No available account tokens', 'ACCOUNT')
            return null
        }

        const token = this.accountRotator.getNextToken()
        if (!token) {
            logger.error('All account tokens unavailable', 'ACCOUNT')
        }

        return token
    }

    /**
     * Get token by email
     * @param {string} email - Email address
     * @returns {string|null} Account token or null
     */
    getTokenByEmail(email) {
        return this.accountRotator.getTokenByEmail(email)
    }

    /**
     * Generate Markdown table from web search info
     * @param {Array} websites - Website info array
     * @param {string} mode - Mode ('table' or 'text')
     * @returns {Promise<string>} Markdown string
     */
    async generateMarkdownTable(websites, mode) {
        if (!Array.isArray(websites) || websites.length === 0) {
            return ''
        }

        let markdown = ''
        if (mode === 'table') {
            markdown += '| **#** | **URL** | **Source** |\n'
            markdown += '|:---|:---|:---|\n'
        }

        const DEFAULT_TITLE = 'Unknown'
        const DEFAULT_URL = '#'
        const DEFAULT_HOSTNAME = 'Unknown'

        websites.forEach((site, index) => {
            const { title, url, hostname } = site
            const urlCell = `[${title || DEFAULT_TITLE}](${url || DEFAULT_URL})`
            const hostnameCell = hostname || DEFAULT_HOSTNAME
            if (mode === 'table') {
                markdown += `| ${index + 1} | ${urlCell} | ${hostnameCell} |\n`
            } else {
                markdown += `[${index + 1}] ${urlCell} | Source: ${hostnameCell}\n`
            }
        })

        return markdown
    }

    /**
     * Get all account info
     * @returns {Array} Account list
     */
    getAllAccountKeys() {
        return this.accountTokens
    }

    /**
     * Login (delegates to TokenManager)
     * @param {string} email - Email
     * @param {string} password - Password
     * @returns {Promise<string|null>} Token or null
     */
    async login(email, password) {
        return await this.tokenManager.login(email, password)
    }

    /**
     * Add account with existing token
     * @param {string} email - Email
     * @param {string} password - Password
     * @param {string} token - Token
     * @param {number} expires - Expiry timestamp
     * @returns {Promise<boolean>} Whether add was successful
     */
    async addAccountWithToken(email, password, token, expires) {
        try {
            const existingAccount = this.accountTokens.find(acc => acc.email === email)
            if (existingAccount) {
                logger.warn(`Account ${email} already exists`, 'ACCOUNT')
                return false
            }

            const newAccount = { email, password, token, expires }
            this.accountTokens.push(newAccount)

            const saved = await this.dataPersistence.saveAccount(email, newAccount)
            if (!saved && config.dataSaveMode !== 'none') {
                this.accountTokens.pop()
                this.accountRotator.setAccounts(this.accountTokens)
                return false
            }

            this.accountRotator.setAccounts(this.accountTokens)
            logger.success(`Account added: ${email}`, 'ACCOUNT')
            return true
        } catch (error) {
            logger.error(`Failed to add account (${email})`, 'ACCOUNT', '', error)
            return false
        }
    }

    /**
     * Refresh single account token
     * @param {string} email - Email address
     * @returns {Promise<boolean>} Whether refresh was successful
     */
    async refreshAccountToken(email) {
        const account = this.accountTokens.find(acc => acc.email === email)
        if (!account) {
            logger.error(`Account not found: ${email}`, 'ACCOUNT')
            return false
        }

        const updatedAccount = await this.tokenManager.refreshToken(account)
        if (updatedAccount) {
            const index = this.accountTokens.findIndex(acc => acc.email === email)
            if (index !== -1) {
                this.accountTokens[index] = updatedAccount
            }

            await this.dataPersistence.saveAccount(email, {
                password: updatedAccount.password,
                token: updatedAccount.token,
                expires: updatedAccount.expires
            })

            this.accountRotator.resetFailures(email)
            return true
        }

        return false
    }

    /**
     * Delete account
     * @param {string} email - Email address
     * @returns {boolean} Whether delete was successful
     */
    deleteAccount(email) {
        const index = this.accountTokens.findIndex(t => t.email === email)
        if (index !== -1) {
            this.accountTokens.splice(index, 1)
            this.accountRotator.setAccounts(this.accountTokens)
            return true
        }
        return false
    }

    /**
     * Get health statistics
     * @returns {Object} Health stats
     */
    getHealthStats() {
        const tokenStats = this.tokenManager.getTokenHealthStats(this.accountTokens)
        const rotatorStats = this.accountRotator.getStats()

        return {
            accounts: tokenStats,
            rotation: rotatorStats,
            initialized: this.isInitialized
        }
    }

    /**
     * Record account failure
     * @param {string} email - Email address
     */
    recordAccountFailure(email) {
        this.accountRotator.recordFailure(email)
    }

    /**
     * Reset account failures
     * @param {string} email - Email address
     */
    resetAccountFailures(email) {
        this.accountRotator.resetFailures(email)
    }

    /** @private */
    async _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    /**
     * Cleanup resources
     */
    destroy() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval)
            this.refreshInterval = null
        }
        this.accountRotator.reset()
        logger.info('Account manager resources cleaned up', 'ACCOUNT')
    }
}

const accountManager = new Account()

process.on('exit', () => {
    if (accountManager) {
        accountManager.destroy()
    }
})

process.on('SIGINT', () => {
    if (accountManager) {
        accountManager.destroy()
    }
    process.exit(0)
})

module.exports = accountManager

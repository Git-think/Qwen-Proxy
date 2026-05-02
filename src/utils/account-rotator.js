const { logger } = require('./logger')

/**
 * Account Rotator
 * Handles account rotation and load balancing
 */
class AccountRotator {
  constructor() {
    this.accounts = []
    this.currentIndex = 0
    this.lastUsedTimes = new Map()
    this.failureCounts = new Map()
    this.maxFailures = 3
    this.cooldownPeriod = 5 * 60 * 1000 // 5 minute cooldown
  }

  /**
   * Set account list
   * @param {Array} accounts - Account list
   */
  setAccounts(accounts) {
    if (!Array.isArray(accounts)) {
      logger.error('Account list must be an array', 'ACCOUNT')
      throw new Error('Account list must be an array')
    }

    this.accounts = [...accounts]
    this.currentIndex = 0
    this._cleanupRecords()
  }

  /**
   * Get next available account token
   * @returns {string|null} Account token or null
   */
  getNextToken() {
    const info = this.getNextAccountInfo()
    return info ? info.token : null
  }

  /**
   * Get next available account info (token + email).
   * Same selection rules as getNextToken — exposed so callers (e.g. the
   * smart proxy layer) can scope per-account state without a second
   * lookup, and without advancing the rotator twice.
   * @returns {{token:string, email:string}|null}
   */
  getNextAccountInfo() {
    if (this.accounts.length === 0) {
      logger.error('No available accounts', 'ACCOUNT')
      return null
    }

    const availableAccounts = this._getAvailableAccounts()
    if (availableAccounts.length === 0) {
      logger.warn('All accounts unavailable, using round-robin', 'ACCOUNT')
      const acc = this._getAccountByRoundRobin()
      return acc ? { token: acc.token, email: acc.email } : null
    }

    const selectedAccount = this._selectLeastUsedAccount(availableAccounts)
    this._recordUsage(selectedAccount.email)
    return { token: selectedAccount.token, email: selectedAccount.email }
  }

  /**
   * Reverse lookup: which email currently owns the given token? Used by
   * the request layer to scope a per-account proxy without advancing the
   * rotator. Returns null if no match.
   * @param {string} token
   */
  getEmailByToken(token) {
    if (!token) return null
    const acc = this.accounts.find(a => a.token === token)
    return acc ? acc.email : null
  }

  /**
   * Get token by email
   * @param {string} email - Email address
   * @returns {string|null} Account token or null
   */
  getTokenByEmail(email) {
    const account = this.accounts.find(acc => acc.email === email)
    if (!account) {
      logger.error(`Account not found: ${email}`, 'ACCOUNT')
      return null
    }

    if (!this._isAccountAvailable(account)) {
      logger.warn(`Account ${email} currently unavailable`, 'ACCOUNT')
      return null
    }

    this._recordUsage(email)
    return account.token
  }

  /**
   * Record account failure
   * @param {string} email - Email address
   */
  recordFailure(email) {
    const currentFailures = this.failureCounts.get(email) || 0
    this.failureCounts.set(email, currentFailures + 1)

    if (currentFailures + 1 >= this.maxFailures) {
      logger.warn(`Account ${email} reached failure limit, entering cooldown`, 'ACCOUNT')
    }
  }

  /**
   * Reset account failure count
   * @param {string} email - Email address
   */
  resetFailures(email) {
    this.failureCounts.delete(email)
  }

  /**
   * Get account statistics
   * @returns {Object} Statistics
   */
  getStats() {
    const total = this.accounts.length
    const available = this._getAvailableAccounts().length
    const inCooldown = total - available

    const usageStats = {}
    this.accounts.forEach(account => {
      const email = account.email
      usageStats[email] = {
        failures: this.failureCounts.get(email) || 0,
        lastUsed: this.lastUsedTimes.get(email) || null,
        available: this._isAccountAvailable(account)
      }
    })

    return {
      total,
      available,
      inCooldown,
      currentIndex: this.currentIndex,
      usageStats
    }
  }

  /** @private */
  _getAvailableAccounts() {
    return this.accounts.filter(account => this._isAccountAvailable(account))
  }

  /** @private */
  _isAccountAvailable(account) {
    if (!account.token) {
      return false
    }
    // Operator-disabled accounts stay in the list (so the toggle is
    // reversible without losing credentials) but never get picked.
    if (account.disabled) {
      return false
    }

    const failures = this.failureCounts.get(account.email) || 0
    if (failures >= this.maxFailures) {
      const lastUsed = this.lastUsedTimes.get(account.email)
      if (lastUsed && Date.now() - lastUsed < this.cooldownPeriod) {
        return false // Still in cooldown
      } else {
        // Cooldown ended, reset failure count
        this.failureCounts.delete(account.email)
      }
    }

    return true
  }

  /** @private */
  _selectLeastUsedAccount(accounts) {
    if (accounts.length === 1) {
      return accounts[0]
    }

    return accounts.reduce((least, current) => {
      const leastLastUsed = this.lastUsedTimes.get(least.email) || 0
      const currentLastUsed = this.lastUsedTimes.get(current.email) || 0

      return currentLastUsed < leastLastUsed ? current : least
    })
  }

  /** @private */
  _getTokenByRoundRobin() {
    const acc = this._getAccountByRoundRobin()
    return acc ? acc.token : null
  }

  /** @private — same as _getTokenByRoundRobin but returns the account */
  _getAccountByRoundRobin() {
    if (this.currentIndex >= this.accounts.length) {
      this.currentIndex = 0
    }

    const account = this.accounts[this.currentIndex]
    this.currentIndex++

    if (account && account.token) {
      this._recordUsage(account.email)
      return account
    }

    if (this.currentIndex < this.accounts.length) {
      return this._getAccountByRoundRobin()
    }

    return null
  }

  /** @private */
  _recordUsage(email) {
    this.lastUsedTimes.set(email, Date.now())
  }

  /** @private */
  _cleanupRecords() {
    const currentEmails = new Set(this.accounts.map(acc => acc.email))

    for (const email of this.failureCounts.keys()) {
      if (!currentEmails.has(email)) {
        this.failureCounts.delete(email)
      }
    }

    for (const email of this.lastUsedTimes.keys()) {
      if (!currentEmails.has(email)) {
        this.lastUsedTimes.delete(email)
      }
    }
  }

  /**
   * Reset all statistics
   */
  reset() {
    this.currentIndex = 0
    this.lastUsedTimes.clear()
    this.failureCounts.clear()
  }
}

module.exports = AccountRotator

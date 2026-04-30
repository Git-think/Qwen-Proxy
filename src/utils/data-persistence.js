const fs = require('fs').promises
const path = require('path')
const config = require('../config/index.js')
const { logger } = require('./logger')

/**
 * Data Persistence Manager
 * Handles account data storage and retrieval (none/file modes only)
 */
class DataPersistence {
  constructor() {
    this.dataFilePath = path.join(__dirname, '../../data/data.json')
  }

  /**
   * Load all account data
   * @returns {Promise<Array>} Account list
   */
  async loadAccounts() {
    try {
      switch (config.dataSaveMode) {
        case 'file':
          return await this._loadFromFile()
        case 'none':
        default:
          return await this._loadFromEnv()
      }
    } catch (error) {
      logger.error('Failed to load account data', 'DATA', '', error)
      throw error
    }
  }

  /**
   * Save single account data
   * @param {string} email - Email
   * @param {Object} accountData - Account data
   * @returns {Promise<boolean>} Whether save was successful
   */
  async saveAccount(email, accountData) {
    try {
      switch (config.dataSaveMode) {
        case 'file':
          return await this._saveToFile(email, accountData)
        case 'none':
        default:
          // Environment variable mode does not support saving
          return false
      }
    } catch (error) {
      logger.error(`Failed to save account data (${email})`, 'DATA', '', error)
      return false
    }
  }

  /**
   * Batch save account data
   * @param {Array} accounts - Account list
   * @returns {Promise<boolean>} Whether save was successful
   */
  async saveAllAccounts(accounts) {
    try {
      switch (config.dataSaveMode) {
        case 'file':
          return await this._saveAllToFile(accounts)
        case 'none':
        default:
          return false
      }
    } catch (error) {
      logger.error('Failed to batch save account data', 'DATA', '', error)
      return false
    }
  }

  /**
   * Load from file
   * @private
   */
  async _loadFromFile() {
    await this._ensureDataFileExists()

    const fileContent = await fs.readFile(this.dataFilePath, 'utf-8')
    const data = JSON.parse(fileContent)

    return data.accounts || []
  }

  /**
   * Load from environment variables
   * @private
   */
  async _loadFromEnv() {
    if (!process.env.ACCOUNTS) {
      return []
    }

    const accountTokens = process.env.ACCOUNTS.split(',')
    const accounts = []

    for (const item of accountTokens) {
      const separatorIndex = item.indexOf(':')
      if (separatorIndex === -1) continue

      const email = item.slice(0, separatorIndex).trim()
      const password = item.slice(separatorIndex + 1).trim()

      if (email && password) {
        accounts.push({ email, password, token: null, expires: null })
      }
    }

    return accounts
  }

  /**
   * Save to file
   * @private
   */
  async _saveToFile(email, accountData) {
    await this._ensureDataFileExists()

    const fileContent = await fs.readFile(this.dataFilePath, 'utf-8')
    const data = JSON.parse(fileContent)

    if (!data.accounts) {
      data.accounts = []
    }

    const existingIndex = data.accounts.findIndex(account => account.email === email)
    const updatedAccount = {
      email,
      password: accountData.password,
      token: accountData.token,
      expires: accountData.expires
    }

    if (existingIndex !== -1) {
      data.accounts[existingIndex] = updatedAccount
    } else {
      data.accounts.push(updatedAccount)
    }

    await fs.writeFile(this.dataFilePath, JSON.stringify(data, null, 2), 'utf-8')
    return true
  }

  /**
   * Batch save to file
   * @private
   */
  async _saveAllToFile(accounts) {
    await this._ensureDataFileExists()

    const data = {
      accounts: accounts.map(account => ({
        email: account.email,
        password: account.password,
        token: account.token,
        expires: account.expires
      }))
    }

    await fs.writeFile(this.dataFilePath, JSON.stringify(data, null, 2), 'utf-8')
    return true
  }

  /**
   * Ensure data file exists
   * @private
   */
  async _ensureDataFileExists() {
    try {
      await fs.access(this.dataFilePath)
    } catch (error) {
      logger.info('Data file does not exist, creating default...', 'FILE')

      const dirPath = path.dirname(this.dataFilePath)
      await fs.mkdir(dirPath, { recursive: true })

      const defaultData = { accounts: [] }
      await fs.writeFile(this.dataFilePath, JSON.stringify(defaultData, null, 2), 'utf-8')
      logger.success('Default data file created', 'FILE')
    }
  }
}

module.exports = DataPersistence

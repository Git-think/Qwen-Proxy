const express = require('express')
const router = express.Router()
const accountManager = require('../utils/account')
const { logger } = require('../utils/logger')
const { JwtDecode } = require('../utils/tools')
const { adminKeyVerify } = require('../middlewares/authorization')

/**
 * GET /getAllAccounts - Get all accounts (paginated)
 */
router.get('/getAllAccounts', adminKeyVerify, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 1000
    const start = (page - 1) * pageSize

    const allAccounts = accountManager.getAllAccountKeys()
    const total = allAccounts.length

    const paginatedAccounts = allAccounts.slice(start, start + pageSize)

    const accounts = paginatedAccounts.map(account => ({
      email: account.email,
      password: account.password,
      token: account.token,
      expires: account.expires
    }))

    res.json({ total, page, pageSize, data: accounts })
  } catch (error) {
    logger.error('Failed to get account list', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /setAccount - Add account
 */
router.post('/setAccount', adminKeyVerify, async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    const exists = accountManager.accountTokens.find(item => item.email === email)
    if (exists) {
      return res.status(409).json({ error: 'Account already exists' })
    }

    const authToken = await accountManager.login(email, password)
    if (!authToken) {
      return res.status(401).json({ error: 'Login failed' })
    }

    const decoded = JwtDecode(authToken)
    const expires = decoded.exp

    const success = await accountManager.addAccountWithToken(email, password, authToken, expires)

    if (success) {
      res.status(200).json({ email, message: 'Account created successfully' })
    } else {
      res.status(500).json({ error: 'Account creation failed' })
    }
  } catch (error) {
    logger.error('Failed to create account', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * DELETE /deleteAccount - Delete account
 */
router.delete('/deleteAccount', adminKeyVerify, async (req, res) => {
  try {
    const { email } = req.body

    const exists = accountManager.accountTokens.find(item => item.email === email)
    if (!exists) {
      return res.status(404).json({ error: 'Account not found' })
    }

    const success = accountManager.deleteAccount(email)

    if (success) {
      res.json({ message: 'Account deleted successfully' })
    } else {
      res.status(500).json({ error: 'Account deletion failed' })
    }
  } catch (error) {
    logger.error('Failed to delete account', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /refreshAccount - Refresh single account token
 */
router.post('/refreshAccount', adminKeyVerify, async (req, res) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ error: 'Email is required' })
    }

    const exists = accountManager.accountTokens.find(item => item.email === email)
    if (!exists) {
      return res.status(404).json({ error: 'Account not found' })
    }

    const success = await accountManager.refreshAccountToken(email)

    if (success) {
      res.json({ message: 'Account token refreshed successfully', email })
    } else {
      res.status(500).json({ error: 'Account token refresh failed' })
    }
  } catch (error) {
    logger.error('Failed to refresh account token', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /refreshAllAccounts - Refresh all account tokens
 */
router.post('/refreshAllAccounts', adminKeyVerify, async (req, res) => {
  try {
    const { thresholdHours = 24 } = req.body
    const refreshedCount = await accountManager.autoRefreshTokens(thresholdHours)

    res.json({
      message: 'Batch refresh complete',
      refreshedCount,
      thresholdHours
    })
  } catch (error) {
    logger.error('Failed to batch refresh account tokens', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

module.exports = router

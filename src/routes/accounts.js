const express = require('express')
const router = express.Router()
const accountManager = require('../utils/account')
const { logger } = require('../utils/logger')
const { JwtDecode } = require('../utils/tools')
const { adminKeyVerify } = require('../middlewares/authorization')
const { syncProxiesToVercel, syncDisabledAccountsToVercel, syncAccountsToVercel } = require('../utils/vercel-sync')

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

    const nowSec = Math.floor(Date.now() / 1000)
    const accounts = paginatedAccounts.map(account => {
      const hasToken = !!account.token
      const expires = account.expires || 0
      // expires here is unix seconds from JWT. Compute readable ms timestamp.
      const tokenExpiry = expires > 0 ? expires * 1000 : null
      const isValid = hasToken && expires > nowSec
      return {
        email: account.email,
        password: account.password,
        token: account.token || '',
        expires,
        tokenExpiry,
        isValid,
        disabled: !!account.disabled,
        lastLoginError: account.lastLoginError || null,
      }
    })

    res.json({ total, page, pageSize, data: accounts })
  } catch (error) {
    logger.error('Failed to get account list', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /setAccount - Add account
 *
 * On success the full roster is mirrored back to the Vercel project's
 * ACCOUNTS env var (when on a non-redis serverless deploy with Vercel
 * sync configured) so the new account survives the next cold start
 * without needing manual env editing. Skipped on redis (already
 * persisted there) and when Vercel sync isn't configured.
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
      // NOTE: deliberately NOT auto-syncing to Vercel here. Pushing
      // ACCOUNTS env triggers a fresh build (~60s); operators prefer to
      // batch changes and manually sync via the Vercel page button.
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
      // NOTE: no auto Vercel sync — see /setAccount comment above.
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

/**
 * POST /disableAccount - Toggle the disabled flag on an account.
 * Body: { email, disabled }
 *
 * Disabled accounts stay in the list (so the toggle is reversible
 * without losing credentials) but the rotator skips them. Persistence
 * decided automatically by data-save mode:
 *   - file / redis: written via dataPersistence.saveAccount
 *   - none + Vercel sync configured: full disabled-list pushed back to
 *     the Vercel DISABLED_ACCOUNTS env var so it survives cold starts
 *   - redis: short-circuits the Vercel push (already covered)
 */
router.post('/disableAccount', adminKeyVerify, async (req, res) => {
  try {
    const { email, disabled } = req.body || {}
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Missing email' })
    }
    const ok = await accountManager.setAccountDisabled(email, !!disabled)
    if (!ok) {
      return res.status(404).json({ error: `Account not found: ${email}` })
    }
    // No auto Vercel sync — operator triggers it from the Vercel page.
    res.json({ success: true, email, disabled: !!disabled })
  } catch (error) {
    logger.error('Failed to toggle account disabled', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /proxy/status - Smart proxy pool status (admin)
 * Returns the in-memory pool snapshot including each entry's status,
 * the host (credentials are stripped), and which accounts are bound to it.
 */
router.get('/proxy/status', adminKeyVerify, async (req, res) => {
  try {
    const list = accountManager.getProxyStatus()
    res.json({ total: list.length, data: list })
  } catch (error) {
    logger.error('Failed to load proxy status', 'PROXY', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /proxy/add - Add a proxy URL to the pool at runtime (admin).
 * Body: { url: 'socks5://...' | 'http://...' | 'https://...' }
 *
 * After updating the in-memory pool we also push the latest list back
 * to the Vercel project's PROXIES env var (if Vercel sync is configured
 * AND we're not already on redis — see vercel-sync.js for the gate).
 * This lets a Vercel cold start pick up the same proxy set instead of
 * resetting to whatever was last manually set in the dashboard.
 */
router.post('/proxy/add', adminKeyVerify, async (req, res) => {
  try {
    const { url } = req.body || {}
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing url' })
    }
    if (!accountManager.proxyPool) {
      return res.status(400).json({ error: 'Proxy pool not initialized' })
    }
    const ok = await accountManager.proxyPool.addProxy(url.trim())
    // Persistence (file/redis) handled inside addProxy. No auto Vercel
    // sync — operator triggers it from the Vercel page.
    res.json({ success: ok, url })
  } catch (error) {
    logger.error('Failed to add proxy', 'PROXY', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * DELETE /proxy - Remove a proxy from the pool (admin).
 * Body: { url }
 */
router.delete('/proxy', adminKeyVerify, async (req, res) => {
  try {
    const { url } = req.body || {}
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing url' })
    }
    if (!accountManager.proxyPool) {
      return res.status(400).json({ error: 'Proxy pool not initialized' })
    }
    const ok = await accountManager.proxyPool.removeProxy(url)
    res.json({ success: ok, url })
  } catch (error) {
    logger.error('Failed to remove proxy', 'PROXY', '', error)
    res.status(500).json({ error: error.message })
  }
})

module.exports = router

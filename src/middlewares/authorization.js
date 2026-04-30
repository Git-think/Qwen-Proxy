const config = require('../config')

/**
 * Validate API Key
 * @param {string} providedKey - Provided API Key
 * @returns {Object} Validation result { isValid: boolean, isAdmin: boolean }
 */
const validateApiKey = (providedKey) => {
  if (!providedKey) {
    return { isValid: false, isAdmin: false }
  }

  // Remove Bearer prefix
  const cleanKey = providedKey.startsWith('Bearer ') ? providedKey.slice(7) : providedKey

  const isValid = config.apiKeys.includes(cleanKey)
  const isAdmin = cleanKey === config.adminKey

  return { isValid, isAdmin }
}

/**
 * API Key verification middleware - validates any valid API Key
 */
const apiKeyVerify = (req, res, next) => {
  // If no API keys configured, allow all requests
  if (config.apiKeys.length === 0) {
    req.isAdmin = true
    req.apiKey = ''
    return next()
  }

  const apiKey = req.headers['authorization'] || req.headers['Authorization'] || req.headers['x-api-key']
  const { isValid, isAdmin } = validateApiKey(apiKey)

  if (!isValid) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  req.isAdmin = isAdmin
  req.apiKey = apiKey
  next()
}

/**
 * Admin key verification middleware - only allows admin API Key
 */
const adminKeyVerify = (req, res, next) => {
  if (config.apiKeys.length === 0) {
    req.isAdmin = true
    req.apiKey = ''
    return next()
  }

  const apiKey = req.headers['authorization'] || req.headers['Authorization'] || req.headers['x-api-key']
  const { isValid, isAdmin } = validateApiKey(apiKey)

  if (!isValid || !isAdmin) {
    return res.status(403).json({ error: 'Admin access required' })
  }

  req.isAdmin = isAdmin
  req.apiKey = apiKey
  next()
}

module.exports = {
  apiKeyVerify,
  adminKeyVerify,
  validateApiKey
}
